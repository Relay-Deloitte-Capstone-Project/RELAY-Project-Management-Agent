-- Environment & Setup is the second onboarding-kit section with no live
-- source (how to actually run the client's codebase locally — clone URL,
-- install steps, env vars, how to run tests). Same reasoning as
-- onboarding_project_notes.team_norms: a manager writes it once per
-- engagement, every kit created afterward picks it up automatically.

ALTER TABLE public.onboarding_project_notes
    ADD COLUMN IF NOT EXISTS env_setup TEXT NOT NULL DEFAULT '';
