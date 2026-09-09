# DEPLOY.md — Free-tier deployment (Neon + Render + Vercel)

Architecture: **Vercel** hosts the TanStack Start frontend (SSR via Nitro's
`vercel` preset), **Render** hosts the FastAPI backend as a persistent free web
service, **Neon** hosts one free Postgres database (with pgvector) shared by the
backend corpus tables and the Prisma auth tables.

Do the steps in this exact order — each step produces a value the next one needs.

---

## Step 0 — Rotate the leaked GitHub token (do this first)

A GitHub personal access token was committed to this repo (in
`project-memory-explore/`). It must be considered compromised:

1. Go to <https://github.com/settings/tokens> and **revoke/delete** the token.
   If you're unsure which one it is, revoke any PAT you don't actively need.
2. The files have already been scrubbed (`github_token.txt` deleted,
   `test_mcp_connection.py` now reads the token from the environment). Do **not**
   rewrite git history — this repo is connected to Lovable, and revocation alone
   fully kills the leaked token.
3. If you ever pasted Groq or Gemini keys anywhere public, rotate those too:
   <https://console.groq.com/keys> and <https://aistudio.google.com/apikey>.

## Step 1 — Neon (database first)

1. Sign up at <https://neon.tech> (free), create a project (e.g. `relay`),
   any region close to your Render/Vercel regions.
2. In the Neon dashboard, enable the vector extension — SQL Editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Copy **two** connection strings from the dashboard (Connection Details):
   - the **pooled** one (host contains `-pooler`) → used by Vercel and as your
     local `DATABASE_URL` for step 2
   - the **direct** one → used by Render (a persistent service doesn't need the
     pooler, but the pooled one also works if you only saved one)
4. Load the corpus data. From the repo root, with `psql` installed:
   ```bash
   export NEON_URL="postgresql://...direct-connection-string..."
   # The dump is pg_dump output whose ALTER ... OWNER TO pm_user lines would
   # fail on Neon (that role doesn't exist there) — strip them:
   grep -v 'OWNER TO' database/relay_db_dump.sql > /tmp/relay_restore.sql
   psql "$NEON_URL" -f /tmp/relay_restore.sql
   # Zone 3 tables (chat sessions, scratchpad) are not in the dump:
   psql "$NEON_URL" -f database/zone3.sql
   # init.sql set ivfflat.probes on the pm_user role; on Neon set it on the
   # database instead so every connection inherits it:
   psql "$NEON_URL" -c "ALTER DATABASE neondb SET ivfflat.probes = 10;"
   ```
   Sanity check:
   ```bash
   psql "$NEON_URL" -c "SELECT count(*) FROM public.chunks;"
   ```

## Step 2 — Prisma auth tables + seed users

The app stores login users/sessions via Prisma. **Do not use `prisma db push`** —
it tries to make the whole database match the Prisma schema and will offer to
drop `public.chunks` (the RAG corpus) and `public.user_permissions`. Instead,
generate DDL for just the two auth tables and apply it directly:

```bash
export $(grep -v '^#' .env.local | xargs)   # loads the Neon DATABASE_URL
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /tmp/auth_tables.sql
npx prisma db execute --file /tmp/auth_tables.sql --schema prisma/schema.prisma
node prisma/seed.ts   # or: bun prisma db seed
```

This creates the roster from `prisma/seed.ts` (anya@relay.dev, adveita@relay.dev,
akshar@relay.dev, agrim@relay.dev, shubhr@relay.dev, priya@relay.dev,
jason@relay.dev, omar@relay.dev) — **all with password `relay2026`**. Change this
before sharing widely if it matters to you. Note the seed wipes and recreates all
users each run.

> `db push`/`migrate deploy` are both avoided: the existing `prisma/migrations/`
> were written for SQLite, and `db push` would drop the backend's tables.

## Step 3 — Render (backend)

