-- Zone 3 — developer-private layer: Ask Project chat history + Scratchpad.
--
-- Deviates from the original task spec in one way: user_id and engagement_id
-- are TEXT, not UUID. Every real ID in this app is TEXT — engagement_id is
-- literally the string 'proj-001' (see public.chunks), and user_id is a
-- Prisma cuid() string like 'cm...', not a UUID. UUID columns here would
-- reject every real insert.

CREATE SCHEMA IF NOT EXISTS zone3;

-- One row per conversation thread per developer
CREATE TABLE IF NOT EXISTS zone3.chat_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       TEXT NOT NULL,
    engagement_id TEXT NOT NULL,
    title         TEXT,                          -- auto-set from first message
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Denormalised last-activity stamp: the sidebar sorts by it, so listing
-- sessions never needs a join back into chat_messages.
ALTER TABLE zone3.chat_sessions
    ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;

-- Backfill for sessions created before this column existed.
UPDATE zone3.chat_sessions s
SET last_message_at = (
    SELECT MAX(m.created_at) FROM zone3.chat_messages m WHERE m.session_id = s.id
)
WHERE s.last_message_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_user
    ON zone3.chat_sessions (user_id, engagement_id, last_message_at DESC);

-- Every message in a session
CREATE TABLE IF NOT EXISTS zone3.chat_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL
                        REFERENCES zone3.chat_sessions(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content         TEXT NOT NULL,
    cited_chunk_ids UUID[],       -- points back to public.chunks.id (provenance)
    abstained       BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Provenance/display columns from the task spec: power the
-- "gemini · 3 sources · 1.2s" indicator and per-answer debugging.
ALTER TABLE zone3.chat_messages ADD COLUMN IF NOT EXISTS llm_model TEXT;
ALTER TABLE zone3.chat_messages ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
ALTER TABLE zone3.chat_messages ADD COLUMN IF NOT EXISTS chunk_count INTEGER;

CREATE INDEX IF NOT EXISTS idx_messages_session
    ON zone3.chat_messages (session_id, created_at);

-- One row per citation in an assistant message — the spec's replacement for
-- the cited_chunk_ids array: revocation lookup ("every message that cited
-- chunk X") is a B-tree lookup here, and tombstoning a revoked citation
-- becomes a flag on one row instead of a text edit on the message.
CREATE TABLE IF NOT EXISTS zone3.message_sources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL
                        REFERENCES zone3.chat_messages(id) ON DELETE CASCADE,
    chunk_id        UUID,         -- public.chunks.id; NULL for live-fetched sources
    source_doc_id   TEXT NOT NULL,
    source_type     TEXT NOT NULL,
    relevance_score REAL,
    snippet         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sources_message ON zone3.message_sources (message_id);
CREATE INDEX IF NOT EXISTS idx_sources_chunk ON zone3.message_sources (chunk_id);

-- Developer scratchpad notes
CREATE TABLE IF NOT EXISTS zone3.scratchpad_notes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    engagement_id   TEXT NOT NULL,
    title           TEXT,
    content         TEXT NOT NULL,
    status          TEXT DEFAULT 'draft'
                        CHECK (status IN ('draft', 'approved', 'promoted')),
    source_pr       TEXT,           -- PR number if auto-drafted, NULL if manual
    pr_head_sha     TEXT,           -- last-seen HEAD sha of source_pr, for detecting new code changes
    current_version INTEGER NOT NULL DEFAULT 1,
    approved_at     TIMESTAMPTZ,    -- when developer clicked Approve
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scratchpad_user
    ON zone3.scratchpad_notes (user_id, engagement_id, status);

-- One row per prior version of a note's content, written just before the
-- note itself is overwritten - either by a manual edit, or because the
-- linked PR's code changed since the note was last synced (pr_head_sha
-- moved). change_reason distinguishes the two triggers.
CREATE TABLE IF NOT EXISTS zone3.scratchpad_note_versions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id        UUID NOT NULL
                       REFERENCES zone3.scratchpad_notes(id) ON DELETE CASCADE,
    version_num    INTEGER NOT NULL,
    title          TEXT,
    content        TEXT NOT NULL,
    change_reason  TEXT NOT NULL
                       CHECK (change_reason IN ('manual_edit', 'pr_update')),
    pr_diff_ref    TEXT,           -- PR head sha this version was snapshotted at, if pr_update
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (note_id, version_num)
);

CREATE INDEX IF NOT EXISTS idx_scratchpad_versions_note
    ON zone3.scratchpad_note_versions (note_id, version_num DESC);

-- Full-text search on scratchpad (no vectors — tsvector is enough here)
ALTER TABLE zone3.scratchpad_notes
    ADD COLUMN IF NOT EXISTS search_vector TSVECTOR
    GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(title, '') || ' ' || content)
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_scratchpad_fts
    ON zone3.scratchpad_notes USING GIN (search_vector);

-- Question embeddings power the answer cache: an incoming question that is
-- near-identical (cosine >= CACHE_SIMILARITY) to a past one from the same
-- user can reuse that answer, provided every cited chunk is unchanged since.
-- No vector index: per-user message volume is small enough for a seq scan.
ALTER TABLE zone3.chat_messages ADD COLUMN IF NOT EXISTS embedding VECTOR(384);

