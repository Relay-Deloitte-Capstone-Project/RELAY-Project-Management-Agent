"""Project-wide (not sprint-scoped) real Jira metrics for the Developer,
Manager and Admin dashboards — GET /api/project/*.

Everything here reads live from the KPD project. `_all_issues()` pulls the
whole project (249 issues today) in a couple of paginated calls and most
endpoints derive their numbers from that same in-memory set with plain
Python filtering — deliberately not JQL string-building per query param,
which would mean interpolating user-supplied filter values into a JQL
string. `/api/analytics/*` (sprint-scoped) is the sibling module this
complements; that one stays sprint-scoped, this one is project-wide.
"""

from __future__ import annotations

import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from api import jira_client

router = APIRouter()

ISSUE_FIELDS = "status,issuetype,assignee,labels,parent,summary,priority,created"

DONE_CATEGORY = "Done"
IN_PROGRESS_CATEGORY = "In Progress"

# Labels this project's seed data uses as real scope/status markers — not a
# Jira-native concept, just labels this team applies, but genuinely real.
SCOPE_LABELS = {"out-of-scope", "ambiguous", "unlinked", "blocked", "reopened", "duplicate", "in-review"}


def _require_configured():
    if not jira_client.configured():
        raise HTTPException(status_code=503, detail="Jira is not configured on the backend")


def _status_category(issue: dict) -> str:
    return issue["fields"]["status"]["statusCategory"]["name"]


def _parse(ts: str) -> datetime:
    # Same dual-format handling as api/analytics.py: "...Z" vs "...+0530".
    if ts.endswith("Z"):
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%f%z")


def _ticket_dict(issue: dict) -> dict:
    f = issue["fields"]
    return {
        "key": issue["key"],
        "summary": f.get("summary"),
        "status": f["status"]["name"],
        "type": f["issuetype"]["name"],
        "priority": (f.get("priority") or {}).get("name"),
        "assignee": (f.get("assignee") or {}).get("displayName"),
        "created": f.get("created"),
    }


async def _all_issues() -> list:
    return await jira_client.search_issues(f"project={jira_client.PROJECT_KEY}", ISSUE_FIELDS, max_results=100)


@router.get("/api/project/summary")
async def summary():
    _require_configured()
    issues = await _all_issues()
    total = len(issues)

    by_status = Counter(_status_category(i) for i in issues)
    by_type = Counter(i["fields"]["issuetype"]["name"] for i in issues)

    label_counts: Counter = Counter()
    for i in issues:
        for label in i["fields"].get("labels") or []:
            label_counts[label] += 1

    unlinked = label_counts.get("unlinked", 0)
    out_of_scope = label_counts.get("out-of-scope", 0)
    ambiguous = label_counts.get("ambiguous", 0)
    blocked = label_counts.get("blocked", 0)
    reopened = label_counts.get("reopened", 0)

    unassigned = sum(1 for i in issues if not i["fields"].get("assignee"))
    bugs = by_type.get("Bug", 0)

    # Domain labels (security/ingestion/retrieval/...) — everything that
    # isn't one of the scope-taxonomy labels or the seed-run marker.
    domain_labels = {
        label: count
        for label, count in label_counts.items()
        if label not in SCOPE_LABELS and not label.startswith("seeded-")
    }

    return {
        "total_issues": total,
        "by_status": dict(by_status),
        "by_type": dict(by_type),
        "scope": {
            "in_scope": total - out_of_scope - ambiguous,
            "out_of_scope": out_of_scope,
            "ambiguous": ambiguous,
            "unlinked": unlinked,
            "blocked": blocked,
            "reopened": reopened,
            "coverage_pct": round((total - unlinked) / total * 100, 1) if total else 0,
        },
        "unassigned_count": unassigned,
        "bug_rate": round(bugs / total * 100, 1) if total else 0,
        "domain_labels": dict(sorted(domain_labels.items(), key=lambda kv: -kv[1])[:8]),
    }


