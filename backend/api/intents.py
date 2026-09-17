"""Intent routing for Ask Project.

run_query() used to send every question down the same embed→top-k→prompt
path. That works for "what was the webhook issue" but fails whole classes
of questions whose answers are *structured*, not nearest-neighbor:

- "What was Sprint-03 about?"        → live Jira Agile API, not chunks
- "List recent bugs / code changes"  → SQL over chunk metadata, ordered
- "What are we building?"            → seeded project-overview chunks
- "Show me the code that fixed X"    → live GitHub diff, never stored

maybe_handle() returns a finished result dict (same shape as run_query's
return) or None to fall through to default RAG. Every path keeps the same
guardrails: answer only from fetched records, say "not found" plainly,
cite only what was used, decline out-of-project requests.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re

import asyncpg

from api import github_client, jira_client, llm
from api.query import _commit_author_allowlist, filter_commit_authorship

logger = logging.getLogger(__name__)

# --- classification ---------------------------------------------------------

SPRINT_RE = re.compile(r"\bsprint[\s\-_#]*0*(\d+)\b", re.IGNORECASE)

OVERVIEW_RE = re.compile(
    r"\b(mini[\s\-]?project|what (are we|is this project|is the project|is relay)"
    r"|project'?s? (goal|purpose|overview)|what are we (building|working on)"
    r"|goal of (this|the|our) project)\b",
    re.IGNORECASE,
)

RECENT_LIST_RE = re.compile(
    r"\b(list|show|give me|what are the|recent|latest|newest|all)\b", re.IGNORECASE
)
RECENT_TOPIC_RE = re.compile(
    r"\b(bugs?|code changes?|commits?|fixes|tickets?|issues?|changes?)\b", re.IGNORECASE
)

CODE_WORDS_RE = re.compile(
    r"\b(code|snippet|diff|patch|implementation|implemented|function|class"
    r"|what (code )?changed|lines? of code|show me the)\b",
    re.IGNORECASE,
)
FULL_SHA_RE = re.compile(r"\b[0-9a-f]{40}\b")
SHORT_SHA_RE = re.compile(r"\b[0-9a-f]{7,12}\b")
TICKET_KEY_RE = re.compile(r"\b([A-Z]+-\d+)\b")

# "describe KPD-28", "what is KPD-170 about", "status of KPD-7" — asks about
# the ticket itself, not about code (code intent is checked first and wins).
TICKET_ASK_RE = re.compile(
    r"\b(describe|description|about|what is|what's|whats|status of|brief"
    r"|explain|tell me about|details? (of|about|on|for)|summari[sz]e|summary"
    r"|solutions?|solve|how to (fix|solve|resolve)|fix|resolve|workaround)\b",
    re.IGNORECASE,
)

# "bugs for Akshar", "assigned to Anya", "commits by Akshar" — a capitalized
# name after a scoping preposition scopes the digest to that person.
PERSON_RE = re.compile(
    r"\b(?:for|assigned to|assignee[ds]? (?:is |to )?|raised (?:for|by|to)"
    r"|by|of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b"
)

# "Priya's bugs", "Akshar's open tickets" — possessive form names the person
# without any of the prepositions PERSON_RE looks for. Same underlying gap as
# the recent-intent fix below: natural phrasing shouldn't need to match a
# fixed set of sentence templates to resolve who's being asked about.
POSSESSIVE_PERSON_RE = re.compile(r"\b([A-Z][a-z]+)'s\b")

# "tickets for me", "my bugs", "what am I working on" — first person resolves
# to the logged-in user's display name (passed in from the session token).
FIRST_PERSON_RE = re.compile(r"\b(me|my|mine|myself|i'm|i am)\b", re.IGNORECASE)

# "in progress tickets", "open bugs", "done work" — narrows the digest to one
# Jira status. Values are normalized to the board's actual status names.
STATUS_RE = re.compile(
    r"\b(in progress|in review|to[\s-]?do|done|complete[d]?|open|blocked)\b",
    re.IGNORECASE,
)
STATUS_MAP = {
    "in progress": "In Progress",
    "in review": "In Review",
    "to do": "To Do",
    "todo": "To Do",
    "to-do": "To Do",
    "done": "Done",
    "complete": "Done",
    "completed": "Done",
    "open": "To Do",
    "blocked": "Blocked",
}

# --- SQL --------------------------------------------------------------------

OVERVIEW_LOOKUP_SQL = """
    SELECT id, source_doc_id, source_type, content, metadata
    FROM public.chunks
    WHERE engagement_id = $1 AND source_type = 'project_overview'
    ORDER BY source_doc_id
"""

RECENT_BUGS_SQL = """
    SELECT id, source_doc_id, source_type, content, metadata
    FROM public.chunks
    WHERE engagement_id = $1
      AND source_type = 'jira_ticket'
      AND metadata->>'issue_type' ILIKE 'bug'
    ORDER BY metadata->>'created_at' DESC
    LIMIT $2
