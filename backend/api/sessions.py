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

Conversation context: follow-up questions ("what about the second one?")
are rewritten into standalone questions with one cheap LLM call before the
pipeline runs — embeddings of pronoun-heavy follow-ups retrieve garbage —
and the last few exchanges are passed to the answer prompt as context. The
user's message is always stored verbatim; the rewrite only feeds retrieval.
"""

import os
import re
import time

import asyncpg
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from api import llm
from api.query import SNIPPET_CHARS, embed, ready_model, run_query, to_pgvector

router = APIRouter()

DEFAULT_ENGAGEMENT_ID = os.environ.get("RELAY_ENGAGEMENT_ID", "proj-001")

TITLE_MAX_CHARS = 60

# How many recent messages are read for context / follow-up detection.
HISTORY_MESSAGES = 6

# Answer cache: a new question this similar (cosine) to one the same user
# asked before reuses the stored answer — provided every chunk that answer
# cited is unchanged since (public.chunks.updated_at, bumped by live sync).
CACHE_SIMILARITY = float(os.environ.get("CACHE_SIMILARITY", "0.92"))

# Best past question by this user, paired with the assistant message that
# directly answered it (LATERAL pins the pairing to the *next* assistant
# message, not just any later one).
CACHE_LOOKUP_SQL = """
    SELECT a.id AS answer_id, a.content, a.created_at AS answered_at,
           1 - (m.embedding <=> $1::vector) AS sim
    FROM zone3.chat_messages m
    JOIN zone3.chat_sessions s ON s.id = m.session_id
    CROSS JOIN LATERAL (
        SELECT id, content, created_at
        FROM zone3.chat_messages a
        WHERE a.session_id = m.session_id
          AND a.role = 'assistant'
          AND a.created_at > m.created_at
          AND NOT a.abstained
        ORDER BY a.created_at
        LIMIT 1
    ) a
    WHERE s.user_id = $2
      AND m.role = 'user'
      AND m.embedding IS NOT NULL
    ORDER BY m.embedding <=> $1::vector
    LIMIT 1
"""

# A cited chunk newer than the answer means live sync changed the underlying
# record since — the cached answer may be stale and must not be reused.
CACHE_STALE_SQL = """
    SELECT count(*) AS stale
    FROM zone3.message_sources ms
    JOIN public.chunks c ON c.id = ms.chunk_id
    WHERE ms.message_id = $1 AND c.updated_at > $2
"""

CACHE_SOURCES_SQL = """
    SELECT source_doc_id, source_type, snippet, chunk_id
    FROM zone3.message_sources
    WHERE message_id = $1
"""

TICKET_OR_SHA_RE = re.compile(r"\b([A-Z]+-\d+|[0-9a-f]{7,40})\b")
FOLLOWUP_RE = re.compile(
    r"\b(it|this|that|they|them|those|these|the first|the second|the last"
    r"|another|what about|how about|and also|also|same|above|earlier"
    r"|the one|each|both)\b",
    re.IGNORECASE,
)

REWRITE_PROMPT = """Rewrite the follow-up question below as one standalone
question that makes sense without the conversation. Resolve pronouns and
references ("it", "the second one") to what they point at. Keep ticket keys
and commit ids exactly as written. Reply with ONLY the rewritten question.

CONVERSATION:
{history}

FOLLOW-UP: {question}

