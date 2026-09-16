"""Onboarding Kit — a one-time, manager-triggered capture of live project
state for a new developer joining an engagement.

Content splits into two kinds:
  - PROJECT-COMMON sections (orientation, access & setup, glossary, team
    norms, things that will bite you, who to ask, areas in motion, coverage
    guidance, scope summary) describe the PROJECT, not the person — they're
    the same regardless of which new hire you're looking at, computed live
    by _common_content() and viewable via GET /common before anyone commits
    to creating a kit at all.
  - PERSON-SPECIFIC sections (suggested first ticket, the PRs behind it)
    genuinely depend on who's joining and what they'll work on.

"Add to onboarding" freezes BOTH into one row in public.onboarding_kits —
a full, self-contained snapshot, so a manager can review exactly what a
specific person was given even after the live project-common content has
moved on. Re-creating is the only way that frozen copy ever changes, and
it's always an explicit action.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from api import github_client, jira_client
from api import llm as llm_module
from api.project import (
    HIDDEN_ROSTER_ROLES,
    LIVE_JIRA_ENGAGEMENT_ID,
    _all_issues,
    _person_key,
)
from api.project import summary as project_summary

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

NEW_MEMBER_WINDOW_DAYS = 30
TICKET_KEY_RE = re.compile(r"\b([A-Z][A-Z0-9]+-\d+)\b")

DEFAULT_TEAM_NORMS = (
    "Your manager hasn't filled this in yet — ask them where the team communicates day-to-day "
    "and what's expected on PR reviews and branch naming."
)


# --------------------------------------------------------------------------
# Roster
# --------------------------------------------------------------------------

@router.get("/roster")
async def roster(request: Request, engagement_id: str):
    """Everyone staffed on the engagement (excluding managers/admins), each
    tagged is_new if staffed within NEW_MEMBER_WINDOW_DAYS, plus whether a
    kit already exists for them. Drives the manager's picker dropdown."""
    pool = request.app.state.pool
    cutoff = datetime.now(timezone.utc) - timedelta(days=NEW_MEMBER_WINDOW_DAYS)

    people = await pool.fetch(
        "SELECT name, email, role, assigned_at FROM public.project_staffing "
        "WHERE engagement_id = $1 AND lower(role) <> ALL($2::text[]) "
        "ORDER BY assigned_at DESC",
        engagement_id,
        HIDDEN_ROSTER_ROLES,
    )
    kits = {
        r["developer_email"]: r["updated_at"]
        for r in await pool.fetch(
            "SELECT developer_email, updated_at FROM public.onboarding_kits "
            "WHERE engagement_id = $1",
            engagement_id,
        )
    }

    return [
        {
            "name": p["name"],
            "email": p["email"],
            "role": p["role"],
            "is_new": p["assigned_at"] >= cutoff,
            "has_kit": p["email"] in kits,
            "kit_updated_at": kits.get(p["email"]).isoformat() if kits.get(p["email"]) else None,
        }
        for p in people
    ]


# --------------------------------------------------------------------------
# Ticket/commit source resolution — the Acme/live-board conflation
# --------------------------------------------------------------------------

async def _resolve_ticket_source(pool, engagement_id: str) -> str:
    """Which engagement's Jira/GitHub data should actually back the
    ticket/commit-driven sections. Several wizard-created demo engagements
    (Acme Data Migration in particular) have empty project_tickets /
    project_commits / project_jira_links / project_github_links — no
    project-setup wizard run ever populated them — while the single live
    Jira board + GitHub repo this whole app is wired to (JIRA_SITE /
    GITHUB_REPO in backend/.env) already has real, rich data. Rather than
    render a hollow kit for those engagements, fall back to the live board —
    this is a deliberate demo-credibility choice, not a general product
    rule, which is why it's scoped to *only* the sections that need
    ticket/commit history, never the sections backed by the engagement's own
    uploaded documents (pm_documents, sow_deliverables, scratchpad_notes),
    which stay correctly scoped to the real engagement_id throughout.
    """
    if engagement_id == LIVE_JIRA_ENGAGEMENT_ID:
        return engagement_id
    count = await pool.fetchval(
        "SELECT count(*) FROM public.project_tickets WHERE engagement_id = $1",
        engagement_id,
    )
    return LIVE_JIRA_ENGAGEMENT_ID if not count else engagement_id


