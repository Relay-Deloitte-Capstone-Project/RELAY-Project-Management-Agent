-- Onboarding Kit: a one-time capture of live project state for a new
-- developer joining an engagement, not a live view. Every other page in
-- this app reads fresh on every request; this table exists specifically to
-- freeze a snapshot at creation time, so a new hire's day-1 material
-- doesn't shift under them between when a manager builds it and when the
-- person actually reads it. "Re-create" (api/onboarding.py) overwrites the
-- row in place — explicit manager action only, never automatic.

CREATE TABLE IF NOT EXISTS public.onboarding_kits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engagement_id   TEXT NOT NULL REFERENCES public.projects(engagement_id) ON DELETE CASCADE,
    developer_email TEXT NOT NULL,
    developer_name  TEXT NOT NULL,
    content         JSONB NOT NULL,
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (engagement_id, developer_email)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_kits_engagement
    ON public.onboarding_kits (engagement_id);
