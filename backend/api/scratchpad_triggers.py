"""Auto-draft eligibility — decides which resolved Jira tickets are worth a
Scratchpad draft, so a developer isn't shown one for every routine ticket.

Called from api.sync.sync_jira() at the moment a ticket's status transitions
into a "done" state (see DONE_STATUSES below) — not on every sync pass, and
never for a ticket that was already done last time it synced. Only a ticket
that passes is_note_worthy() goes on to distillNote() (the LLM call that
actually writes the draft) — everything below is a free, no-LLM pre-filter.

Tuned against real data in this engagement (Acme / KPD board): e.g. KPD-239
("read-time permission evaluation doesn't account for revoked project
access") took 3 commits to land and is a Bug — qualifies on both the commit
count and issue-type rules. A one-line typo-fix ticket with a single commit
and no keyword hit does not qualify, and costs zero LLM calls to reject.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

import asyncpg

from api import github_client
from api.llm import generate_answer

logger = logging.getLogger(__name__)

DONE_STATUSES = {"Done", "Closed", "Resolved"}

# Hard 7-day TTL on undecided drafts — "silence = dismiss. No auto-approve.
# Ever." A draft nobody looked at within a week is deleted, never promoted
# to approved on its own.
DRAFT_TTL_DAYS = 7


@dataclass
class TicketSignal:
    """What sync_jira() already has on hand for a ticket at the moment it
    flips to done — no extra API calls needed to build this."""

    ticket_key: str
    issue_type: str | None
    priority: str | None
    commit_messages: list[str] = field(default_factory=list)
    pr_body: str | None = None


@dataclass
class NoteWorthyConfig:
    """Every threshold here is a judgment call, not a fixed law — keep it in
    one place so it can be tuned after the demo without touching the
    decision logic itself."""

    min_commit_count: int = 2
    qualifying_issue_types: frozenset[str] = frozenset({"Bug"})
    qualifying_priorities: frozenset[str] = frozenset({"High", "Highest", "Critical"})
    # Matched case-insensitively as whole words against commit messages and
    # the PR body — "fix" must not match "prefix" or "fixture".
    keywords: tuple[str, ...] = (
        "fix",
        "fixed",
        "fixes",
        "resolve",
        "resolved",
        "resolves",
        "workaround",
        "revert",
        "reverted",
        "migrate",
        "migration",
        "breaking change",
        "root cause",
    )


DEFAULT_CONFIG = NoteWorthyConfig()


@dataclass
class NoteWorthyResult:
    worthy: bool
    reasons: list[str]


def _keyword_pattern(config: NoteWorthyConfig) -> re.Pattern:
    escaped = [re.escape(k) for k in config.keywords]
    return re.compile(r"\b(" + "|".join(escaped) + r")\b", re.IGNORECASE)


def is_note_worthy(
    ticket: TicketSignal, config: NoteWorthyConfig = DEFAULT_CONFIG
) -> NoteWorthyResult:
    """A ticket qualifies if it hits ANY rule below — this is a recall-first
    filter (better to draft one the developer dismisses than to silently
    skip a real fix). reasons is returned even when worthy is False, empty
    in that case, and populated when True so a bot comment or log can say
    *why* a draft was created instead of just that one was."""
    reasons: list[str] = []

    commit_count = len(ticket.commit_messages)
    if commit_count >= config.min_commit_count:
        reasons.append(
            f"{commit_count} commits on this ticket (>= {config.min_commit_count}) "
            "— suggests iteration, not a one-line change"
        )

    if ticket.issue_type and ticket.issue_type in config.qualifying_issue_types:
        reasons.append(f"issue type '{ticket.issue_type}' is auto-draft-worthy")

    if ticket.priority and ticket.priority in config.qualifying_priorities:
        reasons.append(f"priority '{ticket.priority}' is auto-draft-worthy")

    pattern = _keyword_pattern(config)
    text_blocks = list(ticket.commit_messages)
    if ticket.pr_body:
        text_blocks.append(ticket.pr_body)
    matched_keywords: set[str] = set()
    for text in text_blocks:
        matched_keywords.update(m.group(0).lower() for m in pattern.finditer(text))
    if matched_keywords:
        reasons.append("keyword match: " + ", ".join(sorted(matched_keywords)))

    return NoteWorthyResult(worthy=bool(reasons), reasons=reasons)


DISTILL_PROMPT = """You write a short internal engineering note explaining why a Jira ticket
was fixed the way it was, for a developer joining this project later. This is
for the team's own knowledge base, not client-facing — do not name the
client, the company, or any project/engagement name.

