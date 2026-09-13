"""Project-wide (not sprint-scoped) ticket metrics for the Developer,
Manager and Admin dashboards — GET /api/project/*.

Exactly one project in this whole app has a real live Jira connection
(api/jira_client.py — a single globally-configured client, not multi-tenant)
and it's always the one at LIVE_JIRA_ENGAGEMENT_ID (the real KPD Jira board,
which lives on the Acme Data Migration engagement — there's no standalone
"Apache Kafka" project anymore). Every other engagement has no live
Jira/GitHub integration wired up at all, so its ticket/commit data lives directly in
public.project_tickets / public.project_commits instead (see
database/project_workspace_data.sql) — realistic internal tracking data,
not a fake external Jira/GitHub link pretending to be a real connection.

`_load_issues()` is the one place that decides which source to read from
and normalizes both into the same flat shape, so every endpoint below
doesn't need to know or care which project it's looking at. Callers that
pass `engagement_id` + `requester_email` get that project's real data (gated
by `_require_staffed` below, checked against public.project_staffing — a
separate table from the user_id-keyed public.project_members api/access.py
enforces for Ask Project, since login identity here is only known by email);
callers that omit `engagement_id` keep hitting the original single live-Jira
project, unchanged, for backward compatibility.
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

LIVE_JIRA_ENGAGEMENT_ID = os.environ.get("RELAY_ENGAGEMENT_ID", "proj-001")

# Labels this project's seed data uses as real scope/status markers — not a
# Jira-native concept, just labels this team applies, but genuinely real.
SCOPE_LABELS = {"out-of-scope", "ambiguous", "unlinked", "blocked", "reopened", "duplicate", "in-review"}


def _require_configured():
    if not jira_client.configured():
        raise HTTPException(status_code=503, detail="Jira is not configured on the backend")


async def _require_staffed(pool, email: str, engagement_id: str) -> None:
    row = await pool.fetchval(
        "SELECT 1 FROM public.project_staffing WHERE lower(email) = lower($1) AND engagement_id = $2",
        email,
        engagement_id,
    )
    if not row:
        raise HTTPException(status_code=403, detail="You're not staffed on this project")


def _status_category(issue: dict) -> str:
    return issue["status_category"]


def _parse(ts: str) -> datetime:
    # Same dual-format handling as api/analytics.py: "...Z" vs "...+0530".
    if ts.endswith("Z"):
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%f%z")


def _ticket_dict(issue: dict) -> dict:
    return {
        "key": issue["key"],
        "summary": issue["summary"],
        "status": issue["status"],
        "type": issue["type"],
        "priority": issue["priority"],
        "assignee": issue["assignee"],
        "created": issue["created"],
    }


def _normalize_live(issue: dict) -> dict:
    f = issue["fields"]
    return {
        "key": issue["key"],
        "summary": f.get("summary"),
        "status": f["status"]["name"],
        "status_category": f["status"]["statusCategory"]["name"],
        "type": f["issuetype"]["name"],
        "priority": (f.get("priority") or {}).get("name"),
        "assignee": (f.get("assignee") or {}).get("displayName"),
        "assignee_email": (f.get("assignee") or {}).get("emailAddress"),
        "created": f.get("created"),
        "labels": f.get("labels") or [],
        "epic_key": (f.get("parent") or {}).get("key"),
    }


def _normalize_mock(row) -> dict:
    created = row["created_at"]
    return {
        "key": row["ticket_key"],
        "summary": row["summary"],
        # Mock rows have no separate "raw status" vs "category" distinction
        # the way Jira does (e.g. "Backlog" -> category "To Do") — the
        # stored status IS the category.
        "status": row["status"],
        "status_category": row["status"],
        "type": row["issue_type"],
        "priority": row["priority"],
        "assignee": row["assignee_name"],
        "assignee_email": row["assignee_email"],
        "created": created.isoformat() if hasattr(created, "isoformat") else created,
        "labels": list(row["labels"] or []),
        "epic_key": row["epic_key"],
    }


async def _mock_rows(request: Request, engagement_id: str) -> list:
    pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT ticket_key, summary, issue_type, status, priority, assignee_name,
               assignee_email, epic_key, labels, created_at
        FROM public.project_tickets
        WHERE engagement_id = $1
        ORDER BY created_at
        """,
        engagement_id,
    )
    return [_normalize_mock(r) for r in rows]


async def _all_issues(
    request: Request,
    engagement_id: Optional[str] = None,
    requester_email: Optional[str] = None,
) -> list:
    if engagement_id and engagement_id != LIVE_JIRA_ENGAGEMENT_ID:
        if requester_email:
            await _require_staffed(request.app.state.pool, requester_email, engagement_id)
        return await _mock_rows(request, engagement_id)

    _require_configured()
    issues = await jira_client.search_issues(f"project={jira_client.PROJECT_KEY}", ISSUE_FIELDS, max_results=100)
    return [_normalize_live(i) for i in issues]


