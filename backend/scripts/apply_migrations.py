"""Apply every not-yet-applied Postgres migration under database/*.sql.

Why this exists: database/docker-compose.yml mounts a handful of .sql files
into Postgres's docker-entrypoint-initdb.d/, but that only ever runs once —
the first time the pgdata volume is created. Every file added to database/
after that point (project_staffing.sql, project_workspace_data.sql, zone1.sql
and others) was never wired into that list, and even the ones that are never
re-run against an already-existing volume. The result, discovered the hard
way across several merges: code and frontend routes shipped expecting tables
that only ever existed as .sql files sitting in the repo, never applied to
the actual shared database. A clean git merge does not run SQL — that class
of drift is invisible to git entirely.

This script is the fix: it tracks which files have been applied in
public.schema_migrations (filename, checksum, applied_at) and applies
anything new, in order, each inside its own transaction. Run it:
  - after pulling any branch that touches database/*.sql
  - before trusting a fresh clone's database matches the code

Safe to run any time, including with no new files — it's a no-op then.
Every file in database/ is written with CREATE TABLE/COLUMN IF NOT EXISTS,
so applying an already-partially-applied file is safe; this script's own
tracking just avoids redoing the work and catches DRIFT (a tracked file
whose content changed since it was applied — flagged, never silently
re-run, since a changed ALTER could error or double-apply).

Usage (from backend/):
    .venv/bin/python scripts/apply_migrations.py
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv(Path(__file__).parent.parent.parent / ".env")

import asyncpg  # noqa: E402

DATABASE_DIR = Path(__file__).parent.parent.parent / "database"

# Never auto-apply these:
#   - init.sql: applied once by Docker's initdb mechanism when the volume
#     was first created. It uses plain CREATE TABLE (no IF NOT EXISTS) —
#     re-running it errors on "relation already exists". Tracked as
#     already-applied by the one-time backfill, never touched again.
#   - relay_db_dump.sql: a full pg_dump snapshot, not an incremental
#     migration — replaying it would try to recreate everything.
#   - project_members.sql: superseded. It describes a "project_members"
#     table keyed by a Prisma "User".id FK, which requires a "User" table
#     inside this Postgres instance — Prisma's users live in a separate
#     SQLite database this backend can't query, so that table can never
#     really be built the way this file describes. The access-control
#     feature it was for now uses project_staffing (email-keyed) instead —
#     see backend/api/access.py. Kept in the repo for history, not applied.
NEVER_APPLY = {"init.sql", "relay_db_dump.sql", "project_members.sql"}


def checksum(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn or not dsn.startswith("postgres"):
        # backend/.env's DATABASE_URL might be shadowed by the repo-root
        # .env's Prisma sqlite one, depending on load order — build the DSN
        # from the same pieces main.py uses instead of trusting the env var.
        dsn = "postgresql://pm_user:pm_pass@localhost:5432/relay_db"

    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS public.schema_migrations (
                filename   TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                checksum   TEXT
            )
            """
        )

        applied = {
            r["filename"]: r["checksum"]
            for r in await conn.fetch("SELECT filename, checksum FROM public.schema_migrations")
        }

        files = sorted(
            f for f in DATABASE_DIR.glob("*.sql") if f.name not in NEVER_APPLY
        )

        ran, skipped, drifted = 0, 0, []

        for f in files:
            text = f.read_text()
            sum_ = checksum(text)

            if f.name in applied:
                if applied[f.name] != sum_:
                    drifted.append(f.name)
                else:
                    skipped += 1
                continue

            print(f"Applying {f.name} ...")
            async with conn.transaction():
                await conn.execute(text)
                await conn.execute(
                    """
                    INSERT INTO public.schema_migrations (filename, checksum)
                    VALUES ($1, $2)
                    """,
                    f.name,
                    sum_,
                )
            ran += 1
            print(f"  done.")

        print(f"\n{ran} applied, {skipped} already up to date, {len(drifted)} changed since last applied.")
        if drifted:
            print("\nCHANGED SINCE LAST APPLIED (not re-run automatically — review by hand):")
            for name in drifted:
                print(f"  - {name}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
