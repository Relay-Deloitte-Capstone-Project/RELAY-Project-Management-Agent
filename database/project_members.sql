-- SUPERSEDED — NOT APPLIED, kept for history only.
-- backend/scripts/apply_migrations.py skips this file by name.
--
-- This table requires a "User" row inside THIS Postgres instance (the FK
-- below), but Prisma's login users are a separate SQLite database
-- (prisma/schema.prisma, provider "sqlite") this backend can't query — so
-- it could never really be built the way this file describes. The
-- access-control feature this was for (backend/api/access.py) was rewired
-- to check public.project_staffing by email instead, which needs no
-- cross-database FK. See database/project_staffing.sql.
--
-- Per-project access control (SOW deliverable D6 — "Provenance & Read-Time
-- Permission Evaluation"): which app user can read which project's data.
--
-- project_members is the single source of truth, keyed by the Prisma
-- "User".id (both tables live in the same Postgres — prisma db push put
-- auth here, see prisma/schema.prisma), so the FK is real and deleting a
-- user or a project cleans up its memberships automatically.
--
-- Enforcement lives in backend/api/access.py: ADMINs read every project,
-- everyone else (DEVELOPER / MANAGER / OBSERVER) reads only projects they
-- hold a membership row for. Checked on every Ask Project message — not
-- just at session creation — so revoking a membership takes effect on the
-- user's next query, with no cache flush or restart.
--
-- Run after database/sow.sql (public.projects must already exist) and after
-- prisma db push ("User" must already exist).

CREATE TABLE IF NOT EXISTS public.project_members (
    engagement_id   TEXT NOT NULL REFERENCES public.projects(engagement_id) ON DELETE CASCADE,
    user_id         TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'DEVELOPER'
                    CHECK (role IN ('DEVELOPER', 'MANAGER', 'OBSERVER')),
    added_by        TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (engagement_id, user_id)
);

-- Preserve current behaviour: every existing account keeps access to the
-- original corpus project (RELAY_ENGAGEMENT_ID, 'proj-001'), which is what
-- all Jira/GitHub chunks are under today. Without this, turning enforcement
-- on would lock every current user out of Ask Project. Idempotent — safe to
-- re-run.
INSERT INTO public.project_members (engagement_id, user_id, role, added_by)
SELECT 'proj-001', id, 'DEVELOPER', 'migration:project_members.sql'
FROM "User"
ON CONFLICT (engagement_id, user_id) DO NOTHING;
