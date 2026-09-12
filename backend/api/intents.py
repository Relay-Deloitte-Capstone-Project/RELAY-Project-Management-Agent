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

import json
import logging
import os
import re

import asyncpg

from api import github_client, jira_client, llm

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
    r"|explain|tell me about|details? (of|about|on|for)|summari[sz]e|summary)\b",
    re.IGNORECASE,
)

# "bugs for Akshar", "assigned to Anya", "commits by Akshar" — a capitalized
# name after a scoping preposition scopes the digest to that person.
PERSON_RE = re.compile(
    r"\b(?:for|assigned to|assignee[ds]? (?:is |to )?|raised (?:for|by|to)"
    r"|by|of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b"
)

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

RECENT_BUGS_BY_ASSIGNEE_SQL = """
    SELECT id, source_doc_id, source_type, content, metadata
    FROM public.chunks
    WHERE engagement_id = $1
      AND source_type = 'jira_ticket'
      AND metadata->>'issue_type' ILIKE 'bug'
      AND metadata->>'assignee' ILIKE '%' || $3 || '%'
    ORDER BY metadata->>'created_at' DESC
    LIMIT $2
"""

RECENT_COMMITS_BY_AUTHOR_SQL = """
    SELECT id, source_doc_id, source_type, content, metadata
    FROM public.chunks
    WHERE engagement_id = $1
      AND source_type = 'github_commit'
      AND metadata->>'author' ILIKE '%' || $3 || '%'
    ORDER BY metadata->>'date' DESC
    LIMIT $2
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


def classify(question: str) -> tuple[str, object] | None:
    """Return (intent_name, match_payload) or None for default RAG."""
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
    if RECENT_LIST_RE.search(question) and RECENT_TOPIC_RE.search(question):
        person = PERSON_RE.search(question)
        return ("recent", person.group(1) if person else None)
    return None


# --- handlers ---------------------------------------------------------------


async def handle_sprint(pool, question, engagement_id, sprint_num, llm_providers, ctx):
    if not jira_client.configured():
        return {
            "answer": "Sprint details come from the live Jira board, but the "
            "Jira integration isn't configured on this backend, so I can't "
            "look Sprint {} up.".format(sprint_num),
            "sources": [],
            "abstained": False,
            "provider": None,
        }

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
        names = ", ".join(s.get("name", "?") for s in sprints) or "none"
        return {
            "answer": "I couldn't find a Sprint {} on the Jira board. The "
            "sprints I can see are: {}.".format(sprint_num, names),
            "sources": [],
            "abstained": False,
            "provider": None,
        }

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


async def handle_recent(pool, question, engagement_id, person, llm_providers, ctx):
    wants_tickets = re.search(r"\b(bugs?|tickets?|issues?|fixes)\b", question, re.I)
    wants_commits = re.search(r"\b(commits?|code changes?|changes?)\b", question, re.I)
    if not wants_tickets and not wants_commits:
        wants_tickets = wants_commits = True

    results = []
    if wants_tickets:
        if person:
            results += [dict(r) for r in await pool.fetch(RECENT_BUGS_BY_ASSIGNEE_SQL, engagement_id, 8, person)]
        else:
            results += [dict(r) for r in await pool.fetch(RECENT_BUGS_SQL, engagement_id, 8)]
    if wants_commits:
        if person:
            results += [dict(r) for r in await pool.fetch(RECENT_COMMITS_BY_AUTHOR_SQL, engagement_id, 8, person)]
        else:
            results += [dict(r) for r in await pool.fetch(RECENT_COMMITS_SQL, engagement_id, 8)]

    if not results:
        if person:
            return {
                "answer": "I don't have any recent records of that kind for "
                "{} in this project's data. If the name is right, they may "
                "simply have none recorded yet.".format(person),
                "sources": [],
                "abstained": False,
                "provider": None,
            }
        return {
            "answer": "I don't have any recent records of that kind in this "
            "project's data.",
            "sources": [],
            "abstained": True,
            "provider": None,
        }

    sha_example = next(
        (_short_id(r) for r in results if r["source_type"] == "github_commit"),
        "467d828",
    )
    context = build_context(results, ctx["CONTEXT_CHARS"])
    if person:
        # Tell the model the records are already scoped — otherwise it can
        # still frame unfiltered context as belonging to the named person.
        context = (
            "Scope: every record below is already filtered to assignee/author "
            "matching '{}'. Do not attribute anything beyond these records to "
            "them.\n\n".format(person)
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


async def handle_code(pool, question, engagement_id, payload, llm_providers, ctx):
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

    commit = await github_client.get_commit(repo, sha)
    sha_short = _meta(chunk or {}).get("sha_short") or sha[:7]
    if commit is None:
        # Live fetch failed (bad/expired token, repo moved, API down). If we
        # at least know the commit from zone1, answer from that record with a
        # clear caveat instead of falling through to a generic "no info" RAG.
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
) -> dict | None:
    """Try the structured intents; None means 'use default RAG'."""
    found = classify(question)
    if found is None:
        return None
    name, payload = found
    if name == "sprint":
        return await handle_sprint(pool, question, engagement_id, payload, llm_providers, ctx)
    if name == "recent":
        return await handle_recent(pool, question, engagement_id, payload, llm_providers, ctx)
    if name == "ticket":
        return await handle_ticket(pool, question, engagement_id, payload, llm_providers, ctx)
    if name == "overview":
        return await handle_overview(pool, question, engagement_id, llm_providers, ctx)
    if name == "code":
        return await handle_code(pool, question, engagement_id, payload, llm_providers, ctx)
    return None
