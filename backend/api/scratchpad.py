"""Scratchpad notes — zone3.scratchpad_notes.

Replaces the earlier Prisma/SQLite ScratchpadNote implementation: this one
matches TASK_zone3_sessions.md's richer draft -> approved -> promoted model
with PR provenance and full-text search, which the Prisma version didn't have.

Same deviations as api/sessions.py: uses the shared pool instead of
asyncpg.connect() per request, and trusts a client-supplied user_id (no
session verification — the Python backend has no access to the Node app's
session store).
"""

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
    user_id: str
    engagement_id: str = DEFAULT_ENGAGEMENT_ID
    title: Optional[str] = None
    content: str
    source_pr: Optional[str] = None


class EditNote(BaseModel):
    user_id: str
    title: Optional[str] = None
    content: str


def _row_to_note(r) -> dict:
    return {
        "id": str(r["id"]),
        "title": r["title"],
        "content": r["content"],
        "status": r["status"],
        "source_pr": r["source_pr"],
        "pr_head_sha": r["pr_head_sha"],
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
    user_id: str,
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
                   current_version, created_at, updated_at, approved_at
            FROM zone3.scratchpad_notes
            WHERE user_id = $1 AND engagement_id = $2 AND status = $3
            ORDER BY created_at DESC
            """,
            user_id,
            engagement_id,
            status,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT id, title, content, status, source_pr, pr_head_sha,
                   current_version, created_at, updated_at, approved_at
            FROM zone3.scratchpad_notes
            WHERE user_id = $1 AND engagement_id = $2
            ORDER BY created_at DESC
            """,
            user_id,
            engagement_id,
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
    if body.source_pr and github_client.configured():
        try:
            pr_head_sha = await github_client.get_pr_head_sha(body.source_pr)
        except Exception:
            pr_head_sha = None  # PR lookup failing shouldn't block note creation

    row = await pool.fetchrow(
        """
        INSERT INTO zone3.scratchpad_notes
            (user_id, engagement_id, title, content, source_pr, pr_head_sha, status, approved_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 = 'approved' THEN NOW() END)
        RETURNING id, title, content, status, source_pr, pr_head_sha,
                  current_version, created_at, updated_at, approved_at
        """,
        body.user_id,
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
                WHERE id = $1 AND user_id = $2
                FOR UPDATE
                """,
                note_id,
                body.user_id,
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
                WHERE id = $1 AND user_id = $2
                RETURNING id, title, content, status, source_pr, pr_head_sha,
                          current_version, created_at, updated_at, approved_at
                """,
                note_id,
                body.user_id,
                body.title,
                content,
            )
    return _row_to_note(row)


@router.get("/api/scratchpad/{note_id}/versions")
async def list_versions(note_id: str, user_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    owner = await pool.fetchval(
        "SELECT user_id FROM zone3.scratchpad_notes WHERE id = $1", note_id
    )
    if owner is None:
        raise HTTPException(status_code=404, detail="Note not found")
    if owner != user_id:
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


@router.post("/api/scratchpad/{note_id}/check-pr-update")
async def check_pr_update(note_id: str, user_id: str, request: Request):
    """For a PR-sourced note: check whether the linked PR's code has changed
    since the note last synced (pr_head_sha moved). If so, snapshot the
    note's current content as a pr_update version — the note's own text
    doesn't change automatically (a human still decides whether to rewrite
    it), this just records that the underlying code moved on."""
    if not github_client.configured():
        raise HTTPException(
            status_code=503, detail="GitHub is not configured on the backend"
        )

    pool: asyncpg.Pool = request.app.state.pool
    note = await pool.fetchrow(
        """
        SELECT title, content, source_pr, pr_head_sha, current_version
        FROM zone3.scratchpad_notes
        WHERE id = $1 AND user_id = $2
        """,
        note_id,
        user_id,
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
async def approve_note(note_id: str, user_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    result = await pool.execute(
        """
        UPDATE zone3.scratchpad_notes
        SET status = 'approved', approved_at = NOW()
        WHERE id = $1 AND user_id = $2
        """,
        note_id,
        user_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True}


@router.patch("/api/scratchpad/{note_id}/promote")
async def promote_note(note_id: str, user_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    result = await pool.execute(
        """
        UPDATE zone3.scratchpad_notes
        SET status = 'promoted'
        WHERE id = $1 AND user_id = $2 AND status = 'approved'
        """,
        note_id,
        user_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(
            status_code=404, detail="Note not found, or not in 'approved' status"
        )
    return {"ok": True}


@router.delete("/api/scratchpad/{note_id}")
async def delete_note(note_id: str, user_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    result = await pool.execute(
        "DELETE FROM zone3.scratchpad_notes WHERE id = $1 AND user_id = $2",
        note_id,
        user_id,
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Note not found")
    return {"ok": True}
