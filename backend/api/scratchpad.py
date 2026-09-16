"""Scratchpad notes — zone3.scratchpad_notes.

Replaces the earlier Prisma/SQLite ScratchpadNote implementation: this one
matches TASK_zone3_sessions.md's richer draft -> approved -> promoted model
with PR provenance and full-text search, which the Prisma version didn't have.

Identity here is email, not a Prisma user id — unlike api/sessions.py (which
still keys zone3.chat_sessions/chat_messages on user_id, since those rows are
only ever created by a real logged-in frontend request), a Scratchpad draft
can also be created unilaterally by the backend itself, with no frontend
request in hand at all (see api/scratchpad_triggers.py — an auto-draft is
born from a Jira ticket transition, resolved to an email via
public.project_staffing, the same table api/access.py checks access
against). Email is the one identity value both the frontend session and
that backend-only path can independently produce, so a manual note and an
auto-draft for the same person land under the same value and both show up
together. Matched case-insensitively throughout, same as api/access.py.

Same other deviation as api/sessions.py: uses the shared pool instead of
asyncpg.connect() per request, and trusts a client-supplied email (no
session verification — the Python backend has no access to the Node app's
session store).
"""

import json
import os
from typing import Optional

import asyncpg
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from api import github_client

router = APIRouter()

DEFAULT_ENGAGEMENT_ID = os.environ.get("RELAY_ENGAGEMENT_ID", "proj-001")

VALID_STATUSES = {"draft", "approved", "promoted"}


class NewNote(BaseModel):
    email: str
    engagement_id: str = DEFAULT_ENGAGEMENT_ID
    title: Optional[str] = None
    content: str
    source_pr: Optional[str] = None


class EditNote(BaseModel):
    email: str
    title: Optional[str] = None
    content: str


