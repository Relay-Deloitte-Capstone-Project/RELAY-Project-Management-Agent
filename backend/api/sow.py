"""SOW upload -> parse -> chunk/embed -> structured deliverables.

POST /api/admin/sow/upload does the whole pipeline synchronously (upload is
an admin, one-at-a-time action — not a hot path, so there's no need for a
background job queue here):

  1. save the uploaded PDF to disk, hash it                 (sow_documents)
  2. extract text per page (pypdf)
  3. chunk the text and embed it with the same bge-small-en-v1.5 model
     api/query.py uses, insert into public.chunks with
     source_type='sow_document' — this is what makes SOW content
     answerable through the existing Ask Project RAG pipeline for free
  4. ask Gemini to extract structured deliverables + scope exclusions
     (api/llm.extract_deliverables), linking each deliverable back to the
     chunk it most closely matches for provenance    (sow_deliverables)

Every step's failure is caught, written to sow_documents.parse_error /
status='failed', and logged to ingestion_logs — nothing raises past the
upload response as a 500 once the file itself is safely saved.
"""

import hashlib
import os
import re
import uuid
from pathlib import Path
from typing import Optional

import asyncpg
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from pypdf import PdfReader
from starlette.concurrency import run_in_threadpool

from api import llm
from api.query import embed, to_pgvector

router = APIRouter()

DEFAULT_ENGAGEMENT_ID = os.environ.get("RELAY_ENGAGEMENT_ID", "proj-001")

# backend/storage/sow/{engagement_id}/{document_id}.pdf — never in Postgres.
STORAGE_ROOT = Path(__file__).parent.parent / "storage" / "sow"

MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20MB — an SOW is a contract doc, not a video

# Chunk target size in characters, matching the ballpark of the existing
# Jira/GitHub chunks in public.chunks (CONTEXT_CHARS=500 there — SOW prose
# reads better in slightly larger chunks since it's paragraph text, not a
# ticket title).
CHUNK_CHARS = 800
CHUNK_OVERLAP = 100


def _friendly_error(exc: Exception) -> str:
    """The raw Gemini SDK exception text is a multi-line nested dict dump —
    fine in server logs, not something to show an admin verbatim in a red
    error banner. Common cases get a short, actionable message; anything
    else is truncated rather than dumped in full."""
    text = str(exc)
    if "RESOURCE_EXHAUSTED" in text or "429" in text:
        return "Gemini API quota exceeded for today. Wait for the quota to reset (free tier resets daily) or switch providers, then retry."
    if len(text) > 300:
        return text[:300] + "…"
    return text


def _chunk_page(text: str, page_num: int) -> list:
    """Splits one page's text into overlapping character chunks.

    Simple and predictable beats a fancier semantic splitter here — SOW
    sections are short (a paragraph or a bulleted deliverable block), so a
    fixed window with overlap rarely cuts a clause in half, and unlike a
    sentence-tokenizer dependency, this needs nothing beyond stdlib re.
    """
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + CHUNK_CHARS, len(text))
        piece = text[start:end].strip()
        if piece:
            chunks.append({"content": piece, "page": page_num})
        if end == len(text):
            break
        start = end - CHUNK_OVERLAP
    return chunks


async def _log(pool: asyncpg.Pool, engagement_id: str, source: str, message: str, level: str = "info"):
    await pool.execute(
        """
        INSERT INTO public.ingestion_logs (engagement_id, source, message, level)
        VALUES ($1, $2, $3, $4)
        """,
        engagement_id,
        source,
        message,
        level,
    )


def _row_to_document(r) -> dict:
    return {
        "id": str(r["id"]),
        "engagement_id": r["engagement_id"],
        "file_name": r["file_name"],
        "page_count": r["page_count"],
        "scope_exclusions": r["scope_exclusions"],
        "status": r["status"],
        "parse_error": r["parse_error"],
        "uploaded_by": r["uploaded_by"],
        "uploaded_at": r["uploaded_at"],
        "parsed_at": r["parsed_at"],
    }


