-- Real staffing for a project: who's assigned, what department they're
-- from, and what role they hold on THIS engagement. Previously the wizard's
-- Team step (Step 5) only ever wrote to component state backed by
-- src/lib/mockData's allUsers list — closing the tab lost every assignment,
-- and there was no way to tell if someone was already staffed on another
-- active engagement before double-booking them.
--
-- This app's login users live in Prisma/SQLite on the Node side (see
-- prisma/schema.prisma), not in this Postgres instance, so project_members
-- intentionally stores the person's details directly (name/email/department)
-- rather than an FK to a users table that isn't reachable from here — same
-- reasoning admin_projects.py already documented for why Team was mock-only.
--
-- Run after database/sow.sql (public.projects must already exist).

CREATE TABLE IF NOT EXISTS public.project_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id   TEXT NOT NULL REFERENCES public.projects(engagement_id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL,
    department      TEXT,
    role            TEXT NOT NULL DEFAULT 'Developer'
                        CHECK (role IN ('Manager', 'Developer', 'QA', 'Designer', 'Observer')),
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Same person can't be added twice to the same project.
    UNIQUE (engagement_id, email)
);

-- Used both to list a project's roster and to answer "is this email already
-- staffed anywhere else" when the admin adds a member (the flag-on-conflict
-- check).
CREATE INDEX IF NOT EXISTS idx_project_members_engagement
    ON public.project_members (engagement_id);
CREATE INDEX IF NOT EXISTS idx_project_members_email
    ON public.project_members (email);

-- Micro feature: a human-readable engagement code (PRJ-2026-0007) instead of
-- the raw slug-plus-hex engagement_id, the way a mid-size firm's PM tooling
-- numbers real client engagements.
CREATE SEQUENCE IF NOT EXISTS public.project_code_seq START 1;

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS project_code TEXT UNIQUE;

UPDATE public.projects
SET project_code = 'PRJ-' || to_char(created_at, 'YYYY') || '-' || lpad(nextval('public.project_code_seq')::text, 4, '0')
WHERE project_code IS NULL;

-- Every new project gets one automatically — the wizard's create-project
-- endpoint doesn't need to know this column exists.
ALTER TABLE public.projects ALTER COLUMN project_code
    SET DEFAULT ('PRJ-' || to_char(NOW(), 'YYYY') || '-' || lpad(nextval('public.project_code_seq')::text, 4, '0'));
