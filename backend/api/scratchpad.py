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

router = APIRouter()

DEFAULT_ENGAGEMENT_ID = os.environ.get("RELAY_ENGAGEMENT_ID", "proj-001")

VALID_STATUSES = {"draft", "approved", "promoted"}


class NewNote(BaseModel):
    user_id: str
    engagement_id: str = DEFAULT_ENGAGEMENT_ID
    title: Optional[str] = None
    content: str
    source_pr: Optional[str] = None


def _row_to_note(r) -> dict:
    return {
        "id": str(r["id"]),
        "title": r["title"],
        "content": r["content"],
        "status": r["status"],
        "source_pr": r["source_pr"],
        "created_at": r["created_at"],
        "approved_at": r["approved_at"],
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
            SELECT id, title, content, status, source_pr, created_at, approved_at
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
            SELECT id, title, content, status, source_pr, created_at, approved_at
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
    row = await pool.fetchrow(
        """
        INSERT INTO zone3.scratchpad_notes
            (user_id, engagement_id, title, content, source_pr, status, approved_at)
        VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'approved' THEN NOW() END)
        RETURNING id, title, content, status, source_pr, created_at, approved_at
        """,
        body.user_id,
        body.engagement_id,
        body.title,
        content,
        body.source_pr,
        status,
    )
    return _row_to_note(row)


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