# --------------------------------------------------------------------------
# Project notes — team norms + environment setup, the two sections with no
# live source at all. A manager writes each once per engagement; every kit
# created afterward picks up whatever's currently saved.
# --------------------------------------------------------------------------

DEFAULT_ENV_SETUP = (
    "Your manager hasn't filled this in yet — ask them for the repo clone URL, install steps, "
    "required environment variables, and how to run the test suite locally."
)


async def _get_project_notes(pool, engagement_id: str) -> dict:
    row = await pool.fetchrow(
        "SELECT team_norms, env_setup FROM public.onboarding_project_notes WHERE engagement_id = $1",
        engagement_id,
    )
    return {
        "team_norms": (row["team_norms"] if row and row["team_norms"] else None) or DEFAULT_TEAM_NORMS,
        "env_setup": (row["env_setup"] if row and row["env_setup"] else None) or DEFAULT_ENV_SETUP,
    }


class ProjectNotesRequest(BaseModel):
    engagement_id: str
    team_norms: str
    env_setup: str
    updated_by: str


@router.put("/project-notes")
async def set_project_notes(body: ProjectNotesRequest, request: Request):
    pool = request.app.state.pool
    await pool.execute(
        """
        INSERT INTO public.onboarding_project_notes (engagement_id, team_norms, env_setup, updated_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (engagement_id)
        DO UPDATE SET team_norms = EXCLUDED.team_norms, env_setup = EXCLUDED.env_setup,
                      updated_by = EXCLUDED.updated_by, updated_at = NOW()
        """,
        body.engagement_id,
        body.team_norms,
        body.env_setup,
        body.updated_by,
    )
    return {"team_norms": body.team_norms, "env_setup": body.env_setup}


# --------------------------------------------------------------------------
# Project-common section builders
# --------------------------------------------------------------------------

async def _document_chunks(pool, engagement_id: str, doc_types: list[str], limit_chars: int = 6000) -> str:
    """Real text pulled from confirmed PM documents (charter/deliverables/
    requirements), via the same chunks table Ask Project already searches."""
    rows = await pool.fetch(
        """
        SELECT DISTINCT ON (d.doc_type, c.content) c.content
        FROM public.chunks c
        JOIN public.pm_documents d ON d.id = c.pm_document_id
        WHERE d.engagement_id = $1 AND d.doc_type = ANY($2::text[]) AND d.is_latest = TRUE
        ORDER BY d.doc_type, c.content, c.section_path NULLS LAST
        """,
        engagement_id,
        doc_types,
    )
    text = "\n\n".join(r["content"] for r in rows)
    return text[:limit_chars]


async def _orientation(request: Request, engagement_id: str) -> dict:
    pool = request.app.state.pool
    context = await _document_chunks(pool, engagement_id, ["charter", "deliverables_matrix", "requirements"])
    if not context:
        return {
            "summary": "No charter, deliverables matrix, or requirements documents have been uploaded for this engagement yet — ask your manager where the project brief lives.",
            "source": "none",
        }

    prompt = (
        "You are writing the opening orientation paragraph of a new developer's "
        "onboarding kit for this engagement. Using ONLY the project documents "
        "below, write 2 short paragraphs: what this engagement is and who it's "
        "for, then what the team is currently building or focused on. Plain "
        "language, no headers, no bullet points, do not invent facts not in "
        "the text.\n\nPROJECT DOCUMENTS:\n" + context
    )
    try:
        answer, provider = await llm_module.generate_answer(request.app.state.llm_providers, prompt)
    except Exception as exc:
        return {"summary": f"Orientation could not be generated ({exc}). The raw project documents are still available under PM Documents.", "source": "error"}
    return {"summary": answer.strip(), "source": provider}


