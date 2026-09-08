"""Ask Project chat history — zone3.chat_sessions / zone3.chat_messages.

Deviates from the original task spec in a few ways, all load-bearing:
- Uses the app's shared asyncpg pool (request.app.state.pool) instead of
  asyncpg.connect() per request — matches api/query.py's convention and
  avoids opening a fresh Postgres connection on every call.
- Calls api.query.run_query() (the actual pipeline) instead of a
  `run_query(question, user_id)` helper that doesn't exist in this codebase.
- Saves cited_chunk_ids from each source's "chunk_id" (public.chunks.id,
  a UUID) — the spec's draft read a "chunk_id" key that api/query.py's
  response never had, which would have silently saved an empty array on
  every message.
- No auth/session verification: user_id is trusted from the request body,
  same as api/query.py's engagement_id today. The Python backend has no
  access to the Node app's session store — flagged, not fixed here.
"""

import os

import asyncpg
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from api.query import SNIPPET_CHARS, run_query

router = APIRouter()

DEFAULT_ENGAGEMENT_ID = os.environ.get("RELAY_ENGAGEMENT_ID", "proj-001")

TITLE_MAX_CHARS = 60


class NewSession(BaseModel):
    user_id: str
    engagement_id: str = DEFAULT_ENGAGEMENT_ID


class NewMessage(BaseModel):
    user_id: str
    question: str


@router.post("/api/sessions")
async def create_session(body: NewSession, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    row = await pool.fetchrow(
        """
        INSERT INTO zone3.chat_sessions (user_id, engagement_id)
        VALUES ($1, $2)
        RETURNING id, created_at
        """,
        body.user_id,
        body.engagement_id,
    )
    return {"session_id": str(row["id"]), "created_at": row["created_at"]}


@router.get("/api/sessions")
async def list_sessions(user_id: str, engagement_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT s.id, s.title, s.created_at,
               COUNT(m.id) AS message_count
        FROM zone3.chat_sessions s
        LEFT JOIN zone3.chat_messages m ON m.session_id = s.id
        WHERE s.user_id = $1 AND s.engagement_id = $2
        GROUP BY s.id
        ORDER BY s.created_at DESC
        """,
        user_id,
        engagement_id,
    )
    return [
        {
            "id": str(r["id"]),
            "title": r["title"],
            "created_at": r["created_at"],
            "message_count": r["message_count"],
        }
        for r in rows
    ]


@router.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str, user_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    result = await pool.execute(
        "DELETE FROM zone3.chat_sessions WHERE id = $1 AND user_id = $2",
        session_id,
        user_id,
    )
    # asyncpg's execute() returns a string like "DELETE 1" — 0 means either
    # the session never existed or belongs to a different user.
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


@router.post("/api/sessions/{session_id}/messages")
async def send_message(session_id: str, body: NewMessage, request: Request):
    pool: asyncpg.Pool = request.app.state.pool

    session = await pool.fetchrow(
        "SELECT engagement_id, title FROM zone3.chat_sessions WHERE id = $1 AND user_id = $2",
        session_id,
        body.user_id,
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    # 1. Save the user's message.
    await pool.execute(
        "INSERT INTO zone3.chat_messages (session_id, role, content) VALUES ($1, 'user', $2)",
        session_id,
        question,
    )

    # 2. Run the actual query pipeline (embed/search/threshold/LLM, or the
    #    "summarize KPD-33" shortcut) — same logic POST /api/query uses.
    result = await run_query(
        pool=pool,
        embedding_model=request.app.state.embedding_model,
        llm_providers=request.app.state.llm_providers,
        question=question,
        engagement_id=session["engagement_id"],
    )

    # 3. Save the assistant's message with provenance.
    chunk_ids = [s["chunk_id"] for s in result.get("sources", []) if s.get("chunk_id")]
    await pool.execute(
        """
        INSERT INTO zone3.chat_messages (session_id, role, content, cited_chunk_ids, abstained)
        VALUES ($1, 'assistant', $2, $3, $4)
        """,
        session_id,
        result["answer"],
        chunk_ids,
        result["abstained"],
    )

    # 4. Auto-title the session from the first question.
    if session["title"] is None:
        await pool.execute(
            "UPDATE zone3.chat_sessions SET title = LEFT($1, $2) WHERE id = $3 AND title IS NULL",
            question,
            TITLE_MAX_CHARS,
            session_id,
        )

    return result


@router.get("/api/sessions/{session_id}/messages")
async def get_messages(session_id: str, user_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT m.id, m.role, m.content, m.cited_chunk_ids, m.abstained, m.created_at
        FROM zone3.chat_messages m
        JOIN zone3.chat_sessions s ON s.id = m.session_id
        WHERE m.session_id = $1 AND s.user_id = $2
        ORDER BY m.created_at ASC
        """,
        session_id,
        user_id,
    )

    # cited_chunk_ids only stores bare UUIDs (public.chunks.id) — resolve them
    # back to the same {source_doc_id, source_type, snippet} shape POST
    # /api/query returns, in one batched lookup, so reloaded history renders
    # identical citation chips to a live answer instead of raw UUIDs.
    all_ids = {str(c) for r in rows for c in (r["cited_chunk_ids"] or [])}
    chunks_by_id = {}
    if all_ids:
        chunk_rows = await pool.fetch(
            "SELECT id, source_doc_id, source_type, content FROM public.chunks WHERE id = ANY($1::uuid[])",
            list(all_ids),
        )
        chunks_by_id = {
            str(c["id"]): {
                "source_doc_id": c["source_doc_id"],
                "source_type": c["source_type"],
                "snippet": c["content"][:SNIPPET_CHARS],
            }
            for c in chunk_rows
        }

    return [
        {
            "id": str(r["id"]),
            "role": r["role"],
            "content": r["content"],
            # A cited chunk can be missing here if it was deleted since —
            # skip it rather than error, same as any other stale reference.
            "sources": [
                chunks_by_id[str(c)] for c in (r["cited_chunk_ids"] or []) if str(c) in chunks_by_id
            ],
            "abstained": r["abstained"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]
