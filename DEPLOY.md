# DEPLOY.md — Free-tier deployment with live sync (Neon + Render + Vercel)

Architecture: **Vercel** hosts the TanStack Start frontend (SSR via Nitro's
`vercel` preset, auto-redeploys on every push to `main`), **Render** hosts the
FastAPI backend as a **Docker** web service (`backend/Dockerfile`, auto-redeploys
on every push to `main`), **Neon** hosts the single Postgres database (with
pgvector) shared by the backend corpus and the Prisma auth tables.

> **Status tracker** — already done: Neon database is live and populated
> (1070 corpus chunks, auth tables, 8 seeded users). Remaining: steps 0, 1, 3, 4, 5.

---

## Step 0 — Rotate the leaked GitHub token (do this first)

A GitHub personal access token was committed to this repo (in
`project-memory-explore/`). The files have been scrubbed, but the token must be
considered compromised:

1. Go to <https://github.com/settings/tokens> and **revoke/delete** the token.
2. If you ever pasted Groq or Gemini keys anywhere public, rotate those too:
   <https://console.groq.com/keys> and <https://aistudio.google.com/apikey>.

## Step 1 — Make the repo connectable (prerequisite for live sync)

The repo is **private** under the `Anya-Gupta-05` personal account, and
Vercel/Render only show repos from accounts you control. Fix by moving the repo
— a GitHub transfer **preserves all history, issues, and collaborators** (Anya
keeps full access) and the old URL auto-redirects, so teammates' local clones
keep working untouched.

Two ways, pick one:

1. **Organization (recommended for a team)**: you create a free org
   (github.com → your avatar → Your organizations → New organization, free
   plan), then Anya does repo → Settings → General → Danger Zone →
   **Transfer ownership** → your new org. You install the Vercel + Render
   GitHub Apps on the org yourself — no further approvals needed.
2. **Straight transfer**: Anya transfers the repo to your personal account
   (same Danger Zone flow). She remains a collaborator automatically.

After the transfer, the repo appears in your Render and Vercel repo pickers —
continue to step 3.

## Step 2 — Neon database (ALREADY DONE — reference for re-runs)

Project `royal-paper-12455656`, branch `production`. Connection strings live in
`.env.local` (gitignored): `DATABASE_URL` (pooled, for Vercel) and
`DATABASE_URL_UNPOOLED` (direct, for Render).

If you ever rebuild the database from scratch:

```bash
export NEON_URL="postgresql://...direct-connection-string..."
psql "$NEON_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
grep -v 'OWNER TO' database/relay_db_dump.sql > /tmp/relay_restore.sql
psql "$NEON_URL" -f /tmp/relay_restore.sql
psql "$NEON_URL" -f database/zone3.sql
psql "$NEON_URL" -c "ALTER DATABASE neondb SET ivfflat.probes = 10;"
psql "$NEON_URL" -c "SELECT count(*) FROM public.chunks;"   # expect 1070
```

Auth tables + users (already applied):

```bash
export $(grep -v '^#' .env.local | xargs)
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/auth_tables.sql
npx prisma db execute --file /tmp/auth_tables.sql --schema prisma/schema.prisma
node prisma/seed.ts
```

**Never run `prisma db push` or `prisma migrate deploy` against this database** —
`db push` offers to drop `public.chunks` and `public.user_permissions` (the RAG
corpus), and the migrations folder was written for SQLite. Use the
`migrate diff` + `db execute` pattern above.

## Step 3 — Render (backend, Docker)

Prerequisite: step 1 approved.

1. Render dashboard → **New → Blueprint** → select the repo. Render reads
   `render.yaml` and creates the `relay-backend` web service: Docker runtime,
   builds `backend/Dockerfile`, free plan, **autoDeploy on** (every push to
   `main` rebuilds).
2. Open **relay-backend → Environment** and set the secret variables:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | `DATABASE_URL_UNPOOLED` from `.env.local` (direct Neon string) |
   | `GROQ_API_KEY` | your key from <https://console.groq.com/keys> (free) |
   | `GOOGLE_GEMINI_API` | your key from <https://aistudio.google.com/apikey> (recommended fallback) |
   | `CORS_ORIGINS` | `http://localhost:3000` for now — replaced with the Vercel URL in step 5 |

   `LLM_PROVIDER`, `GROQ_MODEL`, `GEMINI_MODEL`, `RELAY_ENGAGEMENT_ID` have
   defaults in `render.yaml`.
3. First Docker build takes ~10–15 min (torch + embedding model are baked into
   the image). When the service shows **Live**:
   ```bash
   curl https://<your-service>.onrender.com/health   # {"status":"ok"}
   ```
   Copy the service URL — the frontend needs it in step 4.

**Free-tier caveats:** the service sleeps after ~15 min idle; the first request
after sleep takes ~30–60 s. If the service crashes with out-of-memory in the
logs (torch on 512 MB RAM), upgrade to Starter ($7/mo) — there is no free-tier
fix beyond the CPU-torch pin already in the Dockerfile.

## Step 4 — Vercel (frontend)

Prerequisite: step 1 approved.

1. Vercel dashboard → **Add New → Project** → import the repo. `vercel.json`
   already sets the build (`NITRO_PRESET=vercel bun run build`); leave settings
   as detected.