async def _glossary(request: Request, engagement_id: str) -> list[dict]:
    pool = request.app.state.pool
    context = await _document_chunks(pool, engagement_id, ["charter", "deliverables_matrix", "requirements", "sow_document"])
    if not context:
        return []

    prompt = (
        "From the project documents below, list the 6-8 most important "
        "project-specific acronyms, technical terms, or ticket-prefix "
        "conventions a brand-new developer would not already know. One per "
        "line, exact format 'TERM — one-sentence definition'. No numbering, "
        "no extra commentary, no markdown.\n\nPROJECT DOCUMENTS:\n" + context
    )
    try:
        answer, _provider = await llm_module.generate_answer(request.app.state.llm_providers, prompt)
    except Exception:
        return []

    terms = []
    seen = set()
    for line in answer.strip().splitlines():
        line = line.strip("-* \t")
        if "—" in line:
            term, _, definition = line.partition("—")
        elif " - " in line:
            term, _, definition = line.partition(" - ")
        elif ":" in line:
            term, _, definition = line.partition(":")
        else:
            continue
        term, definition = term.strip(), definition.strip()
        if term and definition and term.lower() not in seen:
            seen.add(term.lower())
            terms.append({"term": term, "definition": definition})
    return terms[:8]


async def _architecture_overview(request: Request, engagement_id: str) -> Optional[str]:
    """A technical companion to Project Orientation: orientation explains
    what the engagement is and who it's for (business framing, from the
    charter); this explains how the system is actually put together
    (components and how they connect), sourced from the real per-deliverable
    acceptance criteria in sow_deliverables — the most technically specific
    real text this app has for any engagement — rather than re-summarizing
    the same charter text with a different prompt."""
    pool = request.app.state.pool
    deliverables = await pool.fetch(
        "SELECT name, acceptance_criteria FROM public.sow_deliverables "
        "WHERE engagement_id = $1 ORDER BY sequence",
        engagement_id,
    )
    if not deliverables:
        return None

    components = "\n\n".join(
        f"{d['name']}:\n{d['acceptance_criteria']}" for d in deliverables if d["acceptance_criteria"]
    )
    if not components:
        return None

    prompt = (
        "You are writing the 'Architecture Overview' section of a new developer's onboarding "
        "kit. Below are this engagement's contracted deliverables and their real acceptance "
        "criteria. Using ONLY this information, write one short paragraph describing how these "
        "components fit together as a system — what depends on what, and roughly what a request "
        "or a piece of data flows through. Technical framing, not business framing. No headers, "
        "no bullet points, do not invent components not listed below.\n\nDELIVERABLES:\n" + components
    )
    try:
        answer, _provider = await llm_module.generate_answer(request.app.state.llm_providers, prompt)
        return answer.strip()
    except Exception:
        return None


async def _suggest_buddy(pool, engagement_id: str, exclude_email: str) -> Optional[dict]:
    """Default onboarding-buddy pick: the longest-tenured non-manager
    teammate other than the new hire. Commit-authorship (used elsewhere for
    'who to ask about what') isn't a reliable signal here — this demo's
    connected repo has only one or two distinct real commit authors, so it
    would suggest the same person regardless of who's joining or what
    they'll work on. Tenure on the project is a real, always-available
    signal instead, and the manager can override it at creation time."""
    row = await pool.fetchrow(
        "SELECT name, email FROM public.project_staffing "
        "WHERE engagement_id = $1 AND lower(role) <> ALL($2::text[]) AND lower(email) <> lower($3) "
        "ORDER BY assigned_at ASC LIMIT 1",
        engagement_id,
        HIDDEN_ROSTER_ROLES,
        exclude_email,
    )
    return {"name": row["name"], "email": row["email"]} if row else None


