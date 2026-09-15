"""One-off script: seed real Scratchpad notes for the demo.

Runs the actual auto-draft pipeline (api.scratchpad_triggers.distill_note +
create_draft — the same functions _scratchpad_eval_loop calls in production,
not a shortcut around them) against real, already-resolved KPD tickets and
their real linked commits, for each real developer in this engagement's
project_staffing roster. For half of them, also applies the same SQL
approve_note() runs, so the demo shows both states: a draft awaiting review
and an already-approved note (provenance cut) side by side.

Idempotent-ish: skips a (email, source_ticket) pair that already has a note,
so re-running after a partial failure doesn't duplicate. Run from backend/:
    .venv/bin/python scripts/seed_scratchpad_demo.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import asyncpg  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv(Path(__file__).parent.parent.parent / ".env")

import os  # noqa: E402

from api.llm import build_providers  # noqa: E402
from api.scratchpad_triggers import (  # noqa: E402
    TicketSignal,
    create_draft,
    distill_note,
    is_note_worthy,
)

ENGAGEMENT_ID = os.environ["RELAY_ENGAGEMENT_ID"]

# (developer email, ticket to leave as a draft, ticket to seed already-approved)
PLAN = [
    ("agrim@relay.dev", "KPD-228", "KPD-142"),
    ("akshar@relay.dev", "KPD-109", "KPD-104"),
    ("jason@relay.dev", "KPD-13", "KPD-186"),
    ("omar@relay.dev", "KPD-113", "KPD-95"),
    ("priya@relay.dev", "KPD-99", "KPD-239"),
    ("shubhr@relay.dev", "KPD-111", "KPD-36"),
]

# Short, manually-written notes — no ticket, no LLM call, no draft step
# (matches POST /api/scratchpad with no source_pr: status goes straight to
# 'approved', same as clicking "Write a note" in the UI). These round out
# the demo with the kind of quick, personal note a developer jots down
# without a ticket behind it, alongside the auto-drafted ones above.
MINI_NOTES = [
    ("agrim@relay.dev", "Env var gotcha", "RELAY_ENGAGEMENT_ID must exactly match project_staffing.engagement_id — a stray suffix silently returns zero staffing rows, not an error."),
    ("agrim@relay.dev", "asyncpg + jsonb", "asyncpg returns jsonb columns as raw strings, not dicts, unless a codec is registered. Always json.loads() metadata before reading keys."),
    ("akshar@relay.dev", "Local Postgres port", "docker-compose maps Postgres to 5432 locally — if DATABASE_URL points anywhere else, asyncpg.create_pool just hangs instead of erroring."),
    ("akshar@relay.dev", "Jira assignee names", "Jira's raw assignee field sometimes comes through as 'First_Last' instead of 'First Last' — normalize underscores before matching against project_staffing.name."),
    ("jason@relay.dev", "Vite HMR + hooks", "Adding a new useEffect to a route file sometimes needs a hard refresh, not just HMR, if the hook's dependency array itself changed shape."),
    ("jason@relay.dev", "PR head sha", "check-pr-update diffs against pr_head_sha captured at note-creation time, not at approval time — approving doesn't refresh the baseline."),
    ("omar@relay.dev", "ticket_refs linkage", "Commit-to-ticket linkage lives only in public.chunks.metadata->>'ticket_refs' (a jsonb array) — raw.github_commits has no ticket_key column at all."),
    ("omar@relay.dev", "Draft TTL", "Undecided scratchpad drafts hard-delete after 7 days — silence is treated as dismiss, there's no auto-approve path, ever."),
    ("priya@relay.dev", "Provenance cut", "Approving a note sets provenance_ids to NULL — that's what exempts it from the R9 client-offboarding cascade delete. Still-draft notes stay deletable."),
    ("priya@relay.dev", "Migration drift", "apply_migrations.py checksums file content, not just filenames — editing an already-applied .sql file flags as 'drift' instead of silently re-running."),
    ("shubhr@relay.dev", "Scratchpad eval loop", "Auto-draft evaluation runs as its own asyncio task (_scratchpad_eval_loop), deliberately not inside _sync_loop — an LLM call there must never slow down the Jira/GitHub poll."),
    ("shubhr@relay.dev", "is_note_worthy", "The note-worthy filter is recall-first: any one rule matching (commit count, issue type, priority, keyword) qualifies. Better an extra draft than a missed fix."),
]


async def fetch_signal(
    pool: asyncpg.Pool, ticket_key: str
) -> tuple[TicketSignal, list[str]] | None:
    ticket = await pool.fetchrow(
        "SELECT issue_type, priority FROM raw.jira_tickets WHERE ticket_key = $1", ticket_key
    )
    if ticket is None:
        print(f"  ! {ticket_key} not found in raw.jira_tickets, skipping")
        return None
    commit_rows = await pool.fetch(
        """
        SELECT id, content FROM public.chunks
        WHERE engagement_id = $1 AND source_type = 'github_commit'
          AND metadata->'ticket_refs' ? $2
        ORDER BY updated_at
        """,
        ENGAGEMENT_ID,
        ticket_key,
    )
    if not commit_rows:
        print(f"  ! {ticket_key} has no linked commits, skipping")
        return None
    signal = TicketSignal(
        ticket_key=ticket_key,
        issue_type=ticket["issue_type"],
        priority=ticket["priority"],
        commit_messages=[c["content"] for c in commit_rows],
    )
    chunk_ids = [str(c["id"]) for c in commit_rows]
    return signal, chunk_ids


async def seed_one(pool: asyncpg.Pool, llm_providers: list, email: str, ticket_key: str, approve: bool) -> None:
    existing = await pool.fetchval(
        "SELECT 1 FROM zone3.scratchpad_notes WHERE lower(email) = lower($1) AND source_ticket = $2",
        email,
        ticket_key,
    )
    if existing:
        print(f"  = {email} / {ticket_key} already has a note, skipping")
        return

    fetched = await fetch_signal(pool, ticket_key)
    if fetched is None:
        return
    signal, chunk_ids = fetched

    result = is_note_worthy(signal)
    print(f"  {ticket_key}: worthy={result.worthy} ({'; '.join(result.reasons) or 'no reasons'})")

    content = await distill_note(llm_providers, signal)
    if not content:
        print(f"  ! distill_note returned nothing for {ticket_key}, skipping")
        return

    note_id = await create_draft(pool, ENGAGEMENT_ID, ticket_key, email, content, chunk_ids)

    if approve:
        # Exactly what PATCH /api/scratchpad/{id}/approve does — the
        # provenance cut — applied directly since there's no logged-in
        # frontend session in this script.
        await pool.execute(
            """
            UPDATE zone3.scratchpad_notes
            SET status = 'approved', approved_at = NOW(), provenance_ids = NULL
            WHERE id = $1
            """,
            note_id,
        )
        print(f"  + {email} / {ticket_key} -> approved ({note_id})")
    else:
        print(f"  + {email} / {ticket_key} -> draft ({note_id})")


async def seed_mini_note(pool: asyncpg.Pool, email: str, title: str, content: str) -> None:
    existing = await pool.fetchval(
        "SELECT 1 FROM zone3.scratchpad_notes WHERE lower(email) = lower($1) AND title = $2",
        email,
        title,
    )
    if existing:
        print(f"  = {email} / {title!r} already exists, skipping")
        return
    await pool.execute(
        """
        INSERT INTO zone3.scratchpad_notes
            (email, engagement_id, title, content, status, approved_at)
        VALUES ($1, $2, $3, $4, 'approved', NOW())
        """,
        email,
        ENGAGEMENT_ID,
        title,
        content,
    )
    print(f"  + {email} / {title!r} -> approved (mini note)")


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn or not dsn.startswith("postgres"):
        dsn = "postgresql://pm_user:pm_pass@localhost:5432/relay_db"
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=5)
    llm_providers = build_providers()
    if not llm_providers:
        print("No LLM configured (GEMINI/GROQ/CEREBRAS key) — distill_note would fail. Aborting.")
        return

    try:
        for email, draft_ticket, approved_ticket in PLAN:
            print(f"--- {email} ---")
            await seed_one(pool, llm_providers, email, draft_ticket, approve=False)
            await seed_one(pool, llm_providers, email, approved_ticket, approve=True)

        print("--- mini notes ---")
        for email, title, content in MINI_NOTES:
            await seed_mini_note(pool, email, title, content)
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
