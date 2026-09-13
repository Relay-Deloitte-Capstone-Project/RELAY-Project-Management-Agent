-- Splits the setup wizard's per-step data off public.projects into its own
-- linked tables, one per connectable source/step — same pattern SOW already
-- uses (sow_documents/sow_deliverables, database/sow.sql) instead of
-- widening the core projects row further. public.projects stays the
-- identity + lifecycle record (name, client, status, dates); everything a
-- wizard step collects lives in a table keyed by engagement_id, so each
-- step can be created, updated or torn down (e.g. on offboarding) on its
-- own instead of one row accreting unrelated columns.
--
-- Run after database/sow.sql (public.projects must already exist).

CREATE TABLE IF NOT EXISTS public.project_jira_links (
    engagement_id   TEXT PRIMARY KEY REFERENCES public.projects(engagement_id) ON DELETE CASCADE,
    base_url        TEXT,
    project_key     TEXT NOT NULL,
    connected_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.project_github_links (
    engagement_id   TEXT PRIMARY KEY REFERENCES public.projects(engagement_id) ON DELETE CASCADE,
    repo_url        TEXT NOT NULL,
    branch          TEXT NOT NULL DEFAULT 'main',
    connected_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Retention/DPA are collected in the wizard's SOW step but are contract
-- governance facts, not SOW-document facts — they apply even when a
-- project skips SOW upload entirely. Kept separate from sow_documents for
-- that reason, one row per project rather than per uploaded document.
CREATE TABLE IF NOT EXISTS public.project_governance (
    engagement_id   TEXT PRIMARY KEY REFERENCES public.projects(engagement_id) ON DELETE CASCADE,
    retention_days  INTEGER,
    dpa_reference   TEXT,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Carry over anything already sitting in the old flat columns before they're dropped.
INSERT INTO public.project_jira_links (engagement_id, base_url, project_key)
SELECT engagement_id, jira_base_url, jira_project_key
FROM public.projects
WHERE jira_project_key IS NOT NULL
ON CONFLICT (engagement_id) DO NOTHING;

INSERT INTO public.project_github_links (engagement_id, repo_url)
SELECT engagement_id, github_repo_url
FROM public.projects
WHERE github_repo_url IS NOT NULL
ON CONFLICT (engagement_id) DO NOTHING;

INSERT INTO public.project_governance (engagement_id, retention_days, dpa_reference)
SELECT engagement_id, retention_days, dpa_reference
FROM public.projects
WHERE retention_days IS NOT NULL OR dpa_reference IS NOT NULL
ON CONFLICT (engagement_id) DO NOTHING;

ALTER TABLE public.projects
    DROP COLUMN IF EXISTS jira_project_key,
    DROP COLUMN IF EXISTS jira_base_url,
    DROP COLUMN IF EXISTS github_repo_url,
    DROP COLUMN IF EXISTS retention_days,
    DROP COLUMN IF EXISTS dpa_reference;