async def _access_setup(pool, real_engagement_id: str, jira_source: str) -> dict:
    """Real per-engagement Jira/GitHub links, falling back to the live
    board/repo when this engagement's own links were never set up (see
    _resolve_ticket_source)."""
    if jira_source == LIVE_JIRA_ENGAGEMENT_ID:
        jira_site = jira_client.SITE
        return {
            "jira_url": f"https://{jira_site}/jira/software/projects/{jira_client.PROJECT_KEY}/boards" if jira_site else None,
            "jira_project_key": jira_client.PROJECT_KEY,
            "github_repo": github_client.REPO or None,
            "github_url": f"https://github.com/{github_client.REPO}" if github_client.REPO else None,
            "note": "Ask your manager to add you to this Jira project and invite you as a collaborator on the GitHub repo above — access is granted per-person, not automatic.",
        }

    jira_link = await pool.fetchrow(
        "SELECT base_url, project_key FROM public.project_jira_links WHERE engagement_id = $1",
        real_engagement_id,
    )
    github_link = await pool.fetchrow(
        "SELECT repo_url, branch FROM public.project_github_links WHERE engagement_id = $1",
        real_engagement_id,
    )
    return {
        "jira_url": jira_link["base_url"] if jira_link and jira_link["base_url"] else None,
        "jira_project_key": jira_link["project_key"] if jira_link else None,
        "github_repo": github_link["repo_url"] if github_link else None,
        "github_url": github_link["repo_url"] if github_link else None,
        "github_branch": github_link["branch"] if github_link else None,
        "note": "Ask your manager to add you to this project's Jira and GitHub, listed above (set during Project setup → Team).",
    }


async def _bites_and_bugs(request: Request, real_engagement_id: str, jira_source: str) -> list[dict]:
    """Merged 'Things that will bite you': team-reviewed scratchpad notes
    (approved+promoted — genuinely scoped to this engagement's own notes)
    plus recently fixed bugs (from wherever the real ticket data lives)."""
    pool = request.app.state.pool
    items = []

    notes = await pool.fetch(
        "SELECT title, content, status, created_at FROM zone3.scratchpad_notes "
        "WHERE engagement_id = $1 AND status IN ('approved', 'promoted') "
        "ORDER BY created_at DESC LIMIT 6",
        real_engagement_id,
    )
    for n in notes:
        items.append({
            "origin": "note",
            "title": n["title"] or "Untitled note",
            "detail": (n["content"] or "")[:400],
        })

    if jira_source == LIVE_JIRA_ENGAGEMENT_ID:
        try:
            # search_issues pages until Jira reports isLast — max_results is
            # a page size, not a result cap — so slice down to what we show.
            bugs = (await jira_client.search_issues(
                f"project={jira_client.PROJECT_KEY} AND issuetype=Bug AND statusCategory=Done ORDER BY updated DESC",
                "summary,status,updated",
                max_results=50,
            ))[:5]
            for b in bugs:
                items.append({
                    "origin": "bug",
                    "title": f"{b['key']}: {b['fields'].get('summary', '')}",
                    "detail": "Fixed — worth reading before touching related code.",
                    "ticket_key": b["key"],
                })
        except Exception:
            pass
    else:
        bugs = await pool.fetch(
            "SELECT ticket_key, summary FROM public.project_tickets "
            "WHERE engagement_id = $1 AND issue_type = 'Bug' AND status = 'Done' "
            "ORDER BY created_at DESC LIMIT 5",
            jira_source,
        )
        for b in bugs:
            items.append({
                "origin": "bug",
                "title": f"{b['ticket_key']}: {b['summary']}",
                "detail": "Fixed — worth reading before touching related code.",
                "ticket_key": b["ticket_key"],
            })

    return items