STANDALONE QUESTION:"""


def _looks_like_followup(question: str, has_history: bool) -> bool:
    """Short, reference-free, pronoun-y questions need rewriting; anything
    naming a ticket/sha stands alone already."""
    if not has_history or len(question) > 150:
        return False
    if TICKET_OR_SHA_RE.search(question):
        return False
    return bool(FOLLOWUP_RE.search(question)) or len(question.split()) <= 5


async def _rewrite_followup(llm_providers, history, question) -> str:
    lines = [
        "{}: {}".format("Teammate" if m["role"] == "user" else "Assistant", m["content"][:300])
        for m in history[-4:]
    ]
    prompt = REWRITE_PROMPT.format(history="\n".join(lines), question=question)
    try:
        rewritten, _ = await llm.generate_answer(llm_providers, prompt)
    except Exception:
        return question  # rewrite is an optimization — never fail the ask
    rewritten = rewritten.strip().strip('"')
    return rewritten or question



class NewSession(BaseModel):
    user_id: str
    engagement_id: str = DEFAULT_ENGAGEMENT_ID


class NewMessage(BaseModel):
    user_id: str
    question: str
    # Display name from the session token — lets first-person questions
    # ("my in-progress tickets") resolve to this user in the intent layer.
    user_name: str | None = None


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
        SELECT s.id, s.title, s.created_at, s.last_message_at,
               COUNT(m.id) AS message_count
        FROM zone3.chat_sessions s
        LEFT JOIN zone3.chat_messages m ON m.session_id = s.id
        WHERE s.user_id = $1 AND s.engagement_id = $2
        GROUP BY s.id
        ORDER BY COALESCE(s.last_message_at, s.created_at) DESC
        """,
        user_id,
        engagement_id,
    )
    return [
        {
            "id": str(r["id"]),
            "title": r["title"],
            "created_at": r["created_at"],
            "last_message_at": r["last_message_at"],
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


async def _lookup_cache(pool, user_id: str, qvec: str) -> dict | None:
    """Reuse a past answer when the question is near-identical AND every chunk
    it cited is unchanged since it was written. Returns a run_query-shaped
    result, or None to run the pipeline fresh."""
    row = await pool.fetchrow(CACHE_LOOKUP_SQL, qvec, user_id)
    if row is None or row["sim"] < CACHE_SIMILARITY:
        return None
    sources = [dict(s) for s in await pool.fetch(CACHE_SOURCES_SQL, row["answer_id"])]
    if not sources:
        # Nothing cited (sprint/live answers, declines) — freshness can't be
        # verified, so these are never served from cache.
        return None
    stale = await pool.fetchval(CACHE_STALE_SQL, row["answer_id"], row["answered_at"])
    if stale:
        return None
    return {
        "answer": row["content"],
        "sources": [
            {
                "source_doc_id": s["source_doc_id"],
                "source_type": s["source_type"],
                "snippet": s["snippet"],
                "chunk_id": str(s["chunk_id"]) if s["chunk_id"] else None,
            }
            for s in sources
        ],
        "abstained": False,
        "provider": "cache",
    }


async def _save_user_message(pool, session_id: str, content: str, qvec: str):
    await pool.execute(
        "INSERT INTO zone3.chat_messages (session_id, role, content, embedding)"
        " VALUES ($1, 'user', $2, $3::vector)",
        session_id,
        content,
        qvec,
    )


async def _save_assistant_message(pool, session_id: str, result: dict, latency_ms):
    sources = result.get("sources", [])
    chunk_ids = [s["chunk_id"] for s in sources if s.get("chunk_id")]
    msg = await pool.fetchrow(
        """
        INSERT INTO zone3.chat_messages
            (session_id, role, content, cited_chunk_ids, abstained,
             llm_model, latency_ms, chunk_count)
        VALUES ($1, 'assistant', $2, $3, $4, $5, $6, $7)
        RETURNING id
        """,
        session_id,
        result["answer"],
        chunk_ids,
        result["abstained"],
        result.get("provider"),
        latency_ms,
        len(sources),
    )

    # One message_sources row per citation (the spec's provenance table).
    # cited_chunk_ids is still written alongside it so history rendered by
    # older builds keeps working during the transition.
    for s in sources:
        await pool.execute(
            """
            INSERT INTO zone3.message_sources
                (message_id, chunk_id, source_doc_id, source_type, snippet)
            VALUES ($1, $2::uuid, $3, $4, $5)
            """,
            msg["id"],
            s.get("chunk_id"),
            s["source_doc_id"],
            s["source_type"],
            s.get("snippet"),
        )


async def _touch_session(pool, session_id: str, title: str | None, question: str):
    """Bump last-activity for the sidebar ordering; auto-title from the
    first question."""
    await pool.execute(
        "UPDATE zone3.chat_sessions SET last_message_at = NOW() WHERE id = $1",
        session_id,
    )
    if title is None:
        await pool.execute(
            "UPDATE zone3.chat_sessions SET title = LEFT($1, $2) WHERE id = $3 AND title IS NULL",
            question,
            TITLE_MAX_CHARS,
            session_id,
        )


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

    # 1. Read recent history BEFORE inserting this message, for follow-up
    #    detection and conversational context.
    history = [
        dict(r)
        for r in await pool.fetch(
            """
            SELECT role, content FROM zone3.chat_messages
            WHERE session_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            """,
            session_id,
            HISTORY_MESSAGES,
        )
    ]
    history.reverse()

    # 2. Follow-ups ("what about the second one?") are rewritten standalone —
    #    their raw embeddings retrieve garbage. The rewrite feeds retrieval
    #    only; the stored message stays verbatim.
    retrieval_question = question
    if _looks_like_followup(question, bool(history)):
        retrieval_question = await _rewrite_followup(
            request.app.state.llm_providers, history, question
        )

    # 3. Embed once — used both to store with the message and for the cache
    #    lookup below.
    t_start = time.perf_counter()
    model = await ready_model(request)
    qvec = to_pgvector(await run_in_threadpool(embed, model, retrieval_question))

    # 4. Answer cache: same user, near-identical question, cited records
    #    unchanged since → reuse the stored answer instead of re-retrieving.
    cached = await _lookup_cache(pool, body.user_id, qvec)
    if cached is not None:
        cached["timing_seconds"] = round(time.perf_counter() - t_start, 3)
        await _save_user_message(pool, session_id, question, qvec)
        await _save_assistant_message(
            pool, session_id, cached, int(cached["timing_seconds"] * 1000) or None
        )
        await _touch_session(pool, session_id, session["title"], question)
        return cached

    # 5. Save the user's message verbatim (with its embedding, for the cache).
    await _save_user_message(pool, session_id, question, qvec)

    # 6. Run the actual query pipeline (intents, summarize shortcut, or
    #    embed/search/threshold/LLM) — same logic POST /api/query uses.
    result = await run_query(
        pool=pool,
        embedding_model=model,
        llm_providers=request.app.state.llm_providers,
        question=retrieval_question,
        engagement_id=session["engagement_id"],
        history=history,
        user_name=body.user_name,
    )

    # 7. Save the assistant's message with provenance.
    latency_ms = int(result.get("timing_seconds", 0) * 1000) or None
    await _save_assistant_message(pool, session_id, result, latency_ms)
    await _touch_session(pool, session_id, session["title"], question)

    return result


@router.get("/api/sessions/{session_id}/messages")
async def get_messages(session_id: str, user_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT m.id, m.role, m.content, m.cited_chunk_ids, m.abstained,
               m.llm_model, m.latency_ms, m.chunk_count, m.created_at
        FROM zone3.chat_messages m
        JOIN zone3.chat_sessions s ON s.id = m.session_id
        WHERE m.session_id = $1 AND s.user_id = $2
        ORDER BY m.created_at ASC
        """,
        session_id,
        user_id,
    )

    # Citations: prefer zone3.message_sources (the spec's provenance table,
    # written for every new message); fall back to resolving the legacy
    # cited_chunk_ids UUID[] for messages saved before it existed.
    message_ids = [r["id"] for r in rows]
    sources_by_message = {}
    if message_ids:
        ms_rows = await pool.fetch(
            """
            SELECT message_id, source_doc_id, source_type, snippet
            FROM zone3.message_sources
            WHERE message_id = ANY($1::uuid[])
            """,
            message_ids,
        )
        for ms in ms_rows:
            sources_by_message.setdefault(str(ms["message_id"]), []).append(
                {
                    "source_doc_id": ms["source_doc_id"],
                    "source_type": ms["source_type"],
                    "snippet": ms["snippet"],
                }
            )

    all_ids = {
        str(c)
        for r in rows
        for c in (r["cited_chunk_ids"] or [])
        if str(r["id"]) not in sources_by_message
    }
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
            "sources": sources_by_message.get(
                str(r["id"]),
                [
                    chunks_by_id[str(c)]
                    for c in (r["cited_chunk_ids"] or [])
                    if str(c) in chunks_by_id
                ],
            ),
            "abstained": r["abstained"],
            "llm_model": r["llm_model"],
            "latency_ms": r["latency_ms"],
            "chunk_count": r["chunk_count"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]