"""

RECENT_COMMITS_SQL = """
    SELECT id, source_doc_id, source_type, content, metadata
    FROM public.chunks
    WHERE engagement_id = $1
      AND source_type = 'github_commit'
    ORDER BY metadata->>'date' DESC
    LIMIT $2
"""

# $3 (person) and $4 (status) are nullable — a NULL disables that filter, so
# one query covers plain / person-scoped / status-scoped / both.
RECENT_TICKETS_SQL = """
    SELECT id, source_doc_id, source_type, content, metadata
    FROM public.chunks
    WHERE engagement_id = $1
      AND source_type = 'jira_ticket'
      AND ($5::boolean OR metadata->>'issue_type' ILIKE 'bug')
      AND ($3::text IS NULL OR metadata->>'assignee' ILIKE '%' || $3 || '%')
      AND ($4::text IS NULL OR metadata->>'status' ILIKE '%' || $4 || '%')
    ORDER BY metadata->>'created_at' DESC
    LIMIT $2
"""

RECENT_COMMITS_SCOPED_SQL = """
    SELECT id, source_doc_id, source_type, content, metadata
    FROM public.chunks
    WHERE engagement_id = $1
      AND source_type = 'github_commit'
      AND ($3::text IS NULL OR metadata->>'author' ILIKE '%' || $3 || '%')
    ORDER BY metadata->>'date' DESC
    LIMIT $2
"""

# A "ticket key"-shaped token (letters-dash-digits) isn't always a Jira
# ticket — it might be a risk ID (R-01), a change request (CR-002), a
# decision (D-01), or a requirement (FR-05) from an ingested PM document.
# Checked only after both the chunk-store Jira lookup and the live Jira
# board come up empty, so a real ticket key is never shadowed by this.
ENTITY_LOOKUP_SQL = """
    SELECT id, source_doc_id, source_type, content, metadata, section_path, entities
    FROM public.chunks
    WHERE engagement_id = $1
      AND is_latest = TRUE
      AND (
            source_doc_id = $2
         OR entities @> ('{"risk_ids":["' || $2 || '"]}')::jsonb
         OR entities @> ('{"cr_refs":["' || $2 || '"]}')::jsonb
         OR entities @> ('{"decision_ids":["' || $2 || '"]}')::jsonb
         OR entities @> ('{"requirement_ids":["' || $2 || '"]}')::jsonb
         OR entities @> ('{"deliverable_ids":["' || $2 || '"]}')::jsonb
      )
    -- A chunk that IS the record (its own source_doc_id, e.g. the R-01 row
    -- itself) always outranks one that merely mentions the id in passing
    -- (e.g. a retro noting "per R-01") — otherwise an incidental mention
    -- elsewhere can crowd the real record out of a 5-row LIMIT.
    ORDER BY (source_doc_id = $2) DESC
    LIMIT 5
"""

TICKETS_BY_KEY_SQL = """
    SELECT id, source_doc_id, source_type, content, metadata
    FROM public.chunks
    WHERE engagement_id = $1
      AND source_type = 'jira_ticket'
      AND source_doc_id = ANY($2::text[])
"""

COMMIT_FOR_TICKET_SQL = """
    SELECT id, source_doc_id, source_type, content, metadata
    FROM public.chunks
    WHERE engagement_id = $1
      AND source_type = 'github_commit'
      AND (
            metadata->'ticket_refs' @> $2::jsonb
            OR metadata->>'message' ILIKE '%' || $3 || '%'
          )
    ORDER BY metadata->>'date' DESC
    LIMIT 1
"""

COMMIT_BY_SHA_SQL = """
    SELECT id, source_doc_id, source_type, content, metadata
    FROM public.chunks
    WHERE engagement_id = $1
      AND source_type = 'github_commit'
      AND (source_doc_id = $2 OR metadata->>'sha_short' = $2)
    LIMIT 1
"""

# --- answer style -----------------------------------------------------------

BRIEF_RE = re.compile(
    r"\b(quick|quickly|short|brief|briefly|tl;?dr|in short|one line|summary"
    r"|summari[sz]e|gist|in a nutshell)\b",
    re.IGNORECASE,
)
DETAILED_RE = re.compile(
    r"\b(detail|detailed|in depth|in-depth|thorough|thoroughly|explain"
    r"|step by step|walk me through|elaborate|full picture|deep dive"
    r"|everything about|why)\b",
    re.IGNORECASE,
)


def depth_directive(question: str) -> str:
    """One style sentence injected into every prompt, derived from how the
    user phrased the question — 'quick snippet' asks for brevity, 'explain in
    depth' asks for thoroughness, anything else gets the default middle ground."""
    if DETAILED_RE.search(question):
        return (
            "Depth: the user asked for a thorough explanation — cover the "
            "background, the reasoning, and the impact, not just the headline."
        )
    if BRIEF_RE.search(question):
        return (
            "Depth: the user asked for something quick — keep it tight, lead "
            "with the direct answer, skip background they didn't ask for."
        )
    return "Depth: balanced — a clear direct answer with enough context to be useful."