async def _who_and_motion(request: Request, jira_source: str) -> dict:
    """'Who to ask about what' (merged ownership+review table) and 'Areas in
    motion' (reframed 'most active files'), both from real commit authorship
    — the one signal actually available. GitHub's review-approval data isn't
    ingested anywhere in this app, so rather than fabricate a second
    'who reviews' column, this uses one honest signal: who has actually
    committed to each area recently.

    'Area' is the ticket's epic, not its file path: this demo's connected
    repo carries zero file-diff data on its commits (confirmed by hand —
    github_client.get_commit resolves real message/author/date but every
    commit's files array is empty) while ~99% of commit messages carry a
    real ticket-key reference. Grouping by the ticket's epic (via the
    sow_ticket_classifications the Scope Guardian pipeline already computed)
    gives 8 meaningful areas instead of ~90 one-ticket-each buckets.
    """
    pool = request.app.state.pool
    area_authors: dict[str, Counter] = defaultdict(Counter)
    area_tickets: dict[str, set] = defaultdict(set)

    if jira_source == LIVE_JIRA_ENGAGEMENT_ID:
        ticket_to_area = {
            r["ticket_id"]: r["deliverable_title"]
            for r in await pool.fetch(
                "SELECT c.ticket_id, d.deliverable_title FROM public.sow_ticket_classifications c "
                "JOIN public.sow_deliverable_compliance d ON d.deliverable_key = c.deliverable_key"
            )
        }
        commits = await pool.fetch(
            "SELECT payload->'commit'->'author'->>'name' AS author_name, "
            "payload->'commit'->>'message' AS message "
            "FROM raw.github_commits ORDER BY (payload->'commit'->'author'->>'date') DESC LIMIT 60"
        )
        for c in commits:
            author = c["author_name"] or "Unknown"
            match = TICKET_KEY_RE.search(c["message"] or "")
            ticket_key = match.group(1) if match else None
            area = ticket_to_area.get(ticket_key, "Unclassified work") if ticket_key else "Unclassified work"
            area_authors[area][author] += 1
            if ticket_key:
                area_tickets[area].add(ticket_key)
    else:
        commits = await pool.fetch(
            "SELECT author_name, message FROM public.project_commits WHERE engagement_id = $1 "
            "ORDER BY committed_at DESC LIMIT 30",
            jira_source,
        )
        for c in commits:
            match = TICKET_KEY_RE.search(c["message"] or "")
            area = match.group(1) if match else "General"
            area_authors[area][c["author_name"] or "Unknown"] += 1
            if match:
                area_tickets[area].add(match.group(1))

    who_to_ask = []
    for area, counter in sorted(area_authors.items(), key=lambda kv: -sum(kv[1].values()))[:6]:
        top_author, top_count = counter.most_common(1)[0]
        total = sum(counter.values())
        pct = round(top_count / total * 100) if total else 0
        who_to_ask.append({
            "area": area,
            "contact": top_author,
            "detail": f"{pct}% of recent commits here — ask {top_author} first.",
        })

    areas_in_motion = []
    for area, counter in sorted(area_authors.items(), key=lambda kv: -sum(kv[1].values()))[:6]:
        tickets = sorted(area_tickets.get(area, []))
        areas_in_motion.append({
            "area": area,
            "commit_count": sum(counter.values()),
            "ticket_refs": tickets[:3],
        })

    return {"who_to_ask": who_to_ask, "areas_in_motion": areas_in_motion}


async def _coverage_guidance(request: Request, jira_source: str, requester_email: Optional[str]) -> list[str]:
    """Reuses api/project.py's real scope/coverage computation (the same
    numbers the Coverage page shows) but renders it as advice sentences
    instead of raw percentages — the same reasoning applied to hiding Scope
    Guardian's compliance %: a bare KPI isn't onboarding guidance."""
    try:
        data = await project_summary(request, engagement_id=jira_source, requester_email=requester_email)
    except Exception:
        return []

    total = data.get("total_issues", 0)
    if not total:
        return ["No Jira tickets are on record for this project yet."]

    scope = data.get("scope", {})
    guidance = []
    coverage_pct = scope.get("coverage_pct", 0)
    unlinked = scope.get("unlinked", 0)
    if unlinked:
        guidance.append(
            f"{unlinked} ticket(s) on this project have no linked commit — overall traceability is "
            f"{coverage_pct}%. If you're assigned one of these, expect to rely on the ticket description "
            "and your team lead rather than prior code history."
        )
    else:
        guidance.append(f"Every ticket on this project currently links back to a commit ({coverage_pct}% traceable) — safe to explore history for context on any area.")

    for label, count in list(data.get("domain_labels", {}).items())[:3]:
        guidance.append(f"'{label}' work has {count} ticket(s) currently — a concentration worth knowing about if that's your area.")

    return guidance


async def _scope_summary(pool, engagement_id: str) -> list[dict]:
    rows = await pool.fetch(
        "SELECT name, acceptance_criteria FROM public.sow_deliverables "
        "WHERE engagement_id = $1 ORDER BY sequence",
        engagement_id,
    )
    return [{"name": r["name"], "acceptance_criteria": r["acceptance_criteria"]} for r in rows]