Ticket: {ticket_key}
Commits (oldest first):
{commits}

Write 2-4 sentences covering: what was actually wrong, why the fix works,
and anything a future developer should watch out for. Plain prose, no
markdown headers, no restating the commit messages verbatim."""


async def distill_note(llm_providers: list, ticket: TicketSignal) -> str | None:
    """The LLM call — turns a ticket's raw commit history into the kind of
    short "here's the reason" note a developer would otherwise have to
    reconstruct by reading commits themselves. Returns None (never raises)
    on any provider failure — a missing draft is a minor loss, but this
    running inside the eval loop must never crash that loop."""
    prompt = DISTILL_PROMPT.format(
        ticket_key=ticket.ticket_key,
        commits="\n".join(f"- {m}" for m in ticket.commit_messages),
    )
    try:
        content, _provider = await generate_answer(llm_providers, prompt)
        return content or None
    except Exception:
        logger.exception("distill_note failed for %s", ticket.ticket_key)
        return None


async def _resolve_assignee_email(pool: asyncpg.Pool, engagement_id: str, assignee_name: str | None) -> str | None:
    """Best-effort match of a Jira assignee's display name to the person's
    email via public.project_staffing — the same table api/access.py keys
    access control on, and the only cross-reference available to the Python
    backend, which has no query access to Prisma's identity store (Prisma
    runs on SQLite, a separate database entirely). This is also exactly why
    zone3.scratchpad_notes is keyed by email rather than a Prisma user id —
    see that table's definition in database/zone3.sql for the full reasoning.
    """
    if not assignee_name:
        return None
    # Jira's raw assignee field is sometimes an account-name-style string
    # ("Agrim_Gairola") rather than the display name ("Agrim Gairola")
    # project_staffing was entered with — normalize underscores to spaces
    # before comparing rather than dropping a real match over punctuation.
    normalized = assignee_name.replace("_", " ")
    return await pool.fetchval(
        "SELECT email FROM public.project_staffing WHERE engagement_id = $1 AND lower(name) = lower($2)",
        engagement_id,
        normalized,
    )


async def create_draft(
    pool: asyncpg.Pool,
    engagement_id: str,
    ticket_key: str,
    email: str,
    content: str,
    provenance_ids: list[str],
) -> str:
    """createDraft(): status='draft', provenance_ids set (the note is still
    "machine-made from the client's data" until a human approves it),
    source_ticket recorded so the UI can link back to the originating Jira
    issue."""
    row = await pool.fetchrow(
        """
        INSERT INTO zone3.scratchpad_notes
            (email, engagement_id, title, content, status, source_ticket, provenance_ids)
        VALUES ($1, $2, $3, $4, 'draft', $5, $6)
        RETURNING id
        """,
        email,
        engagement_id,
        f"Auto-draft: {ticket_key}",
        content,
        ticket_key,
        provenance_ids,
    )
    return str(row["id"])


BOT_COMMENT_TEMPLATE = (
    "🧠 Relay Scratchpad drafted an internal note from this ticket's fix "
    "({ticket_key}) — a teammate can review, edit, or dismiss it in Relay. "
    "This comment is informational only; nothing here leaves GitHub."
)


def _meta_of(row) -> dict:
    """asyncpg returns jsonb columns as raw strings unless a codec is set
    (none is, here) — same deserialization api/sync.py already does."""
    m = row["metadata"]
    if isinstance(m, str):
        try:
            return json.loads(m)
        except Exception:
            return {}
    return m or {}


async def _post_bot_comment(ticket_key: str, commit_rows: list) -> None:
    """postBotComment(): best-effort only. Lands on the most recent commit
    referencing this ticket — commit_rows is already ordered oldest-first."""
    if not github_client.pr_configured() or not commit_rows:
        return
    meta = _meta_of(commit_rows[-1])
    repo, sha = meta.get("repo"), meta.get("sha")
    if not repo or not sha:
        return
    try:
        await github_client.post_commit_comment(
            repo, sha, BOT_COMMENT_TEMPLATE.format(ticket_key=ticket_key)
        )
    except Exception:
        logger.exception("post_commit_comment failed for %s (%s@%s)", ticket_key, repo, sha)


async def evaluate_candidates(
    pool: asyncpg.Pool, llm_providers: list, batch_size: int = 25
) -> int:
    """The separate step promised in the design: drains
    zone3.scratchpad_draft_candidates (populated by api.sync.upsert_jira_issue
    on a status transition), runs the free is_note_worthy() check on each,
    and for anything worthy, distills + creates the draft + posts the bot
    comment.

    Deliberately its own function, called from its own asyncio task (see
    main.py's _scratchpad_eval_loop) rather than inline in _sync_loop —
    sync_jira()/sync_github_commits() finishing on schedule must never wait
    on any of this, LLM call and GitHub API call included.

    Returns the number of candidates it processed this pass.
    """
    pending = await pool.fetch(
        """
        SELECT id, engagement_id, ticket_key
        FROM zone3.scratchpad_draft_candidates
        WHERE evaluated_at IS NULL
        ORDER BY detected_at
        LIMIT $1
        """,
        batch_size,
    )

    for row in pending:
        ticket = await pool.fetchrow(
            "SELECT issue_type, priority, assignee FROM raw.jira_tickets WHERE ticket_key = $1",
            row["ticket_key"],
        )
        # Commit linkage lives only in public.chunks.metadata.ticket_refs
        # (raw.github_commits has no ticket_key column) — the `?` operator
        # is a jsonb/array "contains this string" containment check.
        commit_rows = await pool.fetch(
            """
            SELECT id, content, metadata FROM public.chunks
            WHERE engagement_id = $1 AND source_type = 'github_commit'
              AND metadata->'ticket_refs' ? $2
            ORDER BY updated_at
            """,
            row["engagement_id"],
            row["ticket_key"],
        )

        signal = TicketSignal(
            ticket_key=row["ticket_key"],
            issue_type=ticket["issue_type"] if ticket else None,
            priority=ticket["priority"] if ticket else None,
            commit_messages=[c["content"] for c in commit_rows],
        )
        result = is_note_worthy(signal)

        await pool.execute(
            """
            UPDATE zone3.scratchpad_draft_candidates
            SET evaluated_at = NOW(), worthy = $2, reasons = $3
            WHERE id = $1
            """,
            row["id"],
            result.worthy,
            result.reasons,
        )

        if not result.worthy:
            continue

        assignee_email = await _resolve_assignee_email(
            pool, row["engagement_id"], ticket["assignee"] if ticket else None
        )
        if not assignee_email:
            logger.info(
                "scratchpad: %s worthy but no staffing match for assignee %r — skipping draft",
                row["ticket_key"],
                ticket["assignee"] if ticket else None,
            )
            continue

        content = await distill_note(llm_providers, signal)
        if not content:
            continue

        provenance_ids = [str(c["id"]) for c in commit_rows]
        await create_draft(
            pool, row["engagement_id"], row["ticket_key"], assignee_email, content, provenance_ids
        )
        await _post_bot_comment(row["ticket_key"], commit_rows)

    return len(pending)


async def expire_drafts(pool: asyncpg.Pool, ttl_days: int = DRAFT_TTL_DAYS) -> int:
    """expireDrafts(): "Draft older 7 day -> DELETE. Silence = dismiss. No
    auto-approve. Ever." A plain hard delete, same as dismissNote — an
    expired draft leaves nothing behind, same as one a developer dismissed
    by hand."""
    rows = await pool.fetch(
        """
        DELETE FROM zone3.scratchpad_notes
        WHERE status = 'draft' AND created_at < NOW() - make_interval(days => $1)
        RETURNING id
        """,
        ttl_days,
    )
    return len(rows)


async def cascade_delete_engagement(pool: asyncpg.Pool, engagement_id: str) -> list[str]:
    """cascadeDelete(): R9. "Note where provenance_ids IS NOT NULL -> DESTROY
    (even private one!). Note where provenance_ids IS NULL (approved) ->
    LIVE." Private only ever meant who could see a note, not whether Relay
    was allowed to keep client-derived content after the client leaves —
    only approveNote() severing provenance makes a note survive this.

    Called from admin_projects.delete_project() — the existing "client
    leaves" action, which already cascades project_staffing/project_tickets/
    project_commits the same way via real FKs. scratchpad_notes has no FK
    (Zone 3 is deliberately outside the public schema's cascade graph), so
    this is the one piece delete_project has to trigger explicitly rather
    than get for free.
    """
    rows = await pool.fetch(
        """
        DELETE FROM zone3.scratchpad_notes
        WHERE engagement_id = $1 AND provenance_ids IS NOT NULL
        RETURNING id
        """,
        engagement_id,
    )
    return [str(r["id"]) for r in rows]
