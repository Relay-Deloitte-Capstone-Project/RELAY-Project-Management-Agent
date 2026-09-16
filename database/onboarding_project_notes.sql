-- Team Norms is the one onboarding-kit section with no live source (how the
-- team communicates, PR/branch conventions) — a manager writes it once per
-- engagement, not once per new hire. Every other "common" section
-- (orientation, access & setup, glossary, who-to-ask, areas in motion,
-- coverage guidance, scope summary) is recomputed live and never stored
-- until a specific person's kit freezes a snapshot of it — see
-- public.onboarding_kits (database/onboarding_kits.sql).

CREATE TABLE IF NOT EXISTS public.onboarding_project_notes (
    engagement_id TEXT PRIMARY KEY REFERENCES public.projects(engagement_id) ON DELETE CASCADE,
    team_norms    TEXT NOT NULL DEFAULT '',
    updated_by    TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
