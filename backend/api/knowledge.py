"""Admin knowledge-base overview — GET /api/admin/knowledge-base.

Answers the question no other view in Relay answers: what does the system
actually know? Returns what the retrieval corpus is made of (chunks by
source), which PM document types an engagement holds, and how Ask Project is
performing against that corpus.

Aggregate counts only — no message bodies, no per-user attribution.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from api.auth import VerifiedUser, require_role

router = APIRouter()


@router.get("/api/admin/knowledge-base")
async def knowledge_base(request: Request, user: VerifiedUser = Depends(require_role("ADMIN", "MANAGER"))):
    async with request.app.state.pool.acquire() as conn:
        chunks = await conn.fetch("""
            SELECT source_type, count(*)::int AS count
            FROM public.chunks
            GROUP BY source_type
            ORDER BY count DESC
        """)
        documents = await conn.fetch("""
            SELECT doc_type, ingestion_status, count(*)::int AS count
            FROM public.pm_documents
            GROUP BY doc_type, ingestion_status
            ORDER BY count DESC
        """)
        ask = await conn.fetchrow("""
            SELECT
                count(*) FILTER (WHERE role = 'user')::int AS questions,
                count(*) FILTER (WHERE role = 'assistant')::int AS answers,
                count(*) FILTER (WHERE abstained)::int AS abstained,
                round(avg(latency_ms) FILTER (WHERE role = 'assistant'))::int AS avg_latency_ms,
                round(avg(chunk_count) FILTER (WHERE role = 'assistant'), 1)::float AS avg_chunks
            FROM zone3.chat_messages
        """)

    return {
        "chunks_by_source": [dict(row) for row in chunks],
        "total_chunks": sum(row["count"] for row in chunks),
        "documents": [dict(row) for row in documents],
        "ask": dict(ask) if ask else {},
    }