@router.get("/api/project/team")
async def team():
    _require_configured()
    users = await jira_client.assignable_users()
    issues = await _all_issues()

    counts = {u["displayName"]: {"to_do": 0, "in_progress": 0, "done": 0} for u in users}
    for i in issues:
        assignee = i["fields"].get("assignee")
        if not assignee:
            continue
        bucket = counts.setdefault(assignee["displayName"], {"to_do": 0, "in_progress": 0, "done": 0})
        category = _status_category(i)
        if category == DONE_CATEGORY:
            bucket["done"] += 1
        elif category == IN_PROGRESS_CATEGORY:
            bucket["in_progress"] += 1
        else:
            bucket["to_do"] += 1

    return [
        {
            "account_id": u["accountId"],
            "name": u["displayName"],
            "email": u.get("emailAddress"),
            **counts.get(u["displayName"], {"to_do": 0, "in_progress": 0, "done": 0}),
        }
        for u in users
    ]


@router.get("/api/project/epics")
async def epics():
    _require_configured()
    issues = await _all_issues()
    epic_issues = [i for i in issues if i["fields"]["issuetype"]["name"] == "Epic"]

    children_by_epic: dict = {}
    for i in issues:
        parent = i["fields"].get("parent")
        if parent:
            children_by_epic.setdefault(parent["key"], []).append(i)

    out_of_scope_labels = {"out-of-scope", "ambiguous"}
    result = []
    for epic in epic_issues:
        children = children_by_epic.get(epic["key"], [])
        n = len(children)
        done = sum(1 for c in children if _status_category(c) == DONE_CATEGORY)
        compliant = sum(1 for c in children if not (set(c["fields"].get("labels") or []) & out_of_scope_labels))
        result.append(
            {
                "key": epic["key"],
                "title": epic["fields"].get("summary"),
                "status": epic["fields"]["status"]["name"],
                "ticket_count": n,
                "completion_pct": round(done / n * 100, 1) if n else 0,
                "scope_compliance_pct": round(compliant / n * 100, 1) if n else 0,
            }
        )
    return result


@router.get("/api/project/sprint-history")
async def sprint_history():
    _require_configured()
    sprints = await jira_client.list_sprints()

    result = []
    for s in sprints:
        if s["state"] == "future":
            result.append({"id": s["id"], "name": s["name"], "state": s["state"], "completion_pct": None})
            continue
        issues = await jira_client.sprint_issues(s["id"])
        n = len(issues)
        done = sum(1 for i in issues if _status_category(i) == DONE_CATEGORY)
        result.append(
            {
                "id": s["id"],
                "name": s["name"],
                "state": s["state"],
                "completion_pct": round(done / n * 100, 1) if n else 0,
            }
        )
    return result


@router.get("/api/project/tickets")
async def tickets(
    label: Optional[str] = Query(default=None),
    assignee: Optional[str] = Query(default=None),
    epic: Optional[str] = Query(default=None),
):
    _require_configured()
    issues = await _all_issues()
    if label:
        issues = [i for i in issues if label in (i["fields"].get("labels") or [])]
    if assignee:
        issues = [i for i in issues if (i["fields"].get("assignee") or {}).get("displayName") == assignee]
    if epic:
        issues = [i for i in issues if (i["fields"].get("parent") or {}).get("key") == epic]
    return [_ticket_dict(i) for i in issues]


@router.get("/api/project/risk-signals")
async def risk_signals():
    _require_configured()
    issues = await _all_issues()

    label_counts: Counter = Counter()
    for i in issues:
        for label in i["fields"].get("labels") or []:
            label_counts[label] += 1
    unassigned = sum(1 for i in issues if not i["fields"].get("assignee"))

    signals = []
    if label_counts.get("out-of-scope"):
        signals.append(
            {
                "level": "high",
                "title": f"{label_counts['out-of-scope']} tickets flagged out-of-scope",
                "detail": "Labeled out-of-scope in Jira — review against the SOW.",
            }
        )
    if label_counts.get("blocked"):
        signals.append(
            {
                "level": "high",
                "title": f"{label_counts['blocked']} tickets blocked",
                "detail": "Labeled blocked in Jira.",
            }
        )
    if label_counts.get("ambiguous"):
        signals.append(
            {
                "level": "medium",
                "title": f"{label_counts['ambiguous']} tickets have ambiguous scope",
                "detail": "Labeled ambiguous in Jira — needs a scope call.",
            }
        )
    if unassigned:
        signals.append(
            {
                "level": "medium",
                "title": f"{unassigned} tickets are unassigned",
                "detail": "No assignee set in Jira.",
            }
        )
    if label_counts.get("reopened"):
        signals.append(
            {
                "level": "low",
                "title": f"{label_counts['reopened']} tickets have been reopened",
                "detail": "Labeled reopened in Jira — possible regressions.",
            }
        )
    return signals


