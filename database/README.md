# Applying database changes

**After pulling any branch that adds or changes a file in this folder, run:**

```bash
cd backend
.venv/bin/python scripts/apply_migrations.py
```

## Why this is required — read this before adding a new `.sql` file here

`docker-compose.yml` mounts a few of these files into Postgres's
`docker-entrypoint-initdb.d/`, which looks like it "just works" — but that
mechanism only runs **once**, the very first time the `pgdata` volume is
created. It has not run again since, and never will on this shared database.
Every file added to this folder after that first boot — several of them,
across several branches — sat here doing nothing until someone happened to
run it by hand. That silent gap caused real, repeated outages: code and
routes shipped expecting tables that only existed as `.sql` text in the
repo, never in the actual database. A clean `git merge` does not run SQL, so
this class of drift is invisible to git and to code review.

`apply_migrations.py` fixes this: it tracks every file it has run in
`public.schema_migrations` (filename + content checksum) and applies
whatever's new. It's safe to run any time, including with nothing new to do.
If a **previously-applied** file's content changes, it's flagged instead of
silently re-run — a changed migration usually means an `ALTER` that would
error or double-apply, and a human should look at it.

## Writing a new migration

- Every statement must be idempotent: `CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. This is what
  makes it safe to apply a file more than once and safe to run this whole
  script with no risk to existing data — nothing here should ever `DROP` or
  destructively `ALTER` a table that might hold real rows.
- Never rename or delete an existing file once it's been applied anywhere —
  `apply_migrations.py` tracks by filename. Add a new file for a new change
  instead.
- `init.sql` and `relay_db_dump.sql` are excluded on purpose (see
  `NEVER_APPLY` in the script) — the first is the one-time Docker bootstrap,
  the second is a full snapshot dump, not an incremental change.
