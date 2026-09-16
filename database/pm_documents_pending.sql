-- Classification happens at upload time, but nothing becomes searchable
-- (no public.chunks rows) until a human confirms it in the review UI — an
-- unreviewed classification could have the wrong doc_type or a garbled
-- section split, and public.chunks has no "under review" flag search
-- already knows to skip. Storing the extracted sections here until confirm
-- keeps a bad classification from ever being citable in an Ask Project
-- answer, the same abstain-rather-than-guess principle the query pipeline
-- already applies to answering — applied here to ingestion instead.
ALTER TABLE public.pm_documents
    ADD COLUMN IF NOT EXISTS pending_sections JSONB NOT NULL DEFAULT '[]';