async def _common_content(request: Request, engagement_id: str) -> dict:
    """Everything that describes the PROJECT, not any one person. Computed
    live every time — this is what a manager sees before picking anyone,
    and what gets frozen (merged with personal content) the moment a
    specific person's kit is created."""
    pool = request.app.state.pool
    jira_source = await _resolve_ticket_source(pool, engagement_id)

    orientation = await _orientation(request, engagement_id)
    architecture_overview = await _architecture_overview(request, engagement_id)
    glossary = await _glossary(request, engagement_id)
    access_setup = await _access_setup(pool, engagement_id, jira_source)
    notes = await _get_project_notes(pool, engagement_id)
    bites = await _bites_and_bugs(request, engagement_id, jira_source)
    who_and_motion = await _who_and_motion(request, jira_source)
    coverage_guidance = await _coverage_guidance(request, jira_source, None)
    scope_summary = await _scope_summary(pool, engagement_id)

    return {
        "orientation": orientation,
        "architecture_overview": architecture_overview,
        "access_setup": access_setup,
        "env_setup": notes["env_setup"],
        "glossary": glossary,
        "team_norms": notes["team_norms"],
        "things_that_will_bite_you": bites,
        "who_to_ask": who_and_motion["who_to_ask"],
        "areas_in_motion": who_and_motion["areas_in_motion"],
        "coverage_guidance": coverage_guidance,
        "scope_summary": scope_summary,
    }


@router.get("/common")
async def get_common(request: Request, engagement_id: str):
    """Live preview of the project-common sections — what a manager sees
    before selecting anyone, and while comparing candidates."""
    return await _common_content(request, engagement_id)


# --------------------------------------------------------------------------
# Person-specific: suggested first ticket + the PRs behind it
# --------------------------------------------------------------------------

async def _enrich_ticket(request: Request, ticket: dict, reasons: list[str]) -> dict:
    """A ticket key + one-line summary isn't enough to actually start work.
    This pulls everything else a new developer needs in one place: the real
    Jira description, which epic/deliverable it belongs to, why Scope
    Guardian classified it the way it did, and who to go to with questions
    about that area."""
    pool = request.app.state.pool
    key = ticket["key"]

    description = None
    try:
        from api.intents import _adf_text
        found = await jira_client.search_issues(f"key={key}", "description,issuetype,priority", max_results=1)
        if found:
            description = _adf_text((found[0].get("fields") or {}).get("description")).strip() or None
    except Exception:
        description = None

    classification = await pool.fetchrow(
        """
        SELECT c.epic_key, c.deliverable_key, c.status, c.reason, d.deliverable_title
        FROM public.sow_ticket_classifications c
        LEFT JOIN public.sow_deliverable_compliance d ON d.deliverable_key = c.deliverable_key
        WHERE c.ticket_id = $1
        """,
        key,
    )

    # Who has actually been committing in this ticket's epic — the person
    # most likely to answer questions about it.
    ask_about_it = None
    if classification:
        row = await pool.fetchrow(
            """
            SELECT payload->'commit'->'author'->>'name' AS author, count(*) AS n
            FROM raw.github_commits
            WHERE payload->'commit'->>'message' ~ ANY(
                SELECT '\\m' || ticket_id || '\\M' FROM public.sow_ticket_classifications
                WHERE epic_key = $1
            )
            GROUP BY 1 ORDER BY n DESC LIMIT 1
            """,
            classification["epic_key"],
        )
        ask_about_it = row["author"] if row else None

    return {
        "key": key,
        "summary": ticket["summary"],
        "status": ticket["status"],
        "type": ticket.get("type"),
        "priority": ticket.get("priority"),
        "description": description,
        "epic_key": classification["epic_key"] if classification else ticket.get("epic_key"),
        "epic_title": classification["deliverable_title"] if classification else None,
        "deliverable_key": classification["deliverable_key"] if classification else None,
        "scope_status": classification["status"] if classification else None,
        "scope_reason": classification["reason"] if classification else None,
        "ask_about_it": ask_about_it,
        "reasons": reasons,
        "getting_started": [
            f"Read the ticket in Jira and skim the PRs below for how this area is normally changed.",
            f"Ask {ask_about_it} about this area before you start — they've made the most recent commits here."
            if ask_about_it
            else "Ask your manager who last worked in this area before you start.",
            "Open a draft PR early, even if incomplete — it's the fastest way to get feedback here.",
        ],
    }