# --- prompts ----------------------------------------------------------------

SPRINT_PROMPT = """You are a project knowledge assistant. A teammate asked: "{question}"
{style}
Below is live data from the team's Jira board for {sprint_name}. Explain what
this sprint is about: its goal, the main themes, and the most important items.
Write a short opening paragraph, then a compact list of up to 8 key items, one
per line starting with "- ". Cite each item's ticket key inline in square
brackets, like [KPD-123]. Use ONLY the data below — never invent items.
If the question asks about something not related to this sprint, say so in one
sentence. Plain text only, no markdown headers or bold.

SPRINT DATA:
{context}

ANSWER:"""

RECENT_PROMPT = """You are a project knowledge assistant. A teammate asked: "{question}"
{style}
Below are the most recent records from this project's tracker and repository,
newest first. Give a structured digest: start with one sentence summarizing the
overall theme, then list the items, one per line starting with "- " — for each,
the key, a short description, and why it matters, with the citation inline in
square brackets, like [KPD-123] or [{sha_example}] for commits. Cover the items
below; do not invent others, and skip any item that is an exact duplicate of
another. Plain text only, no markdown headers or bold.

RECORDS:
{context}

ANSWER:"""

OVERVIEW_PROMPT = """You are a project knowledge assistant. A teammate asked: "{question}"
{style}
Using ONLY the project overview below, explain what this project is, what the
team is building, and what the goal is. Plain sentences, and cite the
overview inline as [{doc_id}]. If the overview doesn't answer part of the
question, say so plainly. Plain text only, no markdown.

PROJECT OVERVIEW:
{context}

ANSWER:"""

CODE_PROMPT = """You are a project knowledge assistant. A teammate asked: "{question}"
{style}
Below is the live diff of commit {sha_short} fetched from GitHub just now.
Answer in this structure, plain text:
1. "Summary:" — what the change does and why, citing [{sha_short}].
2. "Files:" — one line per changed file, starting with "- ".
3. "Snippet:" — the single most relevant hunk for the question, at most 15
   lines, between triple backticks. Quote it verbatim from the diff; never
   invent code that isn't in the diff.
Adjust the summary length to the requested depth. If the diff doesn't relate
to the question, say so and skip the snippet.

DIFF:
{context}

ANSWER:"""

CODE_CHUNK_FALLBACK_PROMPT = """You are a project knowledge assistant. A teammate asked: "{question}"
{style}
The live diff for commit {sha_short} could not be fetched from GitHub right
now, so answer from the commit record below instead. Structure, plain text:
1. Start with one sentence saying the live code couldn't be fetched.
2. "Summary:" — what the commit did and why, citing [{sha_short}].
3. "Rough idea:" — ONLY if the user asked for code/a snippet: a short
   pseudo-code sketch (at most 8 lines, between triple backticks) inferred
   from the commit description. Label it clearly as pseudo-code, not the
   actual code. Never present it as real code from the repo, and never
   invent exact function names that aren't in the record.

COMMIT RECORD:
{context}

ANSWER:"""


TICKET_PROMPT = """You are a project knowledge assistant. A teammate asked: "{question}"
{style}
Below is the record for ticket {ticket_key}{live_note}. Describe the ticket:
what it is about, its current status and assignee, and why it matters. Cite
the ticket inline as [{ticket_key}]. Use ONLY the record below — if it doesn't
answer part of the question, say so plainly instead of guessing. Plain text
only, no markdown headers or bold.
If the question asks you to propose a solution, fix, or implementation, do not
design one — you report what the project's records say, you do not invent
fixes. Decline that part in one sentence, then still describe the record.

TICKET RECORD:
{context}

ANSWER:"""


def _meta(r: dict) -> dict:
    """asyncpg returns jsonb columns as raw strings unless a codec is set."""
    m = r.get("metadata")
    if isinstance(m, str):
        try:
            return json.loads(m)
        except Exception:
            return {}
    return m or {}


def _short_id(r: dict) -> str:
    """Display/citation id: tickets use their key, commits their short sha."""
    if r["source_type"] == "github_commit":
        return _meta(r).get("sha_short") or r["source_doc_id"][:7]
    return r["source_doc_id"]


def build_context(results: list, context_chars: int) -> str:
    return "\n\n".join(
        "[{doc}] ({kind}): {text}".format(
            doc=_short_id(r), kind=r["source_type"], text=r["content"][:context_chars]
        )
        for r in results
    )


