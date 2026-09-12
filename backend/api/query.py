"""POST /api/query — question -> embedding -> vector search -> grounded answer.

The actual pipeline lives in run_query() so it can be reused by
api/sessions.py (which saves the question/answer to zone3.chat_messages
alongside running it) without duplicating this logic.
"""

import json
import os
import re
import time

import asyncio
import asyncpg
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from starlette.concurrency import run_in_threadpool

from api import llm, report

router = APIRouter()

# Score below which we refuse to answer rather than guess.
THRESHOLD = 0.65

# How many chunks to feed the LLM. Each chunk here is thin (a ticket title plus
# one or two sentences, or a one-line commit message) — 2 rarely gives the model
# enough to do more than restate a title. Pulling more matters more than any
# single chunk's length, since this corpus has many near-duplicate tickets for
# the same underlying issue (different repro notes, follow-ups, sprint context)
# that combine into a fuller picture.
TOP_K = 8

# Characters of chunk text given to the LLM / returned to the caller.
CONTEXT_CHARS = 500
SNIPPET_CHARS = 200

EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"

ABSTAIN_ANSWER = "I don't have grounding for that in this project's records."

# The corpus loaded into public.chunks is all under this engagement.
DEFAULT_ENGAGEMENT_ID = os.environ.get("RELAY_ENGAGEMENT_ID", "proj-001")

# `id` is selected alongside the retrieval fields so callers (api/sessions.py)
# can save it into zone3.chat_messages.cited_chunk_ids for provenance.
SEARCH_SQL = """
    SELECT id,
           source_doc_id,
           source_type,
           content,
           metadata,
           1 - (embedding <=> $1::vector) AS score
    FROM public.chunks
    WHERE engagement_id = $2
      AND embedding IS NOT NULL
    ORDER BY embedding <=> $1::vector
    LIMIT $3
"""

# "Summarize KPD-33" style requests skip embedding/vector search entirely and
# fetch that one ticket directly — idx_chunks_source(source_type, source_doc_id)
# makes this an indexed point lookup rather than an approximate ANN scan.
TICKET_LOOKUP_SQL = """
    SELECT id, source_doc_id, source_type, content, metadata
    FROM public.chunks
    WHERE engagement_id = $1
      AND source_type = 'jira_ticket'
      AND source_doc_id = $2
    LIMIT 1
"""

# Requires both an intent word AND a ticket key so this never misfires on a
# question that merely mentions a ticket without asking to summarize it
# (e.g. "what changed in KPD-33?" still goes through normal RAG below).
TICKET_KEY_RE = re.compile(r"\b([A-Z]+-\d+)\b")
SUMMARIZE_INTENT_RE = re.compile(
    r"\b(summarize|summarise|summary(?:\s+of)?|tl;?dr)\b", re.IGNORECASE
)

PROMPT_TEMPLATE = """You are a project knowledge assistant answering a teammate's question
from this project's own tickets and commits.

Answer using ONLY the context below — never invent detail that isn't there.
The context is often several related tickets/commits about the same issue, each
contributing a different piece (root cause, repro steps, impact, a follow-up,
how it was resolved). Synthesize them into one coherent, descriptive answer
instead of restating a single ticket title — explain what the problem was, why
it happened or mattered, and what changed, when the context supports it.
Cite the source ID inline in square brackets right after each claim it comes
from, like [KPD-239] or [467d828] for a commit — cite ONLY the sources you
actually used, never every source you were shown.
If the context doesn't answer the question, say so plainly instead of guessing.
If the question isn't about this project (general coding help, trivia,
small talk), decline in one sentence and do not cite anything.
Write plain text — no markdown headers, no bold. Short flowing paragraphs by
default; if the question asks for a list or comparison, a compact list with
one "- " item per line is fine.
{style}
{history_block}
CONTEXT:
{context}

QUESTION: {question}

ANSWER:"""

HISTORY_BLOCK_TEMPLATE = """
CONVERSATION SO FAR (for context only — answer the QUESTION, not these):
{history}
"""

SUMMARIZE_PROMPT_TEMPLATE = """You are a project knowledge assistant. Summarize the following
ticket for a teammate in plain flowing prose, 2-4 sentences — no markdown, no bullet points,
no headers, since this renders as plain text in a chat bubble. Cite the ticket ID inline in
square brackets, like [{ticket_id}], at least once.

TICKET:
{context}

ANSWER:"""


def load_embedding_model() -> SentenceTransformer:
    """Called once from the app lifespan, never per request."""
    return SentenceTransformer(EMBEDDING_MODEL)


async def ready_model(request: Request) -> SentenceTransformer:
    """Wait for the background-loaded embedding model (see main.lifespan).
    Chat answers need it; /health and non-RAG routes never touch this."""
    try:
        await asyncio.wait_for(request.app.state.model_ready.wait(), timeout=180)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Model is still loading, retry shortly")
    model = request.app.state.embedding_model
    if model is None:
        raise HTTPException(status_code=503, detail="Embedding model failed to load")
    return model