async def _first_ticket(request: Request, jira_source: str, developer_email: str, developer_name: str) -> Optional[dict]:
    issues = await _all_issues(request, jira_source, None)
    person_key = _person_key(developer_name)

    assigned = [
        i for i in issues
        if i["assignee"] and _person_key(i["assignee"]) == person_key
        and i["status_category"] != "Done"
    ]
    if assigned:
        ticket = sorted(assigned, key=lambda i: i["created"])[0]
        return await _enrich_ticket(request, ticket, ["This is already assigned to you in Jira — start here."])

    candidates = [
        i for i in issues
        if not i["assignee"]
        and i["status_category"] not in ("Done",)
        and i["type"] not in ("Epic",)
        and "blocked" not in i["labels"]
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda i: i["created"])
    ticket = candidates[0]
    return await _enrich_ticket(
        request,
        ticket,
        [
            "Unassigned and not on an epic critical path.",
            "Not currently blocked by another ticket.",
            "Picked as the oldest open candidate matching this — ask your manager to confirm before starting.",
        ],
    )


async def _prs_for_ticket(pool, ticket_key: Optional[str], epic_key: Optional[str] = None) -> list[dict]:
    """PRs worth reading before starting the suggested ticket, in descending
    order of relevance. A direct ticket reference is ideal, but most tickets
    have no PR of their own yet — rather than show an empty panel, widen to
    PRs from the same epic (genuinely the same area of the codebase), then
    to the most recent merged work. Each row carries why it's shown so the
    reader can judge it, instead of an unexplained list.

    Comment counts aren't stored in raw.github_prs (only comments_url), so
    the original 'top 5 most-commented PRs' idea was never backed by real
    data — relevance-by-ticket-lineage is.
    """
    def _rows_to_prs(rows, relevance: str) -> list[dict]:
        return [
            {"number": r["number"], "title": r["title"], "url": r["url"], "relevance": relevance}
            for r in rows
        ]

    if ticket_key:
        direct = await pool.fetch(
            "SELECT payload->>'number' AS number, payload->>'title' AS title, payload->>'html_url' AS url "
            "FROM raw.github_prs WHERE payload->>'title' ILIKE $1 OR payload->>'body' ILIKE $1 LIMIT 5",
            f"%{ticket_key}%",
        )
        if direct:
            return _rows_to_prs(direct, "Directly references this ticket")

    if epic_key:
        same_epic = await pool.fetch(
            """
            SELECT DISTINCT p.payload->>'number' AS number, p.payload->>'title' AS title,
                   p.payload->>'html_url' AS url
            FROM raw.github_prs p
            JOIN public.sow_ticket_classifications c
              ON p.payload->>'title' LIKE '%' || c.ticket_id || '%'
            WHERE c.epic_key = $1
            ORDER BY 1 DESC
            LIMIT 5
            """,
            epic_key,
        )
        if same_epic:
            return _rows_to_prs(same_epic, "Same epic — how this area is normally changed")

    recent = await pool.fetch(
        "SELECT payload->>'number' AS number, payload->>'title' AS title, payload->>'html_url' AS url "
        "FROM raw.github_prs ORDER BY (payload->>'number')::int DESC LIMIT 5"
    )
    return _rows_to_prs(recent, "Recent team work — general context")