1. Push this repo to GitHub (Render deploys from git).
2. Render dashboard → **New → Blueprint** → select the repo. It picks up
   `render.yaml` and creates the `relay-backend` web service (free plan).
3. Open the service → **Environment** and set the `sync: false` variables:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon **direct** connection string from step 1 |
   | `GROQ_API_KEY` | your key from <https://console.groq.com/keys> (free) |
   | `GOOGLE_GEMINI_API` | your key from <https://aistudio.google.com/apikey> (fallback; optional but recommended) |
   | `CORS_ORIGINS` | `http://localhost:3000` for now — replaced with the Vercel URL in step 5 |

   `LLM_PROVIDER`, `GROQ_MODEL`, `GEMINI_MODEL`, `RELAY_ENGAGEMENT_ID` already
   have defaults in `render.yaml`.
4. Wait for the deploy, then verify:
   ```bash
   curl https://<your-service>.onrender.com/health   # {"status":"ok"}
   ```
   Copy the service URL — the frontend needs it next.

**Free-tier caveats:** the service sleeps after ~15 min idle; the first request
after sleep takes ~30–60 s (embedding model load). If deploys fail with
out-of-memory in the logs (torch + sentence-transformers on 512 MB RAM),
upgrade the service to Starter ($7/mo) — there is no free-tier fix beyond the
CPU-torch pin already in `render.yaml`.

## Step 4 — Vercel (frontend)

1. Vercel dashboard → **Add New → Project** → import the same GitHub repo.
   `vercel.json` already sets the install/build commands
   (`NITRO_PRESET=vercel bun run build`); leave the framework preset as detected.
2. Add environment variables (**all environments** — they're needed at build
   time too):

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon **pooled** connection string from step 1 |
   | `JWT_SECRET` | a fresh random string, 32+ chars (`openssl rand -hex 32`) |
   | `VITE_ASK_API_URL` | `https://<your-service>.onrender.com` from step 3 |

3. Deploy. When it finishes, copy your site URL (`https://<app>.vercel.app`).

> `VITE_ASK_API_URL` is inlined at build time. If the backend URL ever changes,
> update the variable and **redeploy** — it will not change on its own.

## Step 5 — Backfill CORS + smoke test

1. Render → `relay-backend` → Environment → set
   `CORS_ORIGINS=https://<app>.vercel.app` (comma-separate to add more origins,
   e.g. a preview domain). Save — Render redeploys automatically.
2. Smoke test in the browser:
   - Open `https://<app>.vercel.app`, log in as `anya@relay.dev` / `relay2026`.
   - Ask Project page: ask a question — expect an answer with citations
     (first call may take ~60 s if Render was asleep).
   - Dashboard pages render burndown/breakdown charts (they hit the backend's
     analytics endpoints).
3. If the browser console shows CORS errors, the `CORS_ORIGINS` value doesn't
   exactly match the origin (scheme + host, no trailing slash).

---

## Manual steps I could not do for you

- Creating the Neon, Render, and Vercel accounts and connecting the GitHub repo.
- Revoking the leaked GitHub token (step 0) — only you can do this.
- Pasting the environment variables into the Render and Vercel dashboards.
- Supplying Groq/Gemini API keys (free sign-ups at the links above).
- Running steps 1–2 against your Neon database (unless you put the Neon URL in
  your local `.env` and ask me to run them).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Render logs show `DATABASE_URL must point at the Relay postgres instance` | You pasted the Prisma-style URL into the wrong place, or it doesn't start with `postgresql://` |
| Render OOM / deploy loops | Free-tier RAM limit; upgrade to Starter or shrink the embedding model |
| Vercel SSR 500 on login | `DATABASE_URL` or `JWT_SECRET` missing in Vercel env; redeploy after adding |
| `prisma` errors about SQLite | Stale generated client; `bun prisma generate` then redeploy |
| Answers come back generic / no citations | `ivfflat.probes` not set — rerun the `ALTER DATABASE ... SET ivfflat.probes = 10;` from step 1 |