def filter_cited_sources(answer: str, results: list) -> list:
    """Keep chunks the model actually cited — by ticket key, short sha, or
    full sha (the model doesn't always follow the exact id form)."""
    cited = []
    for r in results:
        ids = {r["source_doc_id"], _short_id(r)}
        if any(re.search(r"\[\s*{}\s*\]".format(re.escape(i)), answer) for i in ids):
            cited.append(r)
    return cited


def source_dict(r: dict, snippet_chars: int) -> dict:
    return {
        "source_doc_id": r["source_doc_id"],
        "source_type": r["source_type"],
        "snippet": r["content"][:snippet_chars],
        "chunk_id": str(r["id"]) if "id" in r else None,
    }


# --- semantic fallback classification ---------------------------------------
#
# classify() below is a regex net: fast, free, and exactly right for the
# syntactic intents (a ticket key, a sha, "sprint 3" — fixed formats, not
# natural language). It's also the whole reason "my open tickets" and
# "Priya's bugs" silently misfired until this fixed them — every future
# document type and every new phrasing anyone naturally uses is another
# regex someone has to think to add. That doesn't scale to "10+ documents +
# Jira + GitHub" the way an actual understanding of the question does.
#
# So the regex net stays (it's instant and covers the common phrasings for
# free), but when it finds nothing, one small classification call gets a
# real read on the question before conceding to plain vector RAG — which has
# no notion of "assigned to me" or "status = To Do" at all, and would just
# quietly return an unhelpful answer the way it did for Agrim. A JSON parse
# failure, timeout, or provider outage here simply falls through to RAG
# exactly as today — this can only add coverage, never remove it.

CLASSIFY_PROMPT = """A teammate is using a project chatbot backed by this project's \
Jira tickets and GitHub commits. Their question: "{question}"

Logged-in user's display name: {user_name}

Decide whether this question is asking for a FILTERED LIST of tickets/bugs/commits
— scoped to a person and/or a status — as opposed to a general question about the
project, a specific named ticket, or something unrelated. Examples that ARE a
filtered list request: "my open tickets", "what's Priya working on", "bugs still
in progress", "Akshar's done items". Examples that are NOT: "what is KPD-33 about",
"how was the webhook bug fixed", "what does the SOW say about retention".

If the question uses "I/me/my/mine" to refer to the asker, the person is the
logged-in user's display name above — never leave it null in that case.

Respond with ONLY a JSON object, nothing else:
{{"is_digest": <true|false>, "person": <string name or null>, "status": <one of "To Do", "In Progress", "In Review", "Done", "Blocked", or null>, "bugs_only": <true|false>}}
"""

_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)

_VALID_STATUSES = {"To Do", "In Progress", "In Review", "Done", "Blocked"}

# A semantic classification call is worth the wait only if it's fast — past
# this, falling through to plain RAG (instant) beats making the user stare at
# a blank chat waiting for a classifier that was supposed to save them time.
CLASSIFY_TIMEOUT_SECONDS = 6.0


def _worth_semantic_check(question: str, user_name: str | None) -> bool:
    """Cheap necessary-but-not-sufficient gate: does this question even
    reference a person or a status at all? A ticket/commit digest request
    always does (a name, a possessive, "my/me", or a status word) — a plain
    content question about the project almost never does. This is what keeps
    classify_semantic()'s extra LLM call off the common path, without going
    back to requiring an exact topic word the way the old regex-only version
    did (that specificity was the actual bug)."""
    if user_name and FIRST_PERSON_RE.search(question):
        return True
    if PERSON_RE.search(question) or POSSESSIVE_PERSON_RE.search(question):
        return True
    if STATUS_RE.search(question):
        return True
    return False


async def classify_semantic(
    question: str, user_name: str | None, llm_providers: list
) -> tuple[str, object] | None:
    """LLM fallback for when classify()'s regex net finds nothing. Returns a
    ("recent", (person, status)) tuple like classify() would, or None to fall
    through to default RAG — never raises, so a bad response, a timeout, or
    every provider being down just means "no smarter than before", not a
    broken request."""
    if not llm_providers:
        return None
    prompt = CLASSIFY_PROMPT.format(question=question, user_name=user_name or "(unknown)")
    try:
        answer, _ = await asyncio.wait_for(
            llm.generate_answer(llm_providers, prompt), timeout=CLASSIFY_TIMEOUT_SECONDS
        )
        m = _JSON_OBJECT_RE.search(answer)
        if not m:
            return None
        data = json.loads(m.group(0))
    except Exception:
        logger.info("classify_semantic: falling through to RAG", exc_info=True)
        return None

    person = data.get("person") or None
    if isinstance(person, str):
        person = person.strip() or None
        if person and person.lower() in {"unknown", "null", "none"}:
            person = None

    status = data.get("status") or None
    if status not in _VALID_STATUSES:
        status = None

    # is_digest is a useful signal but an inconsistent one in practice — a
    # model that clearly extracted a real person/status ("what has Priya
    # wrapped up" -> person=Priya, status=Done) sometimes still marks
    # is_digest false. Trust the extraction itself: fall through to RAG only
    # when nothing concrete was found to filter on — which is also the
    # model's own signal that this wasn't a digest request at all, and
    # avoids dumping an unscoped "all tickets" digest the question never
    # asked for.
    if person is None and status is None:
        return None

    return ("recent", (person, status))


