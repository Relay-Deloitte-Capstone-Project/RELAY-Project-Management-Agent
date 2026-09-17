# Relay

Relay is a project-management dashboard for engineering delivery teams. It
gives developers, managers, and admins role-specific views over the same
live project data — Jira tickets, GitHub commits, SOW documents, and team
staffing — and includes **Ask Project**, a chat feature that answers
questions about a project from its own indexed Jira/GitHub/SOW records, with
citations, and an honest "I don't know" when nothing relevant is indexed.

## Stack

- **Frontend**: [TanStack Start](https://tanstack.com/start) (React,
  file-based routing under `src/routes/`), deployed on Vercel.
- **Backend**: FastAPI (`backend/`), deployed on Render as a Docker web
  service. Owns the Jira/GitHub sync, the Ask Project RAG pipeline
  (`bge-small-en-v1.5` embeddings + pgvector + Gemini/Groq), and all
  role/staffing-gated data endpoints.
- **Database**: Postgres (Neon in production). Prisma (`prisma/`) owns
  auth/session/user tables; the rest of the schema (`database/*.sql`) is
  applied directly — see [`database/README.md`](database/README.md) for why
  that matters.

## Roles

- **Developer** — their own onboarding kit, assigned work, sprint coverage,
  and Ask Project for their project.
- **Manager** — team overview, handover/onboarding kits for their reports,
  scope tracking, PM documents, and analytics for their project.
- **Admin** — every project, user management, knowledge base, SOW/document
  governance, and system configuration.

## Local development

Requires Node.js and [pnpm](https://pnpm.io) — **use `pnpm`, not `npm` or
`bun`**, for both installing and running this project; the dev server has a
hard dependency on pnpm's `node_modules` layout.

```sh
pnpm install
pnpm exec prisma generate
pnpm run dev
```

The backend runs separately — see [`backend/README.md`](backend/README.md).

## Documentation

- [`docs/DEPLOY.md`](docs/DEPLOY.md) — free-tier deployment runbook (Neon +
  Render + Vercel).
- [`backend/README.md`](backend/README.md) — Ask Project's RAG pipeline.
- [`database/README.md`](database/README.md) — how schema changes in
  `database/*.sql` get applied (read before adding a new `.sql` file).
- [`docs/plans/`](docs/plans/) — design/planning docs written while building
  each feature, kept for historical context.
- [`AGENTS.md`](AGENTS.md) — branching and deploy conventions.
