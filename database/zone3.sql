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

CREATE INDEX IF NOT EXISTS idx_sessions_user
    ON zone3.chat_sessions (user_id, engagement_id);

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

CREATE INDEX IF NOT EXISTS idx_messages_session
    ON zone3.chat_messages (session_id, created_at);

-- Developer scratchpad notes
CREATE TABLE IF NOT EXISTS zone3.scratchpad_notes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       TEXT NOT NULL,
    engagement_id TEXT NOT NULL,
    title         TEXT,
    content       TEXT NOT NULL,
    status        TEXT DEFAULT 'draft'
                      CHECK (status IN ('draft', 'approved', 'promoted')),
    source_pr     TEXT,           -- PR number if auto-drafted, NULL if manual
    approved_at   TIMESTAMPTZ,    -- when developer clicked Approve
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scratchpad_user
    ON zone3.scratchpad_notes (user_id, engagement_id, status);

-- Full-text search on scratchpad (no vectors — tsvector is enough here)
ALTER TABLE zone3.scratchpad_notes
    ADD COLUMN IF NOT EXISTS search_vector TSVECTOR
    GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(title, '') || ' ' || content)
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_scratchpad_fts
    ON zone3.scratchpad_notes USING GIN (search_vector);