def classify(question: str, user_name: str | None = None) -> tuple[str, object] | None:
    """Return (intent_name, match_payload) or None for default RAG.

    The recent intent's payload is (person, status): person comes from a name
    in the question or, for first-person phrasing ("my tickets"), from the
    logged-in user's display name; status from words like "in progress".
    """
    m = SPRINT_RE.search(question)
    if m:
        return ("sprint", int(m.group(1)))
    if OVERVIEW_RE.search(question):
        return ("overview", None)
    ticket = TICKET_KEY_RE.search(question)
    if CODE_WORDS_RE.search(question):
        m = FULL_SHA_RE.search(question) or SHORT_SHA_RE.search(question)
        if m:
            return ("code", ("sha", m.group(0)))
        if ticket:
            return ("code", ("ticket", ticket.group(1)))
    # Asking about a named ticket itself — point lookup, never RAG, so the
    # answer can't be filled in from whatever else vector search turns up.
    if ticket and TICKET_ASK_RE.search(question):
        return ("ticket", ticket.group(1))
    if RECENT_TOPIC_RE.search(question):
        person = PERSON_RE.search(question) or POSSESSIVE_PERSON_RE.search(question)
        person_name = person.group(1) if person else None
        is_first_person = person_name is None and bool(user_name) and bool(
            FIRST_PERSON_RE.search(question)
        )
        if is_first_person:
            person_name = user_name
        status_m = STATUS_RE.search(question)
        status = STATUS_MAP.get(status_m.group(1).lower()) if status_m else None
        # A plain noun phrase naming a person or status ("my open tickets",
        # "Priya's bugs", "in progress tickets") is just as much a structured
        # request as one phrased with an enumerating verb ("show/list/recent
        # tickets") — routing only the latter to SQL meant every other
        # phrasing silently fell through to vector RAG, which has no way to
        # filter by assignee or status at all. Requiring RECENT_LIST_RE only
        # when none of person/first-person/status fired keeps a bare "bugs?"
        # or "issues?" mention (e.g. "what issues might this clause cause")
        # from misrouting when there's no actual filter to apply.
        if RECENT_LIST_RE.search(question) or person_name or status:
            return ("recent", (person_name, status))
    return None


# --- handlers ---------------------------------------------------------------


async def handle_sprint(pool, question, engagement_id, sprint_num, llm_providers, ctx):
    # "sprintNN" in the question doesn't always mean "the live Jira sprint" —
    # it also matches things like a sprint-review document's filename
    # ("sprint_review_sprint13"). When there's no live sprint to answer from
    # (Jira not configured, or no sprint with this number on the board),
    # returning None here defers to default RAG instead of dead-ending, so a
    # question like that can still be answered from the indexed document.
    if not jira_client.configured():
        return None

    sprints = await jira_client.list_sprints()
    sprint = next(
        (
            s
            for s in sprints
            if re.search(r"\b0*{}\b".format(sprint_num), s.get("name", ""))
        ),
        None,
    )
    if sprint is None:
        return None

    issues = await jira_client.sprint_issues(
        sprint["id"], fields="summary,status,assignee,priority,issuetype"
    )
    lines = [
        "Sprint: {}".format(sprint.get("name")),
        "State: {}".format(sprint.get("state")),
        "Goal: {}".format(sprint.get("goal") or "(no goal set)"),
        "Dates: {} → {}".format(sprint.get("startDate", "?"), sprint.get("endDate", "?")),
        "",
        "Issues ({}): ".format(len(issues)),
    ]
    keys = []
    for i in issues:
        f = i.get("fields", {})
        keys.append(i["key"])
        lines.append(
            "{key}: {summary} [{status}, {priority}, assignee: {assignee}]".format(
                key=i["key"],
                summary=f.get("summary", ""),
                status=(f.get("status") or {}).get("name", "?"),
                priority=(f.get("priority") or {}).get("name", "?"),
                assignee=(f.get("assignee") or {}).get("displayName", "unassigned"),
            )
        )

    # Citations resolve against the ticket chunks already in zone1.
    rows = await pool.fetch(TICKETS_BY_KEY_SQL, engagement_id, keys)
    chunks = [dict(r) for r in rows]

    prompt = SPRINT_PROMPT.format(
        question=question,
        sprint_name=sprint.get("name"),
        context="\n".join(lines),
        style=depth_directive(question),
    )
    answer, provider = await llm.generate_answer(llm_providers, prompt)
    return {
        "answer": answer,
        "sources": [source_dict(r, ctx["SNIPPET_CHARS"]) for r in filter_cited_sources(answer, chunks)],
        "abstained": False,
        "provider": provider,
    }


