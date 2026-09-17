# CHAT_DB_SYNC_PLAN — One database, three zones, live sync, per-developer chat memory

This is the working plan for (a) per-developer chat persistence, (b) the "two databases?"
question, and (c) keeping the deployed Postgres in sync with live Jira and GitHub.
Status markers: ✅ implemented, 🔜 later/optional.

---

## 1. The "two databases" question — answered

**We keep ONE Neon Postgres. Zones are schemas inside it, not separate databases.**

```
Neon project (one DATABASE_URL)
├── raw.*       ZONE 1 — raw Jira/GitHub payloads, exactly as the APIs returned them
├── public.*    ZONE 2 — searchable layer: chunks + embeddings (the only schema
│                        the query API reads), sync_state
└── zone3.*     ZONE 3 — per-developer private data: chat sessions, messages,
                         message_sources, scratchpad
```

Why one DB and not two:

- Render backend, Prisma frontend, and the sync poller all share one `DATABASE_URL`.
  A second database would mean a second Neon project (free tier: 1 project), a second
  connection pool, and cross-database joins become impossible (zone3.message_sources
  references public.chunks by chunk_id — trivial in one DB, painful across two).
- Deployment does not change at all: same Render web service, same Neon project,
  same Vercel frontend. Schemas are created once by running `database/zone1.sql`
  and `database/zone3.sql` against the existing database.
- Zone separation is still real: the API never reads `raw.*`, and zone3 rows are
  always filtered by `user_id` — the boundary is logical-by-convention today and
  can be hardened with Postgres roles/RLS later without moving any data.

## 2. Zone 1 — raw ingestion layer ✅

`database/zone1.sql`:

- `raw.jira_tickets` (ticket_key PK, summary/status/assignee/type/priority, jira_created,
  jira_updated, full `payload` JSONB, synced_at)
- `raw.github_commits` (sha PK, repo, author, message, committed_at, payload, synced_at)
- `raw.github_prs` (repo+number PK — **PRs had no home at all before this**)
- `public.sync_state` (source PK, last_synced_at, cursor, last_status, last_count) —
  the poller's bookmarks so each run only fetches what changed.

The API never queries `raw.*`. It exists so we can re-chunk/re-embed without re-hitting
the APIs, and so nothing from Jira/GitHub is ever lost.

## 3. Zone 3 — per-developer chat memory ✅

`database/zone3.sql` (applied to Neon) + `backend/api/sessions.py`:

- `chat_sessions` — one row per conversation per developer (`user_id`, `engagement_id`,
  `title` auto-set from first message, `last_message_at` for sidebar ordering).
- `chat_messages` — every user/assistant message, with `llm_model`, `latency_ms`,
  `chunk_count`, `abstained` on assistant rows (powers "gemini · 3 sources · 1.2s").
- `message_sources` — one row per citation (message_id → chunk_id, source_doc_id,
  source_type, snippet). This replaces the `cited_chunk_ids` array going forward
  (the array is still written for backward compatibility with older history).
  Per the spec, this makes revocation lookup ("every message that cited chunk X")
  an indexed lookup and lets a revoked citation be tombstoned without editing the
  message text.

How context works per session (already live): the last 6 messages are read before
each answer; short pronoun-y follow-ups ("what about the second one?") are rewritten
into standalone questions with one cheap LLM call before retrieval; the last 4
exchanges are injected into the answer prompt as conversation context.

On "if it was asked before, reuse the old answer": we deliberately do **not** cache
answers. The database is now live-synced (§4), so a cached answer can silently go
stale — the exact failure this plan fixes. Every Q&A is permanently stored per
developer → per session, and re-asking is cheap and always current. (A semantic
FAQ cache keyed on question embedding is a possible later optimization — noted,
not built.)

## 4. Live sync — Jira, commits, PRs ✅

`backend/api/sync.py`, driven by a background asyncio task started in the FastAPI
lifespan (`backend/main.py`). Every `SYNC_INTERVAL_MINUTES` (default 5, env-configurable):

| Source | What it pulls | What it writes |
|---|---|---|
| Jira | `search/jql` — issues with `updated >= <cursor>` (full pull on first run) | upsert `raw.jira_tickets`; upsert the matching `public.chunks` row — content + metadata (status, assignee) refreshed; **re-embedded only when summary/description actually changed** |
| GitHub commits | `GET /repos/{repo}/commits?since=<cursor>` | insert `raw.github_commits` + a new chunk per commit (message, sha_short, ticket_refs parsed from the message — never the code itself) |
| GitHub PRs | `GET /repos/{repo}/pulls?state=all&sort=updated` | upsert `raw.github_prs` + chunks with `source_type='github_pr'` (title, body, state, author, ticket_refs) |

- New/changed Jira tickets, assignee changes, and status moves (To Do → Done)
  appear in search within one poll interval.
- **Instant path**: `POST /api/sync/ticket/{key}` re-syncs one Jira issue on demand —
  wire the app's "change assignee" action to call this right after the Jira update
  succeeds, so the change is searchable immediately. `POST /api/sync?full=true`
  forces a full re-pull (recovery). `GET /api/sync/status` shows per-source
  last-run status/count.
- Code is still never stored: commit chunks carry message + metadata only; live
  diffs are fetched at query time by `github_client` when someone asks for code.
- `SYNC_ENABLED=false` disables the poller (e.g. a local instance pointed at prod).

### Why a poller and not webhooks (for now)

Render's free tier has no cron and no second service — the poller runs inside the
existing web service for free. Jira/GitHub webhooks → `/api/webhooks/*` calling the
same upsert functions is the natural instant-upgrade and is 🔜 optional: it needs
dashboard access to both apps, and the 5-minute poll already meets the demo need.

## 5. Guardrails (unchanged, now enforced by tests)

- Answers only from project records; abstain plainly when there's no grounding.
- Out-of-project requests (general coding help) are declined in one sentence,
  citing nothing.
- `backend/scripts/eval_ask.py` + `eval_cases.json` is the regression harness —
  11 golden cases (assignee filter, ticket describe present/absent, sprint,
  overview, code snippet, guardrail, semantic search). Run it after every
  prompt/intent change: `cd backend && ../relay_env/bin/python scripts/eval_ask.py`.
  Exit code 1 on any failure — treat it as the gate before pushing.

## 6. Deploy / operate

One-time on Neon: run `database/zone1.sql` and `database/zone3.sql` (already applied).
Render env to confirm: `DATABASE_URL` (pooler), `JIRA_*`, `GITHUB_TOKEN`,
`GITHUB_REPO=Anya-Gupta-05/relay-Data-Agent`, `SYNC_INTERVAL_MINUTES` (optional),
`LLM_PROVIDER_CHAIN`, `GEMINI_MODEL=gemini-3.5-flash`.

## 7. What still needs a human

- Jira/GitHub webhook configuration (optional §4 upgrade) — needs admin logins.
- Cerebras quota (402) — dashboard issue, key is valid.
- Wiring the frontend's assignee-change action to `POST /api/sync/ticket/{key}` —
  a one-line fetch in whichever route performs the Jira update.