@router.get("/preview-first-ticket")
async def preview_first_ticket(request: Request, engagement_id: str, developer_email: str, developer_name: str):
    """Live, unsaved preview of just the person-specific section — used
    when a manager has picked someone in the dropdown but hasn't clicked
    'Add to onboarding' yet, so they can see what that person would get
    without committing to it."""
    pool = request.app.state.pool
    jira_source = await _resolve_ticket_source(pool, engagement_id)
    first_ticket = await _first_ticket(request, jira_source, developer_email, developer_name)
    prs = await _prs_for_ticket(
        pool,
        first_ticket["key"] if first_ticket else None,
        first_ticket.get("epic_key") if first_ticket else None,
    )
    buddy = await _suggest_buddy(pool, engagement_id, developer_email)
    return {"first_ticket": first_ticket, "prs_for_first_ticket": prs, "suggested_buddy": buddy}


# --------------------------------------------------------------------------
# Fetch a stored kit (manager's frozen review + developer's static view)
# --------------------------------------------------------------------------

@router.get("/kits")
async def get_kit(
    request: Request,
    engagement_id: str,
    developer_email: str,
):
    pool = request.app.state.pool
    row = await pool.fetchrow(
        "SELECT developer_name, developer_email, engagement_id, content, "
        "created_by, created_at, updated_at FROM public.onboarding_kits "
        "WHERE engagement_id = $1 AND lower(developer_email) = lower($2)",
        engagement_id,
        developer_email,
    )
    if not row:
        raise HTTPException(status_code=404, detail="No onboarding kit exists for this person yet.")
    return {
        "developer_name": row["developer_name"],
        "developer_email": row["developer_email"],
        "engagement_id": row["engagement_id"],
        "created_by": row["created_by"],
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
        # asyncpg returns jsonb as a raw string, not a decoded dict — the
        # frontend does content.orientation.summary etc., so an un-parsed
        # string here silently becomes `undefined` on first property access
        # and crashes the whole page render.
        "content": json.loads(row["content"]) if isinstance(row["content"], str) else row["content"],
    }


# --------------------------------------------------------------------------
# Create / re-create — freezes common + personal into one row
# --------------------------------------------------------------------------

class CreateKitRequest(BaseModel):
    engagement_id: str
    developer_email: str
    created_by: str
    buddy_email: Optional[str] = None  # manager override; auto-suggested if omitted


@router.post("/kits")
async def create_kit(body: CreateKitRequest, request: Request):
    pool = request.app.state.pool

    person = await pool.fetchrow(
        "SELECT name, email FROM public.project_staffing WHERE engagement_id = $1 AND lower(email) = lower($2)",
        body.engagement_id,
        body.developer_email,
    )
    if not person:
        raise HTTPException(status_code=404, detail="This person is not staffed on this engagement.")

    common = await _common_content(request, body.engagement_id)
    jira_source = await _resolve_ticket_source(pool, body.engagement_id)
    first_ticket = await _first_ticket(request, jira_source, person["email"], person["name"])
    prs = await _prs_for_ticket(
        pool,
        first_ticket["key"] if first_ticket else None,
        first_ticket.get("epic_key") if first_ticket else None,
    )

    if body.buddy_email:
        buddy_row = await pool.fetchrow(
            "SELECT name, email FROM public.project_staffing WHERE engagement_id = $1 AND lower(email) = lower($2)",
            body.engagement_id,
            body.buddy_email,
        )
        buddy = {"name": buddy_row["name"], "email": buddy_row["email"]} if buddy_row else None
    else:
        buddy = await _suggest_buddy(pool, body.engagement_id, person["email"])

    content = {**common, "first_ticket": first_ticket, "prs_for_first_ticket": prs, "buddy": buddy}

    row = await pool.fetchrow(
        """
        INSERT INTO public.onboarding_kits
            (engagement_id, developer_email, developer_name, content, created_by)
        VALUES ($1, $2, $3, $4::jsonb, $5)
        ON CONFLICT (engagement_id, developer_email)
        DO UPDATE SET content = EXCLUDED.content, updated_at = NOW(), created_by = EXCLUDED.created_by
        RETURNING created_at, updated_at
        """,
        body.engagement_id,
        person["email"],
        person["name"],
        json.dumps(content),
        body.created_by,
    )

    return {
        "developer_name": person["name"],
        "developer_email": person["email"],
        "engagement_id": body.engagement_id,
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
        "content": content,
    }