async def handle_recent(pool, question, engagement_id, payload, llm_providers, ctx, requester_name=None):
    person, status = payload
    # "bugs"/"fixes" restrict to bug-type tickets; a plain "tickets"/"issues"
    # question (or a status filter like "in progress") means any issue type.
    bugs_only = bool(re.search(r"\b(bugs?|fixes)\b", question, re.I))
    wants_tickets = re.search(r"\b(bugs?|tickets?|issues?|fixes)\b", question, re.I)
    wants_commits = re.search(r"\b(commits?|code changes?|changes?)\b", question, re.I)
    if status:
        wants_tickets = True
        if not re.search(r"\b(commits?|code changes?)\b", question, re.I):
            wants_commits = False
    if not wants_tickets and not wants_commits:
        wants_tickets = wants_commits = True

    results = []
    if wants_tickets:
        results += [
            dict(r)
            for r in await pool.fetch(
                RECENT_TICKETS_SQL, engagement_id, 8, person, status, not bugs_only
            )
        ]
    commits_blocked = False
    if wants_commits:
        commit_rows = [
            dict(r)
            for r in await pool.fetch(RECENT_COMMITS_SCOPED_SQL, engagement_id, 8, person)
        ]
        # Guardrail: whatever the content filter above matched (a named
        # person, or nobody — which would otherwise mean "everyone's"),
        # only commits the requester actually authored ever reach the
        # model. A "commits by <someone else>" question doesn't error, it
        # just comes back with nothing to show, same shape as any other
        # empty result.
        allowlist = await _commit_author_allowlist(pool, engagement_id, requester_name)
        allowed_commits = filter_commit_authorship(commit_rows, allowlist)
        commits_blocked = bool(commit_rows) and not allowed_commits
        results += allowed_commits

    if not results:
        if commits_blocked:
            return {
                "answer": (
                    "Those commits belong to a teammate, not you — I can only answer "
                    "about your own GitHub commits. Ask about the ticket instead, or "
                    "ask them directly."
                ),
                "sources": [],
                "abstained": True,
                "provider": None,
            }
        scope = ""
        if person and status:
            scope = " for {} with status {}".format(person, status)
        elif person:
            scope = " for {}".format(person)
        elif status:
            scope = " with status {}".format(status)
        return {
            "answer": "I don't have any recent records of that kind{} in this "
            "project's data. If that's unexpected, the name or status wording "
            "may not match the board exactly.".format(scope),
            "sources": [],
            "abstained": not person,
            "provider": None,
        }

    sha_example = next(
        (_short_id(r) for r in results if r["source_type"] == "github_commit"),
        "467d828",
    )
    context = build_context(results, ctx["CONTEXT_CHARS"])
    scope_bits = []
    if person:
        scope_bits.append("assignee/author matching '{}'".format(person))
    if status:
        scope_bits.append("status '{}'".format(status))
    if scope_bits:
        # Tell the model the records are already scoped — otherwise it can
        # still frame unfiltered context as belonging to the named person.
        context = (
            "Scope: every record below is already filtered to {}. Do not "
            "attribute anything beyond these records.\n\n".format(
                " and ".join(scope_bits)
            )
        ) + context
    prompt = RECENT_PROMPT.format(
        question=question,
        context=context,
        sha_example=sha_example,
        style=depth_directive(question),
    )
    answer, provider = await llm.generate_answer(llm_providers, prompt)
    return {
        "answer": answer,
        "sources": [source_dict(r, ctx["SNIPPET_CHARS"]) for r in filter_cited_sources(answer, results)],
        "abstained": False,
        "provider": provider,
    }


async def handle_overview(pool, question, engagement_id, llm_providers, ctx):
    rows = await pool.fetch(OVERVIEW_LOOKUP_SQL, engagement_id)
    if not rows:
        return None  # nothing seeded yet — let default RAG try
    results = [dict(r) for r in rows]
    prompt = OVERVIEW_PROMPT.format(
        question=question,
        context=build_context(results, ctx["CONTEXT_CHARS"]),
        doc_id=results[0]["source_doc_id"],
        style=depth_directive(question),
    )
    answer, provider = await llm.generate_answer(llm_providers, prompt)
    return {
        "answer": answer,
        "sources": [source_dict(r, ctx["SNIPPET_CHARS"]) for r in filter_cited_sources(answer, results)],
        "abstained": False,
        "provider": provider,
    }


