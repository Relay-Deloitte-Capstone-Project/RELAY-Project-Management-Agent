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
from typing import Optional

import asyncpg
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from starlette.concurrency import run_in_threadpool

from api import llm, report
from api.access import require_access
from api.auth import try_verify_user

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

# Lexical half of hybrid retrieval — hits idx_chunks_content_tsvector (a GIN
# index that existed in the schema but nothing ever queried). Vector search
# alone misses exact identifiers: SOW clause numbers, dollar figures, ticket
# keys, error codes. plainto_tsquery on a question full of stopwords often
# still ranks the chunk containing the literal term above the embedding's
# nearest neighbor would.
KEYWORD_SEARCH_SQL = """
    SELECT id,
           source_doc_id,
           source_type,
           content,
           metadata,
           ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) AS score
    FROM public.chunks
    WHERE engagement_id = $2
      AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
    ORDER BY score DESC
    LIMIT $3
"""

# Reciprocal Rank Fusion constant (standard default from the IR literature —
# large enough that rank 1 vs rank 2 in either list isn't wildly overweighted).
RRF_K = 60

# Retrieve this many from each of vector/keyword search before fusing down to
# TOP_K — wide enough that a chunk ranked #12 by cosine but #1 by exact term
# match still gets pulled in.
FUSION_POOL = TOP_K * 3

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


def fuse_hybrid_results(vector_results: list, keyword_results: list) -> list:
    """Merge vector and keyword rankings via Reciprocal Rank Fusion.

    RRF combines two rankings without needing their scores on the same scale
    (cosine similarity and ts_rank aren't comparable numbers) — each result's
    fused score is the sum of 1/(RRF_K + rank) across whichever list(s) it
    appears in, so a chunk ranked highly by either method rises to the top.
    The original vector `score` (cosine similarity) is preserved on each row
    for the abstention threshold check, which only ever looks at vector
    confidence — RRF only decides ordering and which extra chunks get in.
    """
    fused: dict = {}
    for rank, r in enumerate(vector_results):
        entry = fused.setdefault(r["id"], dict(r))
        entry["_rrf"] = entry.get("_rrf", 0.0) + 1.0 / (RRF_K + rank + 1)
    for rank, r in enumerate(keyword_results):
        is_new = r["id"] not in fused
        entry = fused.setdefault(r["id"], dict(r))
        entry["_rrf"] = entry.get("_rrf", 0.0) + 1.0 / (RRF_K + rank + 1)
        entry["keyword_rank"] = rank
        if is_new:
            # This chunk's only "score" so far is KEYWORD_SEARCH_SQL's
            # ts_rank, aliased as `score` for that query alone — it is not on
            # the same 0-1 cosine scale THRESHOLD is calibrated against, so it
            # must not leak into the `score` field the abstention/threshold
            # check reads.
            entry["score"] = None
    return sorted(fused.values(), key=lambda r: r["_rrf"], reverse=True)


def extract_summarize_ticket(question: str):
    """Return the ticket key a "summarize KPD-33"-style question names, else None."""
    if not SUMMARIZE_INTENT_RE.search(question):
        return None
    m = TICKET_KEY_RE.search(question)
    return m.group(1) if m else None


def _normalize_person(name: Optional[str]) -> str:
    """Collapse the different spellings the same person's identity shows up
    under across Jira and GitHub — "Agrim_Gairola" (commit author) vs "Agrim
    Gairola" (project_staffing), or a GitHub username with a numeric suffix
    like "Anya-Gupta-05" vs "Anya Gupta". Same normalization idea as
    api/project.py's _person_key, duplicated (not imported) since this is a
    retrieval-safety check query.py must own outright — plus it goes one
    step further and drops a trailing all-numeric token, which _person_key
    doesn't need to since it never has to reconcile GitHub-username-style
    author strings the way this commit-authorship check does.
    """
    if not name:
        return ""
    tokens = name.replace("_", " ").replace("-", " ").strip().lower().split()
    if tokens and tokens[-1].isdigit():
        tokens = tokens[:-1]
    return " ".join(tokens)


async def _commit_author_allowlist(pool, engagement_id: str, requester_name: Optional[str]) -> set:
    """Every raw `metadata->>'author'` string on this engagement's commit
    chunks that normalizes to the same person as the requester. An empty or
    unresolved requester name yields an empty set — fail closed, not open:
    a commit wrongly hidden from its own author is a minor annoyance: a
    commit wrongly shown to someone else is the actual harm this guards
    against, so an ambiguous match must never resolve to "allow"."""
    key = _normalize_person(requester_name)
    if not key:
        return set()
    rows = await pool.fetch(
        "SELECT DISTINCT metadata->>'author' AS author FROM public.chunks "
        "WHERE engagement_id = $1 AND source_type = 'github_commit' "
        "AND metadata->>'author' IS NOT NULL",
        engagement_id,
    )
    return {r["author"] for r in rows if _normalize_person(r["author"]) == key}