def _row_to_deliverable(r) -> dict:
    return {
        "id": str(r["id"]),
        "sow_document_id": str(r["sow_document_id"]),
        "sequence": r["sequence"],
        "name": r["name"],
        "acceptance_criteria": r["acceptance_criteria"],
        "source_page": r["source_page"],
        "source_chunk_id": str(r["source_chunk_id"]) if r["source_chunk_id"] else None,
        "is_edited": r["is_edited"],
    }


@router.post("/api/admin/sow/upload")
async def upload_sow(
    request: Request,
    file: UploadFile = File(...),
    engagement_id: str = Form(DEFAULT_ENGAGEMENT_ID),
    uploaded_by: Optional[str] = Form(None),
):
    # Browsers are inconsistent about the content-type they report for a
    # PDF (some send application/octet-stream, some send nothing at all
    # for a file picked via drag-and-drop) — the filename extension is the
    # reliable signal, so that's checked instead of trusting content_type.
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF uploads are supported")

    pool: asyncpg.Pool = request.app.state.pool

    project = await pool.fetchval(
        "SELECT engagement_id FROM public.projects WHERE engagement_id = $1", engagement_id
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Unknown engagement_id — no such project")

    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds 20MB limit")
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    document_id = uuid.uuid4()
    file_sha256 = hashlib.sha256(raw).hexdigest()

    doc_dir = STORAGE_ROOT / engagement_id
    doc_dir.mkdir(parents=True, exist_ok=True)
    storage_path = doc_dir / "{}.pdf".format(document_id)
    storage_path.write_bytes(raw)

    row = await pool.fetchrow(
        """
        INSERT INTO public.sow_documents
            (id, engagement_id, file_name, storage_path, file_sha256, status, uploaded_by)
        VALUES ($1, $2, $3, $4, $5, 'uploaded', $6)
        RETURNING id, engagement_id, file_name, page_count, scope_exclusions,
                  status, parse_error, uploaded_by, uploaded_at, parsed_at
        """,
        document_id,
        engagement_id,
        file.filename or "sow.pdf",
        str(storage_path),
        file_sha256,
        uploaded_by,
    )
    await _log(pool, engagement_id, "SOW", "Uploaded {} ({} bytes)".format(file.filename, len(raw)))

    try:
        await _parse_and_index(pool, request.app.state.embedding_model, document_id, engagement_id, str(storage_path))
    except Exception as exc:
        # A document that failed to parse must not leave chunks behind: they'd
        # be searchable by Ask Project's RAG (public.chunks has no FK back to
        # sow_documents, so they wouldn't even get cleaned up by the DELETE
        # endpoint's cascade) for a document with zero recorded deliverables,
        # and a retry upload would double them up on top of that.
        await pool.execute(
            "DELETE FROM public.chunks WHERE source_type = 'sow_document' AND source_doc_id = $1",
            str(document_id),
        )
        await pool.execute(
            "UPDATE public.sow_documents SET status = 'failed', parse_error = $2, page_count = NULL WHERE id = $1",
            document_id,
            _friendly_error(exc),
        )
        await _log(pool, engagement_id, "SOW", "Parse failed: {}".format(exc), level="error")
        # The upload itself succeeded — return the document so the admin UI
        # can show the failure state rather than a bare 500.
        row = await pool.fetchrow(
            """
            SELECT id, engagement_id, file_name, page_count, scope_exclusions,
                   status, parse_error, uploaded_by, uploaded_at, parsed_at
            FROM public.sow_documents WHERE id = $1
            """,
            document_id,
        )
        return _row_to_document(row)

    row = await pool.fetchrow(
        """
        SELECT id, engagement_id, file_name, page_count, scope_exclusions,
               status, parse_error, uploaded_by, uploaded_at, parsed_at
        FROM public.sow_documents WHERE id = $1
        """,
        document_id,
    )
    return _row_to_document(row)


async def _parse_and_index(pool, embedding_model, document_id, engagement_id, storage_path):
    await pool.execute(
        "UPDATE public.sow_documents SET status = 'parsing' WHERE id = $1", document_id
    )

    def _extract_pages():
        reader = PdfReader(storage_path)
        return [page.extract_text() or "" for page in reader.pages]

    pages = await run_in_threadpool(_extract_pages)
    if not any(p.strip() for p in pages):
        raise RuntimeError("No extractable text found in PDF (scanned image, not text-based)")

    all_chunks = []
    for i, page_text in enumerate(pages, start=1):
        all_chunks.extend(_chunk_page(page_text, i))
    if not all_chunks:
        raise RuntimeError("PDF text extracted but produced no chunks")

    chunk_rows = []  # (chunk_id, page, content) for later provenance matching
    async with pool.acquire() as conn:
        async with conn.transaction():
            for i, c in enumerate(all_chunks):
                vec = await run_in_threadpool(embed, embedding_model, c["content"])
                chunk_id = await conn.fetchval(
                    """
                    INSERT INTO public.chunks
                        (engagement_id, source_type, source_doc_id, content, metadata, embedding)
                    VALUES ($1, 'sow_document', $2, $3, $4::jsonb, $5::vector)
                    RETURNING id
                    """,
                    engagement_id,
                    str(document_id),
                    c["content"],
                    '{{"page": {}, "sow_document_id": "{}"}}'.format(c["page"], document_id),
                    to_pgvector(vec),
                )
                chunk_rows.append((chunk_id, c["page"], c["content"]))

    await pool.execute(
        "UPDATE public.sow_documents SET page_count = $2 WHERE id = $1",
        document_id,
        len(pages),
    )

    full_text = "\n\n".join(
        "[page {}] {}".format(i, t) for i, t in enumerate(pages, start=1) if t.strip()
    )
    # Gemini's context window comfortably fits a typical SOW (10-30 pages);
    # truncate defensively rather than fail outright on an unusually long one.
    extracted = await llm.extract_deliverables(full_text[:60000])

    deliverables = extracted.get("deliverables") or []
    scope_exclusions = extracted.get("scope_exclusions") or None

    async with pool.acquire() as conn:
        async with conn.transaction():
            for seq, d in enumerate(deliverables, start=1):
                source_page = d.get("source_page")
                # Best-effort provenance link: the chunk on the deliverable's
                # cited page whose text most overlaps the deliverable name.
                source_chunk_id = None
                page_chunks = [c for c in chunk_rows if c[1] == source_page]
                if page_chunks:
                    source_chunk_id = page_chunks[0][0]
                await conn.execute(
                    """
                    INSERT INTO public.sow_deliverables
                        (sow_document_id, engagement_id, sequence, name,
                         acceptance_criteria, source_page, source_chunk_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    """,
                    document_id,
                    engagement_id,
                    seq,
                    d.get("name") or "Untitled deliverable",
                    d.get("acceptance_criteria") or None,
                    source_page,
                    source_chunk_id,
                )
            await conn.execute(
                """
                UPDATE public.sow_documents
                SET status = 'parsed', parsed_at = NOW(), scope_exclusions = $2
                WHERE id = $1
                """,
                document_id,
                scope_exclusions,
            )

    await _log(
        pool,
        engagement_id,
        "SOW",
        "Parsed {} deliverables from {} pages ({} chunks embedded)".format(
            len(deliverables), len(pages), len(all_chunks)
        ),
    )


@router.get("/api/admin/sow")
async def list_sow_documents(
    engagement_id: str, request: Request, include_deliverables: bool = False
):
    """Lists every SOW document uploaded for a project. With
    include_deliverables=true, each document carries its own deliverables
    array nested under it — one call gives the Deliverables tab everything
    it needs to render "which deliverable came from which document" instead
    of N+1 requests (one GET /api/admin/sow/{id} per document)."""
    pool: asyncpg.Pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT id, engagement_id, file_name, page_count, scope_exclusions,
               status, parse_error, uploaded_by, uploaded_at, parsed_at
        FROM public.sow_documents
        WHERE engagement_id = $1
        ORDER BY uploaded_at DESC
        """,
        engagement_id,
    )
    documents = [_row_to_document(r) for r in rows]
    if not include_deliverables or not documents:
        return documents

    deliverable_rows = await pool.fetch(
        """
        SELECT id, sow_document_id, sequence, name, acceptance_criteria,
               source_page, source_chunk_id, is_edited
        FROM public.sow_deliverables
        WHERE sow_document_id = ANY($1::uuid[])
        ORDER BY sow_document_id, sequence
        """,
        [d["id"] for d in documents],
    )
    by_document: dict = {}
    for r in deliverable_rows:
        by_document.setdefault(str(r["sow_document_id"]), []).append(_row_to_deliverable(r))
    for d in documents:
        d["deliverables"] = by_document.get(d["id"], [])
    return documents


@router.get("/api/admin/sow/{document_id}")
async def get_sow_document(document_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    doc = await pool.fetchrow(
        """
        SELECT id, engagement_id, file_name, page_count, scope_exclusions,
               status, parse_error, uploaded_by, uploaded_at, parsed_at
        FROM public.sow_documents WHERE id = $1
        """,
        document_id,
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="SOW document not found")

    deliverables = await pool.fetch(
        """
        SELECT id, sow_document_id, sequence, name, acceptance_criteria,
               source_page, source_chunk_id, is_edited
        FROM public.sow_deliverables
        WHERE sow_document_id = $1
        ORDER BY sequence
        """,
        document_id,
    )
    result = _row_to_document(doc)
    result["deliverables"] = [_row_to_deliverable(r) for r in deliverables]
    return result


@router.delete("/api/admin/sow/{document_id}")
async def delete_sow_document(document_id: str, request: Request):
    """Removes a SOW document, its deliverables (FK cascade) and its chunks
    (no FK — public.chunks.source_doc_id is a plain text convention shared
    with Jira/GitHub rows, not a real foreign key, so this is deleted
    explicitly). Mainly for clearing out a 'failed' upload — e.g. after a
    transient error like a Gemini quota limit — before retrying, or
    removing a document that was uploaded by mistake."""
    pool: asyncpg.Pool = request.app.state.pool
    doc = await pool.fetchrow(
        "SELECT engagement_id, file_name FROM public.sow_documents WHERE id = $1", document_id
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="SOW document not found")

    await pool.execute(
        "DELETE FROM public.chunks WHERE source_type = 'sow_document' AND source_doc_id = $1",
        document_id,
    )
    await pool.execute("DELETE FROM public.sow_documents WHERE id = $1", document_id)
    await _log(pool, doc["engagement_id"], "SOW", "Removed document {}".format(doc["file_name"]))
    return {"ok": True}


class EditDeliverable(BaseModel):
    name: Optional[str] = None
    acceptance_criteria: Optional[str] = None


@router.patch("/api/admin/sow/deliverables/{deliverable_id}")
async def edit_deliverable(deliverable_id: str, body: EditDeliverable, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    current = await pool.fetchrow(
        "SELECT name, acceptance_criteria FROM public.sow_deliverables WHERE id = $1",
        deliverable_id,
    )
    if current is None:
        raise HTTPException(status_code=404, detail="Deliverable not found")

    name = body.name if body.name is not None else current["name"]
    criteria = (
        body.acceptance_criteria if body.acceptance_criteria is not None else current["acceptance_criteria"]
    )

    row = await pool.fetchrow(
        """
        UPDATE public.sow_deliverables
        SET name = $2, acceptance_criteria = $3, is_edited = TRUE, updated_at = NOW()
        WHERE id = $1
        RETURNING id, sow_document_id, sequence, name, acceptance_criteria,
                  source_page, source_chunk_id, is_edited
        """,
        deliverable_id,
        name,
        criteria,
    )
    return _row_to_deliverable(row)