CODE_ACCESS_DENIED = {
    "answer": (
        "That commit belongs to a teammate, not you — I can only show your own "
        "commit diffs. Ask about the ticket instead, or ask them directly."
    ),
    "sources": [],
    "abstained": True,
    "provider": None,
}


async def handle_code(pool, question, engagement_id, payload, llm_providers, ctx, requester_name=None):
    if not github_client.configured():
        return None  # no token — fall back to RAG, which can still describe

    kind, value = payload
    chunk = None
    if kind == "sha":
        row = await pool.fetchrow(COMMIT_BY_SHA_SQL, engagement_id, value)
        chunk = dict(row) if row else None
        sha = value
        repo = _meta(chunk or {}).get("repo") or os.environ.get("GITHUB_REPO", "")
    else:
        row = await pool.fetchrow(
            COMMIT_FOR_TICKET_SQL, engagement_id, '["{}"]'.format(value), value
        )
        chunk = dict(row) if row else None
        if not chunk:
            return None
        sha = chunk["source_doc_id"]
        repo = _meta(chunk).get("repo") or os.environ.get("GITHUB_REPO", "")

    if not repo:
        return None

    # Guardrail, checked before any diff content is fetched into the prompt.
    # A locally-known chunk gives its author straight from metadata; a raw
    # SHA with no local record has no author until fetched, so that case is
    # re-checked again below once the live commit itself names its author —
    # a diff is never composed or returned without an author to compare.
    allowlist = await _commit_author_allowlist(pool, engagement_id, requester_name)
    if chunk and _meta(chunk).get("author") not in allowlist:
        return CODE_ACCESS_DENIED

    commit = await github_client.get_commit(repo, sha)
    sha_short = _meta(chunk or {}).get("sha_short") or sha[:7]
    if commit is None:
        # Live fetch failed (bad/expired token, repo moved, API down). If we
        # at least know the commit from zone1, answer from that record with a
        # clear caveat instead of falling through to a generic "no info" RAG.
        # (Authorship was already checked above for this branch.)
        if not chunk:
            return None
        logger.warning("live diff fetch failed for %s@%s — answering from chunk", repo, sha)
        prompt = CODE_CHUNK_FALLBACK_PROMPT.format(
            question=question,
            sha_short=sha_short,
            context=chunk["content"][: ctx["CONTEXT_CHARS"]],
            style=depth_directive(question),
        )
        answer, provider = await llm.generate_answer(llm_providers, prompt)
        return {
            "answer": answer,
            "sources": [source_dict(r, ctx["SNIPPET_CHARS"]) for r in filter_cited_sources(answer, [chunk])],
            "abstained": False,
            "provider": provider,
        }

    # No local chunk (kind == "sha" naming a commit we never ingested) means
    # the check above never ran — the live API response is the only source
    # of truth for who authored it, so it's checked here instead.
    if not chunk and commit.get("author") not in allowlist:
        return CODE_ACCESS_DENIED

    prompt = CODE_PROMPT.format(
        question=question,
        sha_short=sha_short,
        context=github_client.format_diff_for_prompt(commit),
        style=depth_directive(question),
    )
    answer, provider = await llm.generate_answer(llm_providers, prompt)
    sources = []
    if chunk:
        sources = [source_dict(r, ctx["SNIPPET_CHARS"]) for r in filter_cited_sources(answer, [chunk])]
    return {
        "answer": answer,
        "sources": sources,
        "abstained": False,
        "provider": provider,
    }


def _adf_text(node) -> str:
    """Plain text out of Jira's Atlassian Document Format description field."""
    if isinstance(node, str):
        return node
    if isinstance(node, dict):
        parts = [node.get("text") or ""]
        parts += [_adf_text(c) for c in node.get("content") or []]
        return " ".join(p for p in parts if p)
    if isinstance(node, list):
        return " ".join(_adf_text(c) for c in node)
    return ""


