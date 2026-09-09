# AGENTS.md

This repo is a standard shared team repository (the initial frontend was
exported from Lovable once; it is **no longer connected to Lovable**).

- `main` is connected to auto-deploys (Vercel frontend, Render backend) — every
  push to `main` redeploys production.
- **Never commit or push feature work directly to `main`.** All new work and
  updates happen on feature branches: build → review/test locally → push the
  branch → open a PR → merge only when 100% certain it won't break the demo.
  Don't force-push shared history.
- Deployment runbook: see `DEPLOY.md`.