def embed(model: SentenceTransformer, text: str) -> list:
    return model.encode([text], normalize_embeddings=True)[0].tolist()


def to_pgvector(vec: list) -> str:
    """asyncpg has no native vector codec, so send the literal pgvector accepts."""
    return "[" + ",".join(repr(float(x)) for x in vec) + "]"


def _cite_id(r: dict) -> str:
    """The id the model is told to cite: ticket key, or short sha for commits
    (a 40-char SHA inline ruined the prose and duplicated the citation chip)."""
    if r["source_type"] == "github_commit":
        meta = r.get("metadata") or {}
        if isinstance(meta, str):  # asyncpg returns jsonb as a raw string
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        return meta.get("sha_short") or r["source_doc_id"][:7]
    return r["source_doc_id"]


def build_context(results: list) -> str:
    return "\n\n".join(
        "[{doc}] ({kind}): {text}".format(
            doc=_cite_id(r),
            kind=r["source_type"],
            text=r["content"][:CONTEXT_CHARS],
        )
        for r in results
    )


def filter_cited_sources(answer: str, results: list) -> list:
    """Keep only chunks the model actually cited (bracketed) in its answer.

    Retrieval clearing the score threshold means the context was relevant
    enough to hand to the model — it doesn't mean the model used all of it.
    A refusal (e.g. to a prompt-injection attempt) cites nothing, so this
    naturally drops every source from a response like that instead of
    reporting sources the final answer never actually drew on.

    Matches the ticket key, the short sha shown in the context, or the full
    sha — the model doesn't always follow the prompt's exact id form,
    especially with long commit-SHA ids, and a strict match was silently
    dropping real citations (0 sources on an answer that visibly cited one).
    """
    cited = []
    for r in results:
        ids = {r["source_doc_id"], _cite_id(r)}
        if any(re.search(r"\[\s*{}\s*\]".format(re.escape(i)), answer) for i in ids):
            cited.append(r)
    return cited


def extract_summarize_ticket(question: str):
    """Return the ticket key a "summarize KPD-33"-style question names, else None."""
    if not SUMMARIZE_INTENT_RE.search(question):
        return None
    m = TICKET_KEY_RE.search(question)
    return m.group(1) if m else None


def _source_dict(r: dict) -> dict:
    return {
        "source_doc_id": r["source_doc_id"],
        "source_type": r["source_type"],
        "snippet": r["content"][:SNIPPET_CHARS],
        # UUID (public.chunks.id) — for callers (api/sessions.py) saving
        # provenance into zone3.chat_messages.cited_chunk_ids. Not present
        # unless the caller's SQL selected it.
        "chunk_id": str(r["id"]) if "id" in r else None,
    }