async def handle_ticket(pool, question, engagement_id, ticket_key, llm_providers, ctx):
    rows = await pool.fetch(TICKETS_BY_KEY_SQL, engagement_id, [ticket_key])
    if rows:
        r = dict(rows[0])
        m = _meta(r)
        context = (
            "Status: {status} | Assignee: {assignee} | Type: {itype} | Priority: {prio}\n{text}".format(
                status=m.get("status", "?"),
                assignee=m.get("assignee", "unassigned"),
                itype=m.get("issue_type", "?"),
                prio=m.get("priority", "?"),
                text=r["content"][: ctx["CONTEXT_CHARS"]],
            )
        )
        prompt = TICKET_PROMPT.format(
            question=question,
            ticket_key=ticket_key,
            live_note="",
            context=context,
            style=depth_directive(question),
        )
        answer, provider = await llm.generate_answer(llm_providers, prompt)
        return {
            "answer": answer,
            "sources": [source_dict(x, ctx["SNIPPET_CHARS"]) for x in filter_cited_sources(answer, [r])],
            "abstained": False,
            "provider": provider,
        }

    # Not in the chunk store — the static dump is a subset, so check the live
    # Jira board before declaring the ticket unknown.
    if jira_client.configured():
        try:
            issue = await jira_client.get(
                "/rest/api/3/issue/{}".format(ticket_key),
                {"fields": "summary,description,status,assignee,priority,issuetype,created"},
            )
        except Exception as exc:  # 404 = ticket doesn't exist; anything else = Jira trouble
            logger.warning("live Jira lookup failed for %s: %s", ticket_key, exc)
            issue = None
        if issue and issue.get("key"):
            f = issue.get("fields", {})
            context = (
                "Status: {status} | Assignee: {assignee} | Type: {itype} | Priority: {prio}\n"
                "{summary}\n{desc}".format(
                    status=(f.get("status") or {}).get("name", "?"),
                    assignee=(f.get("assignee") or {}).get("displayName", "unassigned"),
                    itype=(f.get("issuetype") or {}).get("name", "?"),
                    prio=(f.get("priority") or {}).get("name", "?"),
                    summary=f.get("summary", ""),
                    desc=_adf_text(f.get("description"))[: ctx["CONTEXT_CHARS"]],
                )
            )
            prompt = TICKET_PROMPT.format(
                question=question,
                ticket_key=ticket_key,
                live_note=" fetched live from the Jira board just now",
                context=context,
                style=depth_directive(question),
            )
            answer, provider = await llm.generate_answer(llm_providers, prompt)
            return {
                "answer": answer,
                # Live-fetched issues have no chunk row to cite back to.
                "sources": [],
                "abstained": False,
                "provider": provider,
            }

    # Not a Jira ticket after all — try it as an entity ID from an ingested
    # PM document (risk, CR, decision, requirement, deliverable) before
    # giving up. This is what makes "status of R-01" or "what did CR-002
    # decide" an exact, zero-hallucination lookup instead of falling through
    # to vector search over a two-character ID that has no useful embedding.
    entity_rows = await pool.fetch(ENTITY_LOOKUP_SQL, engagement_id, ticket_key)
    if entity_rows:
        results = [dict(r) for r in entity_rows]
        context = build_context(results, ctx["CONTEXT_CHARS"])
        prompt = TICKET_PROMPT.format(
            question=question,
            ticket_key=ticket_key,
            live_note="",
            context=context,
            style=depth_directive(question),
        )
        answer, provider = await llm.generate_answer(llm_providers, prompt)
        return {
            "answer": answer,
            "sources": [source_dict(x, ctx["SNIPPET_CHARS"]) for x in filter_cited_sources(answer, results)],
            "abstained": False,
            "provider": provider,
        }

    return {
        "answer": "{} isn't in this project's records{}. It may not exist, or "
        "it may not have been synced yet.".format(
            ticket_key,
            ", and I couldn't find it on the live Jira board either"
            if jira_client.configured()
            else "",
        ),
        "sources": [],
        "abstained": True,
        "provider": None,
    }


async def maybe_handle(
    *,
    pool: asyncpg.Pool,
    question: str,
    engagement_id: str,
    llm_providers: list,
    ctx: dict,
    user_name: str | None = None,
) -> dict | None:
    """Try the structured intents; None means 'use default RAG'."""
    found = classify(question, user_name)
    if found is None and _worth_semantic_check(question, user_name):
        # Regex net caught nothing — before conceding to plain vector RAG
        # (which can't filter by assignee/status at all), get a real read on
        # whether this is a ticket/commit digest request phrased in a way the
        # regexes don't anticipate. See classify_semantic()'s docstring.
        #
        # Gated behind _worth_semantic_check so this extra LLM call only fires
        # when the question actually names/implies a person or a status —
        # the majority of content questions ("how was the webhook bug fixed",
        # "what does the SOW say about retention") have neither and go
        # straight to RAG exactly as fast as before this feature existed.
        found = await classify_semantic(question, user_name, llm_providers)
    if found is None:
        return None
    name, payload = found
    if name == "sprint":
        return await handle_sprint(pool, question, engagement_id, payload, llm_providers, ctx)
    if name == "recent":
        return await handle_recent(
            pool, question, engagement_id, payload, llm_providers, ctx, user_name
        )
    if name == "ticket":
        return await handle_ticket(pool, question, engagement_id, payload, llm_providers, ctx)
    if name == "overview":
        return await handle_overview(pool, question, engagement_id, llm_providers, ctx)
    if name == "code":
        return await handle_code(
            pool, question, engagement_id, payload, llm_providers, ctx, user_name
        )
    return None