def _commit_meta(r: dict) -> dict:
    meta = r.get("metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
    return meta


def filter_commit_authorship(results: list, allowlist: set) -> list:
    """Drop any github_commit chunk not authored by the requester, before
    the prompt is built — not just before the response is returned. The
    model must never see another developer's commit content in the first
    place; telling it not to repeat something it already read is not a
    guardrail, it's a request. Tickets, PRs, and every other source type
    pass through unchanged — this is scoped to commits only, per the
    security review that asked for it."""
    return [
        r
        for r in results
        if r["source_type"] != "github_commit" or _commit_meta(r).get("author") in allowlist
    ]


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
    history: Optional[list] = None,
    user_name: Optional[str] = None,
) -> dict:
    """The full pipeline: intent-routed structured answers, the summarize
    shortcut, or embed→search→threshold→answer.

    `history` is the session's recent messages ([{role, content}, ...]) for
    conversational context — api/sessions.py passes it; POST /api/query
    leaves it empty.

    `user_name` MUST be the server-verified display name from api.auth's
    decoded bearer token, never a client-supplied string — it now doubles as
    the identity the GitHub-commit authorship guardrail (below) checks
    retrieved commit chunks against, on top of its original job of resolving
    "my tickets"-style first-person questions in api/intents.py. A commit
    chunk not authored by this person is dropped before the prompt is ever
    built, regardless of how relevant retrieval judged it.

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

    # Step 2 — hybrid search: cosine similarity (semantic) fused with
    # full-text keyword search (exact terms — SOW clause numbers, dollar
    # figures, error codes, ticket keys — that embeddings sometimes rank low
    # despite being the literal answer). Both run against the same
    # engagement scope; keyword search is skipped only if the question has
    # no indexable terms (plainto_tsquery returns empty, e.g. pure punctuation).
    t0 = time.perf_counter()
    vector_rows = await pool.fetch(SEARCH_SQL, to_pgvector(vec), engagement_id, FUSION_POOL)
    vector_results = [dict(r) for r in vector_rows]
    try:
        keyword_rows = await pool.fetch(KEYWORD_SEARCH_SQL, question, engagement_id, FUSION_POOL)
        keyword_results = [dict(r) for r in keyword_rows]
    except asyncpg.PostgresError:
        keyword_results = []
    timings["search"] = time.perf_counter() - t0

    # Grounding confidence is judged on semantic similarity alone — ts_rank
    # has no comparable scale and a lucky keyword hit on an off-topic chunk
    # must never talk the pipeline into answering when it otherwise shouldn't.
    top_score = vector_results[0]["score"] if vector_results else None

    # Step 3 — abstain rather than answer from weak grounding.
    if not vector_results or top_score < THRESHOLD:
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

    # Fuse the two rankings, then keep only chunks that either (a) individually
    # clear the semantic bar, or (b) are a strong exact-text match (top half of
    # the keyword pool) even if their embedding similarity alone wouldn't have
    # cleared THRESHOLD — this is what lets an exact SOW clause/figure surface
    # even when it's phrased nothing like the question.
    strong_keyword_ids = {r["id"] for r in keyword_results[: max(1, TOP_K // 2)]}
    fused = fuse_hybrid_results(vector_results, keyword_results)
    results = [
        r for r in fused
        if (r.get("score") is not None and r["score"] >= THRESHOLD) or r["id"] in strong_keyword_ids
    ][:TOP_K]

    # Guardrail — a developer can ask about their own GitHub commits but not
    # anyone else's; tickets/PRs/docs stay team-visible as before. Only pay
    # for the allowlist lookup when a commit chunk actually made the cut.
    if any(r["source_type"] == "github_commit" for r in results):
        t0 = time.perf_counter()
        allowlist = await _commit_author_allowlist(pool, engagement_id, user_name)
        results = filter_commit_authorship(results, allowlist)
        timings["authorship_filter"] = time.perf_counter() - t0

        if not results:
            timings["total"] = time.perf_counter() - t_start
            answer = (
                "The most relevant records for that were GitHub commits authored by "
                "someone else — I can only answer about your own commits, not a "
                "teammate's. Ask about a ticket instead, or ask them directly."
            )
            report.write_report(
                question=question,
                engagement_id=engagement_id,
                abstained=True,
                top_score=top_score,
                provider=None,
                answer=answer,
                sources=[],
                timings=timings,
            )
            return {
                "answer": answer,
                "sources": [],
                "abstained": True,
                "timing_seconds": round(timings["total"], 3),
            }

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
    # No longer used for access control (see the /api/query handler below) —
    # a client-supplied email/user_id can't be trusted for authorization.
    # Kept optional, accepted-but-ignored for backward compatibility with any
    # existing caller still sending them.
    user_id: Optional[str] = None
    email: Optional[str] = None


@router.post("/api/query")
async def query(req: QueryRequest, request: Request):
    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    pool = request.app.state.pool

    # Verified identity (if a bearer token was sent) feeds both the staffing
    # check below and the GitHub-commit authorship guardrail in run_query —
    # never the client-supplied req.email/req.user_id fields, which used to
    # gate this check (`if req.email is not None: ...`) despite being plain
    # request-body strings: omitting email skipped the check outright, and
    # supplying any guessed/known staffed email passed it trivially. A real
    # bearer token always gets its membership checked now; no token at all
    # (internal scripts/eval, which have no login context) keeps the
    # existing behavior of skipping this specific check — same accepted
    # trade-off the commit-authorship guardrail below already makes, which
    # is why it fails closed on a missing identity instead of open.
    verified = try_verify_user(request)
    if verified is not None:
        await require_access(pool, verified["email"], req.engagement_id)

    return await run_query(
        pool=pool,
        embedding_model=await ready_model(request),
        llm_providers=request.app.state.llm_providers,
        question=question,
        engagement_id=req.engagement_id,
        user_name=verified["name"] if verified else None,
    )