@router.get("/api/project/summary")
async def summary(
    request: Request,
    engagement_id: Optional[str] = Query(default=None),
    requester_email: Optional[str] = Query(default=None),
):
    issues = await _all_issues(request, engagement_id, requester_email)
    total = len(issues)

    by_status = Counter(_status_category(i) for i in issues)
    by_type = Counter(i["type"] for i in issues)

    label_counts: Counter = Counter()
    for i in issues:
        for label in i["labels"]:
            label_counts[label] += 1

    unlinked = label_counts.get("unlinked", 0)
    out_of_scope = label_counts.get("out-of-scope", 0)
    ambiguous = label_counts.get("ambiguous", 0)
    blocked = label_counts.get("blocked", 0)
    reopened = label_counts.get("reopened", 0)

    unassigned = sum(1 for i in issues if not i["assignee"])
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


def _bucket_counts(issues: list) -> dict:
    counts: dict = {}
    for i in issues:
        assignee = i["assignee"]
        if not assignee:
            continue
        bucket = counts.setdefault(assignee, {"to_do": 0, "in_progress": 0, "done": 0})
        category = i["status_category"]
        if category == DONE_CATEGORY:
            bucket["done"] += 1
        elif category == IN_PROGRESS_CATEGORY:
            bucket["in_progress"] += 1
        else:
            bucket["to_do"] += 1
    return counts


@router.get("/api/project/team")
async def team(
    request: Request,
    engagement_id: Optional[str] = Query(default=None),
    requester_email: Optional[str] = Query(default=None),
):
    if engagement_id and engagement_id != LIVE_JIRA_ENGAGEMENT_ID:
        if requester_email:
            await _require_staffed(request.app.state.pool, requester_email, engagement_id)
        pool = request.app.state.pool
        members = await pool.fetch(
            "SELECT name, email FROM public.project_staffing WHERE engagement_id = $1 ORDER BY assigned_at",
            engagement_id,
        )
        issues = await _mock_rows(request, engagement_id)
        counts = _bucket_counts(issues)
        empty = {"to_do": 0, "in_progress": 0, "done": 0}
        return [
            {
                "account_id": m["email"],
                "name": m["name"],
                "email": m["email"],
                **counts.get(m["name"], empty),
            }
            for m in members
        ]

    _require_configured()
    users = await jira_client.assignable_users()
    issues = await _all_issues(request)
    counts = _bucket_counts(issues)
    empty = {"to_do": 0, "in_progress": 0, "done": 0}
    return [
        {
            "account_id": u["accountId"],
            "name": u["displayName"],
            "email": u.get("emailAddress"),
            **counts.get(u["displayName"], empty),
        }
        for u in users
    ]


@router.get("/api/project/epics")
async def epics(
    request: Request,
    engagement_id: Optional[str] = Query(default=None),
    requester_email: Optional[str] = Query(default=None),
):
    issues = await _all_issues(request, engagement_id, requester_email)
    epic_issues = [i for i in issues if i["type"] == "Epic"]

    children_by_epic: dict = {}
    for i in issues:
        parent = i["epic_key"]
        if parent:
            children_by_epic.setdefault(parent, []).append(i)

    out_of_scope_labels = {"out-of-scope", "ambiguous"}
    result = []
    for epic in epic_issues:
        children = children_by_epic.get(epic["key"], [])
        n = len(children)
        done = sum(1 for c in children if c["status_category"] == DONE_CATEGORY)
        compliant = sum(1 for c in children if not (set(c["labels"]) & out_of_scope_labels))
        result.append(
            {
                "key": epic["key"],
                "title": epic["summary"],
                "status": epic["status"],
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
    request: Request,
    label: Optional[str] = Query(default=None),
    assignee: Optional[str] = Query(default=None),
    epic: Optional[str] = Query(default=None),
    engagement_id: Optional[str] = Query(default=None),
    requester_email: Optional[str] = Query(default=None),
):
    issues = await _all_issues(request, engagement_id, requester_email)
    if label:
        issues = [i for i in issues if label in i["labels"]]
    if assignee:
        issues = [i for i in issues if i["assignee"] == assignee]
    if epic:
        issues = [i for i in issues if i["epic_key"] == epic]
    return [_ticket_dict(i) for i in issues]


@router.get("/api/project/risk-signals")
async def risk_signals(
    request: Request,
    engagement_id: Optional[str] = Query(default=None),
    requester_email: Optional[str] = Query(default=None),
):
    issues = await _all_issues(request, engagement_id, requester_email)

    label_counts: Counter = Counter()
    for i in issues:
        for label in i["labels"]:
            label_counts[label] += 1
    unassigned = sum(1 for i in issues if not i["assignee"])

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
        issues = await _all_issues(request)
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
