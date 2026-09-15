-- Generic PM-document pipeline: the 11 doc types from the PM Tool Ingestion &
-- Retrieval reference (Charter, Deliverables Matrix, BRD/PRD, Change Request,
-- Epic Brief, Sprint Planning/Review, Retro, Status Report, Risk Log, UAT
-- Sign-off, Meeting Notes). SOW keeps its own existing pipeline
-- (sow_documents/sow_deliverables, see sow.sql) — it already works and isn't
-- part of this change; this table is for everything else in that 12-type set.
--
-- Same storage split as SOW: pm_documents holds the upload/classification
-- record (a pointer to the file, not its bytes), public.chunks holds the
-- searchable, chunked text — so Ask Project's existing retrieval pipeline
-- (api/query.py) needs zero changes to start answering from these once
-- they're ingested; it already searches public.chunks by engagement_id.

CREATE TABLE IF NOT EXISTS public.pm_documents (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id            TEXT NOT NULL REFERENCES public.projects(engagement_id) ON DELETE CASCADE,

    -- 'unclassified' is a real, storable state — the ingestion pipeline
    -- abstains into it rather than force-fitting a low-confidence guess into
    -- one of the 11 real types (same principle as the query pipeline
    -- abstaining rather than answering ungrounded: a wrong doc_type here
    -- corrupts is_latest grouping and structured filters for every other
    -- document of that type, so a human should resolve it, not the model).
    doc_type                 TEXT NOT NULL CHECK (doc_type IN (
                                 'charter', 'deliverables_matrix', 'requirements',
                                 'change_request', 'epic_brief', 'sprint_planning',
                                 'sprint_review', 'retro', 'status_report',
                                 'risk_log', 'uat_signoff', 'meeting_notes',
                                 'unclassified'
                             )),
    doc_id                   TEXT,       -- e.g. 'CR-002', 'EPIC-D8' — null for
                                          -- recurring types identified by date/sprint instead
    scenario                 TEXT CHECK (scenario IN ('client', 'internal')),
    doc_version              TEXT,
    doc_date                 DATE,
    author                   TEXT,
    doc_status               TEXT CHECK (doc_status IN ('draft', 'final', 'superseded')),

    -- What supersedes what: a recurring doc (status report, sprint notes) is
    -- grouped by (doc_type, engagement_id, recurrence_key) — e.g.
    -- recurrence_key = the week_start or sprint_number as text. An ID'd doc
    -- (a specific CR, a specific epic brief) uses doc_id as its own key.
    -- Exactly one row per group has is_latest = true; the pipeline sets this
    -- on ingest, never the uploader (see the note in the reference doc:
    -- "is_latest is set by the pipeline, never the author").
    recurrence_key            TEXT,
    is_latest                 BOOLEAN NOT NULL DEFAULT TRUE,

    source_file_name          TEXT NOT NULL,
    storage_path               TEXT NOT NULL,
    file_sha256                TEXT NOT NULL,

    -- Ingestion pipeline state, distinct from doc_status (which is the
    -- document's own client-authored lifecycle field, e.g. draft vs final).
    ingestion_status          TEXT NOT NULL DEFAULT 'uploaded' CHECK (ingestion_status IN (
                                 'uploaded', 'classifying', 'needs_review', 'confirmed',
                                 'rejected', 'failed'
                             )),
    classification_confidence REAL,
    classification_notes      TEXT,   -- why the classifier picked this doc_type, shown in the review UI
    parse_error                TEXT,

    -- Document-level entity summary (union of its chunks' entities) so the
    -- review UI can show "this doc mentions R-01, CR-002, Priya Kumar"
    -- without joining chunks — cheap to compute once at ingest, expensive to
    -- recompute per page view otherwise.
    entities                   JSONB NOT NULL DEFAULT '{}',

    uploaded_by                TEXT,
    uploaded_at                TIMESTAMPTZ DEFAULT NOW(),
    confirmed_by                TEXT,
    confirmed_at                TIMESTAMPTZ
);

-- Review-queue listing: "show me everything for this project, filterable by
-- type and pipeline status" — the frontend's primary query.
CREATE INDEX IF NOT EXISTS idx_pm_documents_engagement_status
    ON public.pm_documents (engagement_id, ingestion_status, uploaded_at DESC);

-- "Give me the current status report / the current sprint plan" — the
-- retrieval-relevant lookup, backing is_latest resolution and any UI that
-- shows just the live set of documents rather than full history.
CREATE INDEX IF NOT EXISTS idx_pm_documents_latest
    ON public.pm_documents (engagement_id, doc_type, recurrence_key)
    WHERE is_latest = TRUE;

-- Widen chunks to accept the 11 new PM doc types (+ 'unclassified' for
-- content pending human triage — stored so nothing is silently dropped, but
-- never surfaced by search; see the partial index below).
ALTER TABLE public.chunks DROP CONSTRAINT IF EXISTS chunks_source_type_check;
ALTER TABLE public.chunks ADD CONSTRAINT chunks_source_type_check
    CHECK (source_type IN (
        'jira_ticket', 'github_commit', 'github_pr', 'confluence_doc', 'project_overview',
        'sow_document', 'charter', 'deliverables_matrix', 'requirements', 'change_request',
        'epic_brief', 'sprint_planning', 'sprint_review', 'retro', 'status_report',
        'risk_log', 'uat_signoff', 'meeting_notes', 'unclassified'
    ));

-- Chunk-level fields needed for the reference doc's retrieval levers:
-- recency (is_latest, denormalized here so query.py never has to join
-- pm_documents just to filter it out — that join is exactly the per-query
-- latency this migration is trying to avoid), structure (section_path, for
-- citing "per Epic Brief > Story Breakdown" the way the grounding
-- instruction asks), and exact-match filtering (entities, e.g. "status of
-- R-01" without vector search at all). pm_document_id is nullable — Jira/
-- GitHub/SOW chunks have no parent row here and never will.
ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS pm_document_id UUID
    REFERENCES public.pm_documents(id) ON DELETE CASCADE;
ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS is_latest BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS section_path TEXT;
ALTER TABLE public.chunks ADD COLUMN IF NOT EXISTS entities JSONB NOT NULL DEFAULT '{}';

-- THE latency-critical index for this whole feature: every retrieval query
-- (vector, keyword, or a future metadata pre-filter) should narrow on
-- (engagement_id, source_type, is_latest) BEFORE the embedding/ts_rank scan,
-- not after. Partial on is_latest = TRUE because that's the only value any
-- live query ever filters on — a superseded status report is never a
-- candidate for search, only for explicit history browsing (not built yet,
-- and it can do a full scan if it ever is; that path isn't latency-sensitive).
CREATE INDEX IF NOT EXISTS idx_chunks_engagement_type_latest
    ON public.chunks (engagement_id, source_type)
    WHERE is_latest = TRUE;

-- Entity-exact-match lookups ("what's the status of R-01", "what did CR-002
-- decide") without vector search. jsonb_path_ops is narrower than the
-- default GIN opclass (containment only, no key-existence queries) but
-- smaller and faster, and containment (`entities @> '{"risk_ids": ["R-01"]}'`)
-- is the only access pattern this needs.
CREATE INDEX IF NOT EXISTS idx_chunks_entities
    ON public.chunks USING GIN (entities jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_chunks_pm_document
    ON public.chunks (pm_document_id) WHERE pm_document_id IS NOT NULL;