async def run_query(
    *,
    pool: asyncpg.Pool,
    embedding_model: SentenceTransformer,
    llm_providers: list,
    question: str,
    engagement_id: str,
    history: list | None = None,
    user_name: str | None = None,
) -> dict:
    """The full pipeline: intent-routed structured answers, the summarize
    shortcut, or embed→search→threshold→answer.

    `history` is the session's recent messages ([{role, content}, ...]) for
    conversational context — api/sessions.py passes it; POST /api/query
    leaves it empty.

    Returns the same shape POST /api/query responds with (answer, sources,
    abstained, provider, timing_seconds) — callers that also want to persist
    the exchange (api/sessions.py) can do so around this call without
    duplicating any retrieval/prompt/citation logic.
    """
    t_start = time.perf_counter()
    timings = {}

    # Structured intents (sprint lookup, recent-activity digest, project
    # overview, live code diff) bypass vector search entirely — their answers
    # come from ordered/live records, not nearest neighbors. Imported lazily
    # because intents.py imports nothing from this module at call time only.
    from api import intents

    t0 = time.perf_counter()
    intent_result = await intents.maybe_handle(
        pool=pool,
        question=question,
        engagement_id=engagement_id,
        llm_providers=llm_providers,
        ctx={"CONTEXT_CHARS": CONTEXT_CHARS, "SNIPPET_CHARS": SNIPPET_CHARS},
        user_name=user_name,
    )
    timings["intent"] = time.perf_counter() - t0
    if intent_result is not None:
        timings["total"] = time.perf_counter() - t_start
        report.write_report(
            question=question,
            engagement_id=engagement_id,
            abstained=intent_result["abstained"],
            top_score=None,
            provider=intent_result.get("provider"),
            answer=intent_result["answer"],
            sources=intent_result["sources"],
            timings=timings,
        )
        intent_result["timing_seconds"] = round(timings["total"], 3)
        return intent_result

    # Shortcut — "Summarize KPD-33": skip embedding/vector search and fetch
    # that one ticket directly, so the answer is grounded in exactly the
    # ticket asked for rather than whatever else the top-5 search turns up.
    ticket_id = extract_summarize_ticket(question)
    if ticket_id:
        t0 = time.perf_counter()
        row = await pool.fetchrow(TICKET_LOOKUP_SQL, engagement_id, ticket_id)
        timings["search"] = time.perf_counter() - t0

        if row is None:
            timings["total"] = time.perf_counter() - t_start
            report.write_report(
                question=question,
                engagement_id=engagement_id,
                abstained=True,
                top_score=None,
                provider=None,
                answer=ABSTAIN_ANSWER,
                sources=[],
                timings=timings,
            )
            return {
                "answer": ABSTAIN_ANSWER,
                "sources": [],
                "abstained": True,
                "timing_seconds": round(timings["total"], 3),
            }

        result = dict(row)
        context = "[{doc}] ({kind}): {text}".format(
            doc=result["source_doc_id"],
            kind=result["source_type"],
            text=result["content"][:CONTEXT_CHARS],
        )
        prompt = SUMMARIZE_PROMPT_TEMPLATE.format(context=context, ticket_id=ticket_id)

        t0 = time.perf_counter()
        try:
            answer, provider_used = await llm.generate_answer(llm_providers, prompt)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="LLM call failed: {}".format(exc))
        timings["llm"] = time.perf_counter() - t0
        timings["total"] = time.perf_counter() - t_start

        sources = [_source_dict(r) for r in filter_cited_sources(answer, [result])]

        report.write_report(
            question=question,
            engagement_id=engagement_id,
            abstained=False,
            top_score=None,
            provider=provider_used,
            answer=answer,
            sources=sources,
            timings=timings,
        )

        return {
            "answer": answer,
            "sources": sources,
            "abstained": False,
            "provider": provider_used,
            "timing_seconds": round(timings["total"], 3),
        }

    # Step 1 — embed the question with the same model that built the index.
    # encode() is CPU-bound and blocking, so keep it off the event loop.
    t0 = time.perf_counter()
    vec = await run_in_threadpool(embed, embedding_model, question)
    timings["embed"] = time.perf_counter() - t0

    # Step 2 — cosine search against the engagement's chunks.
    t0 = time.perf_counter()
    rows = await pool.fetch(SEARCH_SQL, to_pgvector(vec), engagement_id, TOP_K)
    results = [dict(r) for r in rows]
    timings["search"] = time.perf_counter() - t0

    top_score = results[0]["score"] if results else None

    # Step 3 — abstain rather than answer from weak grounding.
    if not results or top_score < THRESHOLD:
        timings["total"] = time.perf_counter() - t_start
        report.write_report(
            question=question,
            engagement_id=engagement_id,
            abstained=True,
            top_score=top_score,
            provider=None,
            answer=ABSTAIN_ANSWER,
            sources=[],
            timings=timings,
        )
        return {
            "answer": ABSTAIN_ANSWER,
            "sources": [],
            "abstained": True,
            "timing_seconds": round(timings["total"], 3),
        }

    # Only keep chunks that individually clear the bar — TOP_K widens the net
    # to catch near-duplicate tickets that add real detail, but a long tail of
    # weakly-related chunks would dilute the answer and get cited as if they
    # were equally relevant as the top match.
    results = [r for r in results if r["score"] >= THRESHOLD]

    # Step 4 — cited answer from the retrieved context only.
    history_block = ""
    if history:
        lines = [
            "{}: {}".format("Teammate" if m["role"] == "user" else "Assistant", m["content"][:400])
            for m in history[-4:]
        ]
        history_block = HISTORY_BLOCK_TEMPLATE.format(history="\n".join(lines))

    t0 = time.perf_counter()
    prompt = PROMPT_TEMPLATE.format(
        context=build_context(results),
        question=question,
        history_block=history_block,
        style=intents.depth_directive(question),
    )
    try:
        answer, provider_used = await llm.generate_answer(llm_providers, prompt)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="LLM call failed: {}".format(exc))
    timings["llm"] = time.perf_counter() - t0
    timings["total"] = time.perf_counter() - t_start

    # Only return sources the answer actually cites — a chunk clearing the
    # score threshold was relevant enough to hand to the model, but that
    # doesn't mean the model drew on it. A refusal cites nothing, so this
    # naturally empties `sources` for one instead of listing chunks the
    # final answer never referenced.
    sources = [_source_dict(r) for r in filter_cited_sources(answer, results)]

    report.write_report(
        question=question,
        engagement_id=engagement_id,
        abstained=False,
        top_score=top_score,
        provider=provider_used,
        answer=answer,
        sources=sources,
        timings=timings,
    )

    return {
        "answer": answer,
        "sources": sources,
        "abstained": False,
        "provider": provider_used,
        "timing_seconds": round(timings["total"], 3),
    }


class QueryRequest(BaseModel):
    question: str
    engagement_id: str = DEFAULT_ENGAGEMENT_ID


@router.post("/api/query")
async def query(req: QueryRequest, request: Request):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    return await run_query(
        pool=request.app.state.pool,
        embedding_model=await ready_model(request),
        llm_providers=request.app.state.llm_providers,
        question=question,
        engagement_id=req.engagement_id,
    )