@router.get("/api/project/activity")
async def activity(request: Request):
    pool = request.app.state.pool
    questions_row = await pool.fetchrow("SELECT COUNT(*) AS n FROM zone3.chat_messages WHERE role = 'user'")
    notes_row = await pool.fetchrow("SELECT COUNT(*) AS n FROM zone3.scratchpad_notes")

    # "Tickets closed this week" — real, via each currently-Done issue's own
    # changelog (resolutiondate is never set by this project's workflow, so
    # that field can't be used). Bounded to Done issues only, not the whole
    # 249, to keep the changelog fan-out reasonable. Against this seeded
    # dataset the real answer will likely be 0 or near it — see
    # api/analytics.py's burndown caveat for why (bulk-seeded, not organic).
    tickets_closed_this_week = None
    if jira_client.configured():
        issues = await _all_issues()
        done_keys = [i["key"] for i in issues if _status_category(i) == DONE_CATEGORY]
        changelogs = await jira_client.issue_status_changelogs(done_keys)
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        count = 0
        for transitions in changelogs.values():
            done_ats = [_parse(ts) for ts, status in transitions if status == "Done"]
            if done_ats and max(done_ats) >= cutoff:
                count += 1
        tickets_closed_this_week = count

    return {
        "questions_asked": questions_row["n"],
        "notes_captured": notes_row["n"],
        "tickets_closed_this_week": tickets_closed_this_week,
    }


@router.get("/api/project/team-activity")
async def team_activity(request: Request):
    """Per-person Ask Project + Scratchpad usage, real — joined by the app's
    own Prisma user id (zone3.chat_sessions.user_id / scratchpad_notes.user_id),
    not by Jira identity. The frontend joins this to a person by id, separately
    from the Jira-name join /api/project/team uses.
    """
    pool = request.app.state.pool
    question_rows = await pool.fetch(
        """
        SELECT s.user_id, COUNT(m.id) AS n
        FROM zone3.chat_messages m
        JOIN zone3.chat_sessions s ON s.id = m.session_id
        WHERE m.role = 'user'
        GROUP BY s.user_id
        """
    )
    note_rows = await pool.fetch(
        "SELECT user_id, COUNT(*) AS n FROM zone3.scratchpad_notes GROUP BY user_id"
    )

    questions = {r["user_id"]: r["n"] for r in question_rows}
    notes = {r["user_id"]: r["n"] for r in note_rows}
    total_questions = sum(questions.values())
    user_ids = set(questions) | set(notes)

    return [
        {
            "user_id": uid,
            "questions_asked": questions.get(uid, 0),
            "notes_captured": notes.get(uid, 0),
            "chat_usage_pct": round(questions.get(uid, 0) / total_questions * 100, 1)
            if total_questions
            else 0,
        }
        for uid in user_ids
    ]


@router.get("/api/project/services")
async def services(request: Request):
    db_ok = False
    try:
        await request.app.state.pool.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False

    jira_ok = jira_client.configured()
    providers = [p.name for p in (request.app.state.llm_providers or [])]

    return [
        {"label": "Database (Postgres)", "value": "Connected" if db_ok else "Unreachable", "tone": "success" if db_ok else "danger"},
        {"label": "Jira", "value": "Connected" if jira_ok else "Not configured", "tone": "success" if jira_ok else "danger"},
        {
            "label": "LLM providers",
            "value": ", ".join(providers) if providers else "None configured",
            "tone": "success" if providers else "danger",
        },
    ]


@router.get("/api/project/config")
async def config():
    return {
        "jira_site": jira_client.SITE if jira_client.configured() else None,
        "llm_provider": os.environ.get("LLM_PROVIDER"),
        "groq_model": os.environ.get("GROQ_MODEL"),
        "gemini_model": os.environ.get("GEMINI_MODEL"),
    }