2. Add environment variables (all environments — they're needed at build time):

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | `DATABASE_URL` (**pooled**) from `.env.local` |
   | `JWT_SECRET` | fresh random string, 32+ chars (`openssl rand -hex 32`) |
   | `VITE_ASK_API_URL` | `https://<your-service>.onrender.com` from step 3 |

3. Deploy, then copy your site URL (`https://<app>.vercel.app`).

> `VITE_ASK_API_URL` is inlined at build time. If the backend URL ever changes,
> update the variable and **redeploy** (Vercel → Deployments → ⋯ → Redeploy).

## Step 5 — Backfill CORS + smoke test

1. Render → relay-backend → Environment → set
   `CORS_ORIGINS=https://<app>.vercel.app` (comma-separate to add more origins).
   Saving redeploys automatically.
2. Smoke test in the browser:
   - Open `https://<app>.vercel.app`, log in as `anya@relay.dev` / `relay2026`.
   - Ask Project: ask a question — expect an answer with citations (first call
     may take ~60 s if Render was asleep).
   - Dashboard pages render burndown/breakdown charts.
3. CORS errors in the console mean `CORS_ORIGINS` doesn't exactly match the
   origin (scheme + host, no trailing slash).
4. **Prove live sync**: merge a tiny PR (e.g. edit a heading on a branch, merge
   it) and watch both dashboards redeploy. Frontend ~2 min, backend ~10 min
   (Docker rebuild).

---

## Day-2 workflows

### Code changes → live site (branch workflow — `main` is protected territory)

`main` auto-deploys to production, so **never push feature work directly to it**.
Three people are building in parallel; keep the demo site stable:

```bash
git checkout -b feature/my-thing     # branch off main
# ... build, then review and test everything LOCALLY first ...
git push -u origin feature/my-thing  # push the branch, not main
gh pr create                         # open a PR
# Vercel builds a free preview URL on the PR — demo the feature there first
# merge the PR only when 100% certain it won't break the deployed version
```

Merging to `main` is what deploys: Vercel redeploys the frontend (~2 min) and
Render rebuilds the backend Docker image (~10 min). Watch each dashboard's
deploy log if something looks off.

### Database edits that go live immediately

There is **one** database — Neon, in the cloud. There is no local↔cloud sync to
manage; edit it directly and the deployed app sees the change instantly:

```bash
export $(grep -v '^#' .env.local | xargs)
psql "$DATABASE_URL"          # or: edit rows in Neon's dashboard SQL Editor
```

This includes ingesting new Jira/GitHub data (`backend/scripts/`, `jira_toolkit.py`)
— point the script at the Neon URL and the deployed app answers from the new
chunks immediately.

### Live sync with Jira + GitHub (automatic)

The backend keeps the database in step with live Jira and GitHub on its own —
see `CHAT_DB_SYNC_PLAN.md` for the full design. A background task inside the
Render web service (`backend/api/sync.py`, started in `main.py`'s lifespan)
runs every `SYNC_INTERVAL_MINUTES` (default 5):

- Jira issues updated since the last run → status/assignee/description changes
  land in `public.chunks` (re-embedded only when the text changed).
- New GitHub commits → new chunk rows (message + metadata; never code).
- GitHub PRs → `raw.github_prs` + chunks with `source_type='github_pr'`.

Useful endpoints: `GET /api/sync/status` (per-source last run),
`POST /api/sync?full=true` (force full re-pull), `POST /api/sync/ticket/{key}`
(instant resync of one ticket — call this from the assignee-change UI action).
Set `SYNC_ENABLED=false` to disable the poller on an instance.

One-time setup for this (already applied to production Neon): run
`database/zone1.sql` and `database/zone3.sql` with psql.


### Safe database experiments (Neon branches)

Don't test destructive changes against `production`. Create an isolated branch
(a copy-on-write clone, free tier includes branches):

```bash
neon checkout -b dev-akshar     # creates + switches; .env.local now points at it
# ... experiment freely ...
neon checkout production        # switch back when done
neon branches delete dev-akshar
```

### Schema changes

1. Edit `prisma/schema.prisma` (auth tables) or the SQL files in `database/`.
2. Preview: `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url "$DATABASE_URL" --script`
3. Apply: `npx prisma migrate diff ... --script > /tmp/change.sql && npx prisma db execute --file /tmp/change.sql --schema prisma/schema.prisma`
4. For corpus/zone3 tables, write plain SQL and apply with `psql`.

### Users / seeds

Logins: anya@relay.dev, adveita@relay.dev, akshar@relay.dev, agrim@relay.dev,
shubhr@relay.dev, priya@relay.dev, jason@relay.dev, omar@relay.dev — all with
password `relay2026`. **Change this before sharing beyond the team.**
`node prisma/seed.ts` reseeds but **wipes all users first**.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Merged PR doesn't redeploy | Deploys trigger on `main` only; check the dashboard deploy log, and that `autoDeploy` is on in Render settings |
| Render logs: `DATABASE_URL must point at the Relay postgres instance` | Wrong URL pasted; must start with `postgresql://` (use the unpooled Neon string) |
| Render OOM / crash loop | 512 MB free-tier limit; upgrade to Starter ($7/mo) |
| Vercel SSR 500 on login | `DATABASE_URL` or `JWT_SECRET` missing in Vercel env; redeploy after adding |
| Prisma errors about SQLite | Stale generated client; `npx prisma generate` and redeploy |
| Generic answers / no citations | `ivfflat.probes` unset — rerun the `ALTER DATABASE ... SET ivfflat.probes = 10;` from step 2 |
| Vercel 500s: `__commonJSMin is not a function` | Known rolldown bug ([rolldown#9993](https://github.com/rolldown/rolldown/issues/9993)) with vite ≥8.1 — keep vite pinned at 8.0.x; do not upgrade without re-verifying the deployed bundle |
| Browser CORS errors | `CORS_ORIGINS` on Render must match the Vercel origin exactly |
