-- SOW pipeline: real `projects` table (previously mock-only in the frontend,
-- per TASK_admin_panel.md) plus SOW document + deliverable storage.
--
-- Design note: the PDF's bytes and full raw text are never stored in
-- Postgres. sow_documents holds a pointer (storage_path) to the file on disk
-- (backend/storage/sow/{engagement_id}/{id}.pdf) plus a sha256 for integrity
-- checking on re-upload. The searchable text lives as rows in public.chunks
-- (same table Jira/GitHub already use), keyed by source_doc_id = sow_documents.id.
-- This means Ask Project's existing RAG pipeline (api/query.py) can answer
-- questions from SOW content with zero changes — it already searches
-- public.chunks by engagement_id.

-- Real projects table. IDs follow the TEXT convention established in
-- zone3.sql (engagement_id is literally 'proj-001' elsewhere in this DB,
-- never a UUID) instead of the UUID-heavy version in TASK_admin_panel.md.
CREATE TABLE IF NOT EXISTS public.projects (
    engagement_id     TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    client_name       TEXT NOT NULL,
    jira_project_key  TEXT,
    jira_base_url     TEXT,
    github_repo_url   TEXT,
    status            TEXT NOT NULL DEFAULT 'setup'
                          CHECK (status IN ('setup', 'active', 'archived')),
    retention_days    INTEGER DEFAULT 30,
    dpa_reference     TEXT,
    start_date        DATE,
    end_date          DATE,
    created_by        TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the one engagement that's already live in public.chunks, so the SOW
-- upload FK below has something real to point at from the first test.
INSERT INTO public.projects (engagement_id, name, client_name, jira_project_key, status)
VALUES ('proj-001', 'Apache Kafka', 'Apache Software Foundation', 'KPD', 'active')
ON CONFLICT (engagement_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sow_documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id     TEXT NOT NULL REFERENCES public.projects(engagement_id) ON DELETE CASCADE,
    file_name         TEXT NOT NULL,
    storage_path      TEXT NOT NULL,       -- disk path today; swap for an S3 key later, column stays the same
    file_sha256       TEXT NOT NULL,       -- integrity check + re-upload dedupe
    page_count        INTEGER,
    scope_exclusions  TEXT,
    status            TEXT NOT NULL DEFAULT 'uploaded'
                          CHECK (status IN ('uploaded', 'parsing', 'parsed', 'failed')),
    parse_error       TEXT,
    uploaded_by       TEXT,
    uploaded_at       TIMESTAMPTZ DEFAULT NOW(),
    parsed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sow_documents_engagement
    ON public.sow_documents (engagement_id, uploaded_at DESC);

-- Structured, admin-editable output of parsing. source_chunk_id traces each
-- deliverable back to the exact chunk it was extracted from — same
-- provenance pattern as zone3.message_sources -> public.chunks — so
-- "why did the system think D3 is this" is answerable, not a black box.
CREATE TABLE IF NOT EXISTS public.sow_deliverables (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sow_document_id       UUID NOT NULL REFERENCES public.sow_documents(id) ON DELETE CASCADE,
    engagement_id         TEXT NOT NULL,   -- denormalized so the deliverables list for a
                                            -- project never needs a join through sow_documents
    sequence              INTEGER NOT NULL,
    name                  TEXT NOT NULL,
    acceptance_criteria   TEXT,
    source_page           INTEGER,
    source_chunk_id       UUID REFERENCES public.chunks(id) ON DELETE SET NULL,
    is_edited             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sow_deliverables_document
    ON public.sow_deliverables (sow_document_id, sequence);
CREATE INDEX IF NOT EXISTS idx_sow_deliverables_engagement
    ON public.sow_deliverables (engagement_id);

-- Widen chunks to accept SOW content alongside Jira/GitHub/Confluence.
ALTER TABLE public.chunks DROP CONSTRAINT IF EXISTS chunks_source_type_check;
ALTER TABLE public.chunks ADD CONSTRAINT chunks_source_type_check
    CHECK (source_type IN ('jira_ticket', 'github_commit', 'github_pr', 'confluence_doc', 'sow_document'));

-- ingestion_logs from TASK_admin_panel.md — never migrated into the real DB
-- either. The SOW pipeline writes here on both success and failure so
-- /admin/logs has real rows instead of the empty state it has today.
CREATE TABLE IF NOT EXISTS public.ingestion_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id TEXT NOT NULL REFERENCES public.projects(engagement_id) ON DELETE CASCADE,
    source        TEXT NOT NULL,
    message       TEXT NOT NULL,
    level         TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_logs_engagement
    ON public.ingestion_logs (engagement_id, created_at DESC);
