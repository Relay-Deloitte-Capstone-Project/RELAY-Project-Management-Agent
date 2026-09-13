-- Per-project Jira/GitHub-shaped workspace data for engagements that don't
-- have a real live Jira connection wired up (today, that's every project
-- except proj-001/Apache Kafka — see backend/api/jira_client.py, which is a
-- single globally-configured connection to one Jira site, not multi-tenant).
--
-- Rather than fabricate fake external Jira/GitHub links on a project's
-- record (which would be exactly the kind of "looks real but isn't" UI the
-- footer/tickets cleanup earlier was about removing), this stores realistic
-- internal tracking data directly, scoped by engagement_id like everything
-- else (chunks, sow_documents, project_members). backend/api/project.py
-- reads from these tables for any engagement_id other than the one real
-- Jira project; the UI shape is identical either way, so the dashboards
-- don't need to know or care which source answered.
CREATE TABLE IF NOT EXISTS public.project_tickets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id   TEXT NOT NULL REFERENCES public.projects(engagement_id) ON DELETE CASCADE,
    ticket_key      TEXT NOT NULL,
    summary         TEXT NOT NULL,
    issue_type      TEXT NOT NULL DEFAULT 'Task' CHECK (issue_type IN ('Epic', 'Story', 'Task', 'Bug')),
    status          TEXT NOT NULL DEFAULT 'To Do' CHECK (status IN ('To Do', 'In Progress', 'Done')),
    priority        TEXT DEFAULT 'Medium',
    assignee_name   TEXT,
    assignee_email  TEXT,
    epic_key        TEXT,
    labels          TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (engagement_id, ticket_key)
);

CREATE INDEX IF NOT EXISTS idx_project_tickets_engagement
    ON public.project_tickets (engagement_id);

CREATE TABLE IF NOT EXISTS public.project_commits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id   TEXT NOT NULL REFERENCES public.projects(engagement_id) ON DELETE CASCADE,
    sha             TEXT NOT NULL,
    message         TEXT NOT NULL,
    author_name     TEXT,
    branch          TEXT DEFAULT 'main',
    committed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (engagement_id, sha)
);

CREATE INDEX IF NOT EXISTS idx_project_commits_engagement
    ON public.project_commits (engagement_id);