-- Auto-draft candidate queue (Scratchpad Feature 5's pre-filter step).
-- sync_jira() (api/sync.py) enqueues a row the moment a ticket's status
-- transitions into a done state — one cheap INSERT on an already-changed
-- ticket, no network/LLM calls, so it adds no meaningful latency to the
-- Jira/GitHub poll it runs inside.
--
-- A separate, independently-scheduled task (api.scratchpad_triggers.
-- evaluate_candidates(), its own asyncio task in main.py — never the same
-- one sync_jira() runs on) drains this queue: runs the free is_note_worthy()
-- check, and later the LLM distillation step, entirely decoupled from the
-- sync loop's timing.
--
-- UNIQUE(engagement_id, ticket_key) means a ticket is only ever queued once
-- in its lifetime, even if it's reopened and closed again later — accepted
-- tradeoff for now; revisit if reopen-and-refix turns out to be common
-- enough to matter.
CREATE TABLE IF NOT EXISTS zone3.scratchpad_draft_candidates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id TEXT NOT NULL,
    ticket_key    TEXT NOT NULL,
    detected_at   TIMESTAMPTZ DEFAULT NOW(),
    evaluated_at  TIMESTAMPTZ,
    worthy        BOOLEAN,
    reasons       TEXT[],
    UNIQUE (engagement_id, ticket_key)
);

-- The consumer step's own query pattern: "give me what's unevaluated,
-- oldest first" — never needs to scan already-processed rows.
CREATE INDEX IF NOT EXISTS idx_scratchpad_candidates_pending
    ON zone3.scratchpad_draft_candidates (detected_at)
    WHERE evaluated_at IS NULL;

-- provenance_ids: the public.chunks ids (the github_commit chunks) an
-- auto-drafted note was distilled from. NOT NULL means this note is still
-- "machine-made from the client's data" — that's exactly what the R9
-- offboarding cascade keys on (see api.scratchpad_triggers.
-- cascade_delete_engagement): a client leaving deletes every note whose
-- provenance_ids is still set, even one a developer already saw and never
-- touched, because "private" only ever meant who could see it, not whether
-- Relay was allowed to keep holding onto client-derived content.
--
-- approveNote (PATCH .../approve, api/scratchpad.py) sets this to NULL —
-- "provenance cut": from that moment the note is a human-made artifact
-- (the developer read it, judged it worth keeping, and owns that judgment)
-- and survives the cascade. This is the one column manual notes never have
-- a value in either — they never had provenance to cut.
--
-- source_ticket is the Jira key an auto-draft came from — kept distinct
-- from source_pr (a real GitHub PR number the check-pr-update feature calls
-- the GitHub API with). This engagement's commits land directly on main
-- with no PR, so auto-drafted notes are ticket-sourced, not PR-sourced;
-- source_pr stays NULL for them.
ALTER TABLE zone3.scratchpad_notes ADD COLUMN IF NOT EXISTS provenance_ids UUID[];
ALTER TABLE zone3.scratchpad_notes ADD COLUMN IF NOT EXISTS source_ticket TEXT;

CREATE INDEX IF NOT EXISTS idx_scratchpad_provenance
    ON zone3.scratchpad_notes (engagement_id)
    WHERE provenance_ids IS NOT NULL;

-- Promotion is append-only per the spec ("Log who, when") — a status flip
-- alone loses the record if a note is ever promoted more than once, or if
-- an audit needs to show who made the team-KB decision after the fact.
CREATE TABLE IF NOT EXISTS zone3.scratchpad_promotions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id    UUID NOT NULL REFERENCES zone3.scratchpad_notes(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    promoted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scratchpad identity: email, not the Prisma user id.
--
-- Unlike zone3.chat_sessions/chat_messages (still user_id, unchanged —
-- those rows are only ever created by a real logged-in frontend request, so
-- whatever id the frontend already sends consistently works fine), a
-- Scratchpad note can also be created unilaterally by the backend itself
-- (an auto-draft, born from a Jira ticket transition — see
-- api/scratchpad_triggers.py), with no frontend request and therefore no
-- Prisma user id in hand at all. Email is the one identity value both
-- sides can independently produce: the frontend already has it on the
-- logged-in session, and the backend can resolve a Jira assignee's name to
-- it via public.project_staffing (the same table api/access.py now checks
-- access against). So a manual note and an auto-draft for the same person
-- land under the same value, and GET /api/scratchpad?email=... returns both.
--
-- Guarded rather than a bare RENAME COLUMN so re-applying this file (e.g.
-- after apply_migrations.py flags it as "changed since last applied") is
-- still a no-op the second time, same as every CREATE ... IF NOT EXISTS
-- above.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'zone3' AND table_name = 'scratchpad_notes'
          AND column_name = 'user_id'
    ) THEN
        ALTER TABLE zone3.scratchpad_notes RENAME COLUMN user_id TO email;
    END IF;
END $$;
