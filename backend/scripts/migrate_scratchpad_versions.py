"""One-off migration: add scratchpad note versioning (manual edits + PR-diff
snapshots). Applies the ALTER/CREATE statements from database/zone3.sql that
aren't already covered by the original CREATE TABLE IF NOT EXISTS (the table
already exists with data, so new columns need explicit ALTERs).

Not part of the app - run once, by hand, from backend/:
    .venv/bin/python scripts/migrate_scratchpad_versions.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv  # noqa: E402

# backend/.env wins over the repo-root .env, whose DATABASE_URL is Prisma's
# sqlite one - same load order as main.py.
load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv(Path(__file__).parent.parent.parent / ".env")

import asyncpg  # noqa: E402

STATEMENTS = [
    "ALTER TABLE zone3.scratchpad_notes ADD COLUMN IF NOT EXISTS pr_head_sha TEXT",
    "ALTER TABLE zone3.scratchpad_notes ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE zone3.scratchpad_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
    """
    CREATE TABLE IF NOT EXISTS zone3.scratchpad_note_versions (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        note_id        UUID NOT NULL
                           REFERENCES zone3.scratchpad_notes(id) ON DELETE CASCADE,
        version_num    INTEGER NOT NULL,
        title          TEXT,
        content        TEXT NOT NULL,
        change_reason  TEXT NOT NULL
                           CHECK (change_reason IN ('manual_edit', 'pr_update')),
        pr_diff_ref    TEXT,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (note_id, version_num)
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_scratchpad_versions_note
        ON zone3.scratchpad_note_versions (note_id, version_num DESC)
    """,
]


async def main():
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    try:
        for stmt in STATEMENTS:
            print(f"Running: {stmt.strip().splitlines()[0]}...")
            await conn.execute(stmt)
        print("Migration complete.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
