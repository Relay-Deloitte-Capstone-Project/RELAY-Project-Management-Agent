-- Zone 1 — raw ingestion layer: Jira tickets, GitHub commits, GitHub PRs,
-- exactly as the APIs returned them, plus the sync-state bookkeeping the
-- live-sync poller (backend/api/sync.py) uses to stay incremental.
--
-- The query API never reads from raw.* — public.chunks (zone 2) stays the
-- only search layer. raw.* exists so the pipeline can re-process (re-chunk,
-- re-embed) without re-hitting the Jira/GitHub APIs, and so PRs — which
-- never had a home in the chunks-only dump — are stored at all.

CREATE SCHEMA IF NOT EXISTS raw;

CREATE TABLE IF NOT EXISTS raw.jira_tickets (
    ticket_key    TEXT PRIMARY KEY,
    summary       TEXT,
    status        TEXT,
    assignee      TEXT,
    issue_type    TEXT,
    priority      TEXT,
    jira_created  TIMESTAMPTZ,
    jira_updated  TIMESTAMPTZ,
    payload       JSONB NOT NULL,          -- full API response, untouched
    synced_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.github_commits (
    sha           TEXT PRIMARY KEY,
    repo          TEXT NOT NULL,
    author        TEXT,
    message       TEXT,
    committed_at  TIMESTAMPTZ,
    files_changed INTEGER,
    payload       JSONB NOT NULL,
    synced_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw.github_prs (
    repo          TEXT NOT NULL,
    number        INTEGER NOT NULL,
    title         TEXT,
    state         TEXT,
    author        TEXT,
    pr_created    TIMESTAMPTZ,
    pr_updated    TIMESTAMPTZ,
    payload       JSONB NOT NULL,
    synced_at     TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (repo, number)
);

-- One row per synced source: the poller's cursor so each run only fetches
-- what changed since the last one.
CREATE TABLE IF NOT EXISTS public.sync_state (
    source         TEXT PRIMARY KEY,       -- 'jira' | 'github_commits' | 'github_prs'
    last_synced_at TIMESTAMPTZ,
    cursor         TEXT,                   -- e.g. 'since' ISO timestamp for GitHub
    last_status    TEXT,                   -- 'ok' or the error message
    last_count     INTEGER                 -- rows upserted on the last run
);