def _row_to_note(r) -> dict:
    provenance_ids = r["provenance_ids"]
    return {
        "id": str(r["id"]),
        "title": r["title"],
        "content": r["content"],
        "status": r["status"],
        "source_pr": r["source_pr"],
        "pr_head_sha": r["pr_head_sha"],
        # source_ticket survives approval (it's just "where this note came
        # from" — knowledge, not a live pointer); provenance_ids does not
        # (severed on approve — see approve_note). A note with a
        # source_ticket but provenance_count 0 is exactly that: approved,
        # traceable to its origin, no longer tied to raw client commit data.
        "source_ticket": r["source_ticket"],
        "provenance_count": len(provenance_ids) if provenance_ids else 0,
        "current_version": r["current_version"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
        "approved_at": r["approved_at"],
    }


def _row_to_version(r) -> dict:
    return {
        "id": str(r["id"]),
        "version_num": r["version_num"],
        "title": r["title"],
        "content": r["content"],
        "change_reason": r["change_reason"],
        "pr_diff_ref": r["pr_diff_ref"],
        "created_at": r["created_at"],
    }


@router.get("/api/scratchpad")
async def list_notes(
    email: str,
    engagement_id: str,
    request: Request,
    status: Optional[str] = None,
):
    if status is not None and status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status filter")

    pool: asyncpg.Pool = request.app.state.pool
    if status:
        rows = await pool.fetch(
            """
            SELECT id, title, content, status, source_pr, pr_head_sha,
                   current_version, created_at, updated_at, approved_at,
                   source_ticket, provenance_ids
            FROM zone3.scratchpad_notes
            WHERE lower(email) = lower($1) AND engagement_id = $2 AND status = $3
            ORDER BY created_at DESC
            """,
            email,
            engagement_id,
            status,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT id, title, content, status, source_pr, pr_head_sha,
                   current_version, created_at, updated_at, approved_at,
                   source_ticket, provenance_ids
            FROM zone3.scratchpad_notes
            WHERE lower(email) = lower($1) AND engagement_id = $2
            ORDER BY created_at DESC
            """,
            email,
            engagement_id,
        )
    return [_row_to_note(r) for r in rows]


@router.get("/api/scratchpad/search")
async def search_notes(q: str, email: str, engagement_id: str, request: Request):
    """searchNotes(): tsvector GIN on search_vector — the column and index
    have existed since the schema was written (database/zone3.sql), this is
    just the first route to actually use them. Still scoped to the
    requesting developer's own notes only, same as list_notes."""
    if not q.strip():
        return []
    pool: asyncpg.Pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT id, title, content, status, source_pr, pr_head_sha,
               current_version, created_at, updated_at, approved_at,
               source_ticket, provenance_ids
        FROM zone3.scratchpad_notes
        WHERE lower(email) = lower($1) AND engagement_id = $2
          AND search_vector @@ websearch_to_tsquery('english', $3)
        ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', $3)) DESC
        LIMIT 50
        """,
        email,
        engagement_id,
        q,
    )
    return [_row_to_note(r) for r in rows]


@router.post("/api/scratchpad")
async def create_note(body: NewNote, request: Request):
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    pool: asyncpg.Pool = request.app.state.pool
    # A manually-written note (no source_pr) has no "auto-drafted" step to
    # approve — it goes straight to approved, matching how "Write a note"
    # behaved before this backend existed. A PR-sourced note still lands as
    # a draft for the developer to review.
    status = "draft" if body.source_pr else "approved"

    # If this note is linked to a real PR, capture its current HEAD sha now
    # so a later check-pr-update call has a baseline to diff against.
    pr_head_sha = None
    if body.source_pr and github_client.pr_configured():
        try:
            pr_head_sha = await github_client.get_pr_head_sha(body.source_pr)
        except Exception:
            pr_head_sha = None  # PR lookup failing shouldn't block note creation

    row = await pool.fetchrow(
        """
        INSERT INTO zone3.scratchpad_notes
            (email, engagement_id, title, content, source_pr, pr_head_sha, status, approved_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = 'approved' THEN NOW() END)
        RETURNING id, title, content, status, source_pr, pr_head_sha,
                  current_version, created_at, updated_at, approved_at,
                  source_ticket, provenance_ids
        """,
        body.email,
        body.engagement_id,
        body.title,
        content,
        body.source_pr,
        pr_head_sha,
        status,
    )
    return _row_to_note(row)


@router.patch("/api/scratchpad/{note_id}")
async def edit_note(note_id: str, body: EditNote, request: Request):
    """Manual content edit — snapshots the pre-edit content as a version
    before overwriting, so nothing a developer captured is ever silently
    lost to their next edit."""
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    pool: asyncpg.Pool = request.app.state.pool
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                """
                SELECT title, content, source_pr, current_version
                FROM zone3.scratchpad_notes
                WHERE id = $1 AND lower(email) = lower($2)
                FOR UPDATE
                """,
                note_id,
                body.email,
            )
            if current is None:
                raise HTTPException(status_code=404, detail="Note not found")

            await conn.execute(
                """
                INSERT INTO zone3.scratchpad_note_versions
                    (note_id, version_num, title, content, change_reason)
                VALUES ($1, $2, $3, $4, 'manual_edit')
                """,
                note_id,
                current["current_version"],
                current["title"],
                current["content"],
            )

            row = await conn.fetchrow(
                """
                UPDATE zone3.scratchpad_notes
                SET title = $3, content = $4, current_version = current_version + 1,
                    updated_at = NOW()
                WHERE id = $1 AND lower(email) = lower($2)
                RETURNING id, title, content, status, source_pr, pr_head_sha,
                          current_version, created_at, updated_at, approved_at,
                          source_ticket, provenance_ids
                """,
                note_id,
                body.email,
                body.title,
                content,
            )
    return _row_to_note(row)


@router.get("/api/scratchpad/{note_id}/versions")
async def list_versions(note_id: str, email: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    owner = await pool.fetchval(
        "SELECT email FROM zone3.scratchpad_notes WHERE id = $1", note_id
    )
    if owner is None:
        raise HTTPException(status_code=404, detail="Note not found")
    if owner.lower() != email.lower():
        raise HTTPException(status_code=403, detail="Not your note")

    rows = await pool.fetch(
        """
        SELECT id, version_num, title, content, change_reason, pr_diff_ref, created_at
        FROM zone3.scratchpad_note_versions
        WHERE note_id = $1
        ORDER BY version_num DESC
        """,
        note_id,
    )
    return [_row_to_version(r) for r in rows]


@router.get("/api/scratchpad/{note_id}/sources")
async def note_sources(note_id: str, email: str, request: Request):
    """"Show which one" — the Jira ticket and, while provenance is still
    live (draft, not yet approved), the exact commits a note was distilled
    from. Once approve_note() severs provenance_ids, this correctly stops
    returning commit-level detail (that's the whole point of the cut) but
    source_ticket — a name, not a live pointer — still answers "where did
    this come from originally."""
    pool: asyncpg.Pool = request.app.state.pool
    note = await pool.fetchrow(
        """
        SELECT email, engagement_id, source_ticket, provenance_ids
        FROM zone3.scratchpad_notes WHERE id = $1
        """,
        note_id,
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    if note["email"].lower() != email.lower():
        raise HTTPException(status_code=403, detail="Not your note")

    commits = []
    if note["provenance_ids"]:
        rows = await pool.fetch(
            """
            SELECT id, content, metadata FROM public.chunks
            WHERE id = ANY($1::uuid[]) AND source_type = 'github_commit'
            """,
            note["provenance_ids"],
        )
        for r in rows:
            meta = r["metadata"]
            if isinstance(meta, str):
                meta = json.loads(meta)
            commits.append(
                {
                    "sha_short": (meta or {}).get("sha_short"),
                    "url": (meta or {}).get("url"),
                    "message": (meta or {}).get("message") or r["content"].split("\n")[0],
                }
            )

    return {
        "source_ticket": note["source_ticket"],
        "engagement_id": note["engagement_id"],
        "commits": commits,
    }


@router.post("/api/scratchpad/{note_id}/check-pr-update")
async def check_pr_update(note_id: str, email: str, request: Request):
    """For a PR-sourced note: check whether the linked PR's code has changed
    since the note last synced (pr_head_sha moved). If so, snapshot the
    note's current content as a pr_update version — the note's own text
    doesn't change automatically (a human still decides whether to rewrite
    it), this just records that the underlying code moved on."""
    if not github_client.pr_configured():
        raise HTTPException(
            status_code=503, detail="GitHub is not configured on the backend"
        )

    pool: asyncpg.Pool = request.app.state.pool
    note = await pool.fetchrow(
        """
        SELECT title, content, source_pr, pr_head_sha, current_version
        FROM zone3.scratchpad_notes
        WHERE id = $1 AND lower(email) = lower($2)
        """,
        note_id,
        email,
    )
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    if not note["source_pr"]:
        raise HTTPException(status_code=400, detail="Note has no linked PR")

    latest_sha = await github_client.get_pr_head_sha(note["source_pr"])
    if latest_sha == note["pr_head_sha"]:
        return {"changed": False, "pr_head_sha": latest_sha}

    diffstat = await github_client.get_pr_diffstat(note["source_pr"])

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO zone3.scratchpad_note_versions
                    (note_id, version_num, title, content, change_reason, pr_diff_ref)
                VALUES ($1, $2, $3, $4, 'pr_update', $5)
                """,
                note_id,
                note["current_version"],
                note["title"],
                note["content"],
                note["pr_head_sha"],
            )
            await conn.execute(
                """
                UPDATE zone3.scratchpad_notes
                SET pr_head_sha = $2, current_version = current_version + 1,
                    updated_at = NOW()
                WHERE id = $1
                """,
                note_id,
                latest_sha,
            )

    return {"changed": True, "pr_head_sha": latest_sha, "diffstat": diffstat}


@router.patch("/api/scratchpad/{note_id}/approve")
async def approve_note(note_id: str, email: str, request: Request):
    """The provenance cut. Setting provenance_ids = NULL here is what turns
    an auto-drafted note into a human-made artifact — from this point it's
    exempt from the R9 offboarding cascade (api.scratchpad_triggers.
    cascade_delete_engagement), which only destroys notes where
    provenance_ids is still set. A manual note (provenance_ids already NULL
    from creation) is unaffected either way."""
    pool: asyncpg.Pool = request.app.state.pool
    result = await pool.execute(
        """
        UPDATE zone3.scratchpad_notes
        SET status = 'approved', approved_at = NOW(), provenance_ids = NULL
        WHERE id = $1 AND lower(email) = lower($2)
        """,
        note_id,
        email,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True}


@router.patch("/api/scratchpad/{note_id}/promote")
async def promote_note(note_id: str, email: str, request: Request):
    """Promotion is append-only ("Log who, when") — the status flip and the
    zone3.scratchpad_promotions row are written in the same transaction so
    a note can never end up 'promoted' with no record of who did it."""
    pool: asyncpg.Pool = request.app.state.pool
    async with pool.acquire() as conn:
        async with conn.transaction():
            result = await conn.execute(
                """
                UPDATE zone3.scratchpad_notes
                SET status = 'promoted'
                WHERE id = $1 AND lower(email) = lower($2) AND status = 'approved'
                """,
                note_id,
                email,
            )
            if result == "UPDATE 0":
                raise HTTPException(
                    status_code=404, detail="Note not found, or not in 'approved' status"
                )
            await conn.execute(
                """
                INSERT INTO zone3.scratchpad_promotions (note_id, email)
                VALUES ($1, $2)
                """,
                note_id,
                email,
            )
    return {"ok": True}


@router.delete("/api/scratchpad/{note_id}")
async def delete_note(note_id: str, email: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    result = await pool.execute(
        "DELETE FROM zone3.scratchpad_notes WHERE id = $1 AND lower(email) = lower($2)",
        note_id,
        email,
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True}
