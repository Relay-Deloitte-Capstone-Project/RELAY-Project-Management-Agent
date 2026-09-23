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
by `_require_staffed` below, checked by email against public.project_staffing
— the same table and lookup api/access.py uses for Ask Project); callers
that omit `engagement_id` keep hitting the original single live-Jira
project, unchanged, for backward compatibility.
"""

from __future__ import annotations

import os
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api import jira_client
from api.auth import VerifiedUser, require_user
from api.scratchpad_triggers import DRAFT_TTL_DAYS

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


async def _resolve_ticket_source(pool, engagement_id: str) -> str:
    """Whether this engagement's ticket data actually lives in
    public.project_tickets, or should read from the single live Jira board
    this app is wired to instead. Checking for real rows — rather than
    trusting `engagement_id == LIVE_JIRA_ENGAGEMENT_ID` as a proxy for "has
    its own data" — is what keeps every ticket-driven endpoint correct if
    RELAY_ENGAGEMENT_ID or an engagement's id ever changes again: engagements
    created by the project-setup wizard (Acme Data Migration in particular)
    have project_staffing rows but an empty project_tickets table, and the
    previous version of this check routed straight to that empty table and
    silently returned zeros instead of falling back to live Jira. Identical
    reasoning to api/onboarding.py's _resolve_ticket_source, kept as a
    separate copy here since project.py must not import from onboarding.py.
    """
    if engagement_id == LIVE_JIRA_ENGAGEMENT_ID:
        return engagement_id
    count = await pool.fetchval(
        "SELECT count(*) FROM public.project_tickets WHERE engagement_id = $1",
        engagement_id,
    )
    return LIVE_JIRA_ENGAGEMENT_ID if not count else engagement_id


async def _all_issues(
    request: Request,
    engagement_id: Optional[str] = None,
    requester_email: Optional[str] = None,
) -> list:
    if engagement_id:
        if requester_email:
            await _require_staffed(request.app.state.pool, requester_email, engagement_id)
        source = await _resolve_ticket_source(request.app.state.pool, engagement_id)
        if source != LIVE_JIRA_ENGAGEMENT_ID:
            return await _mock_rows(request, source)

    _require_configured()
    issues = await jira_client.search_issues(f"project={jira_client.PROJECT_KEY}", ISSUE_FIELDS, max_results=100)
    return [_normalize_live(i) for i in issues]


async def _summary_impl(
    request: Request,
    engagement_id: Optional[str] = None,
    requester_email: Optional[str] = None,
) -> dict:
    """The actual /api/project/summary logic, factored out from the route
    below so api/onboarding.py can call it directly (its own routes already
    verify identity and staffing before reaching this point, so there's no
    Depends() to satisfy here)."""
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


@router.get("/api/project/summary")
async def summary(
    request: Request,
    engagement_id: Optional[str] = Query(default=None),
    user: VerifiedUser = Depends(require_user),
):
    return await _summary_impl(request, engagement_id, user["email"])


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


def _person_key(name: Optional[str]) -> str:
    """Jira display names and GitHub commit authors are the same people
    spelled two ways — "Agrim_Gairola" on the Jira board and in commit
    authorship, "Agrim Gairola" in public.project_staffing. Collapse both to
    one comparable key, the same normalization
    api/scratchpad_triggers._resolve_assignee_email already does, so a person
    doesn't silently split into two rows over punctuation."""
    return (name or "").replace("_", " ").strip().lower()


# Managers and admins are staffed on an engagement, but they aren't part of
# the delivery roster these views describe — and nobody below them has any
# business browsing their work profile, code trail or captured notes. Hidden
# at the query rather than in the UI, so the data never reaches the browser
# at all. Admin staffing management reads public.project_staffing directly
# (api/admin_projects.py) and is deliberately unaffected by this.
HIDDEN_ROSTER_ROLES = ["manager", "admin"]


async def _hidden_person_keys(pool, engagement_id: str) -> set:
    rows = await pool.fetch(
        "SELECT name FROM public.project_staffing "
        "WHERE engagement_id = $1 AND lower(role) = ANY($2::text[])",
        engagement_id,
        HIDDEN_ROSTER_ROLES,
    )
    return {_person_key(r["name"]) for r in rows}


async def _team_rows(
    request: Request,
    engagement_id: Optional[str] = None,
    requester_email: Optional[str] = None,
) -> list:
    """The delivery roster + per-person Jira status counts behind
    /api/project/team, factored out so team-continuity can build on exactly
    the same people and account_ids rather than assembling a second, subtly
    different roster.

    Managers and admins are filtered out — see HIDDEN_ROSTER_ROLES above.
    """
    pool = request.app.state.pool

    if engagement_id and engagement_id != LIVE_JIRA_ENGAGEMENT_ID:
        if requester_email:
            await _require_staffed(pool, requester_email, engagement_id)
        members = await pool.fetch(
            "SELECT name, email FROM public.project_staffing "
            "WHERE engagement_id = $1 AND lower(role) <> ALL($2::text[]) "
            "ORDER BY assigned_at",
            engagement_id,
            HIDDEN_ROSTER_ROLES,
        )
        # Roster stays scoped to the real engagement_id (project_staffing is
        # genuinely populated per-engagement), but ticket counts must follow
        # _resolve_ticket_source — an engagement can have staffing without
        # ever having its own project_tickets rows (see _all_issues above).
        source = await _resolve_ticket_source(pool, engagement_id)
        issues = (
            await _all_issues(request)
            if source == LIVE_JIRA_ENGAGEMENT_ID
            else await _mock_rows(request, source)
        )
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
    # The Jira board has no notion of these roles, so the exclusion list comes
    # from project_staffing and is matched on the normalized name.
    hidden = await _hidden_person_keys(pool, LIVE_JIRA_ENGAGEMENT_ID)
    return [
        {
            "account_id": u["accountId"],
            "name": u["displayName"],
            "email": u.get("emailAddress"),
            **counts.get(u["displayName"], empty),
        }
        for u in users
        if _person_key(u["displayName"]) not in hidden
    ]


@router.get("/api/project/team")
async def team(
    request: Request,
    engagement_id: Optional[str] = Query(default=None),
    user: VerifiedUser = Depends(require_user),
):
    return await _team_rows(request, engagement_id, user["email"])


@router.get("/api/project/team-continuity")
async def team_continuity(
    request: Request,
    engagement_id: Optional[str] = Query(default=None),
    user: VerifiedUser = Depends(require_user),
):
    """Standing per-person continuity state for the Team handover overview:
    real Jira load, real commit trail, real captured-knowledge counts, and —
    the point of the page — how much in-flight work currently has nothing
    written down anywhere.

    Deliberately NOT a productivity view. api/analytics.py states the same
    constraint at length: no velocity, no ranking, no per-person "behind
    schedule" flag. `undocumented_in_flight` describes the documentation
    state of *work items* ("2 tickets nobody has written anything about"),
    never a judgement about the person carrying them — the remedy is a note
    or a linked commit, not working faster.

    Draft scratchpad notes are counted but their content is never returned:
    a draft belongs to the developer until they approve it (api/scratchpad.py),
    so a manager can see that knowledge is being captured without being able
    to read an unapproved note.
    """
    pool = request.app.state.pool
    eid = engagement_id or LIVE_JIRA_ENGAGEMENT_ID

    members = await _team_rows(request, engagement_id, user["email"])
    issues = await _all_issues(request, engagement_id, user["email"])

    staffing = await pool.fetch(
        "SELECT name, email, role FROM public.project_staffing WHERE engagement_id = $1",
        eid,
    )
    staff_by_person = {_person_key(r["name"]): r for r in staffing}

    # In-flight work per person, and the ticket keys behind it.
    in_flight: dict[str, list[str]] = {}
    for i in issues:
        if i["assignee"] and _status_category(i) == IN_PROGRESS_CATEGORY:
            in_flight.setdefault(_person_key(i["assignee"]), []).append(i["key"])
    all_keys = [k for keys in in_flight.values() for k in keys]

    # "Written down" means either a Scratchpad note distilled from the ticket
    # or at least one commit that references it — the two places this system
    # actually retains reasoning. Anything with neither would leave with the
    # person.
    documented: set = set()
    if all_keys:
        noted = await pool.fetch(
            "SELECT DISTINCT source_ticket FROM zone3.scratchpad_notes "
            "WHERE source_ticket = ANY($1::text[])",
            all_keys,
        )
        documented |= {r["source_ticket"] for r in noted}
        linked = await pool.fetch(
            """
            SELECT DISTINCT ref AS ticket_key
            FROM public.chunks c,
                 jsonb_array_elements_text(c.metadata->'ticket_refs') AS ref
            WHERE c.source_type = 'github_commit'
              AND c.engagement_id = $1
              AND c.metadata ? 'ticket_refs'
              AND ref = ANY($2::text[])
            """,
            eid,
            all_keys,
        )
        documented |= {r["ticket_key"] for r in linked}

    commit_rows = await pool.fetch(
        "SELECT author, COUNT(*) AS n, MAX(committed_at) AS last_at "
        "FROM raw.github_commits GROUP BY author"
    )
    commits_by_person = {_person_key(r["author"]): r for r in commit_rows}

    note_rows = await pool.fetch(
        "SELECT lower(email) AS email, status, COUNT(*) AS n "
        "FROM zone3.scratchpad_notes WHERE engagement_id = $1 GROUP BY lower(email), status",
        eid,
    )
    notes_by_email: dict = {}
    for r in note_rows:
        notes_by_email.setdefault(r["email"], {})[r["status"]] = r["n"]

    result = []
    for m in members:
        key = _person_key(m["name"])
        staff = staff_by_person.get(key)
        email = (staff["email"] if staff else m.get("email")) or ""
        counts = notes_by_email.get(email.lower(), {})
        commits = commits_by_person.get(key)
        keys = in_flight.get(key, [])

        result.append(
            {
                **m,
                "email": email or None,
                "role": staff["role"] if staff else None,
                "commit_count": commits["n"] if commits else 0,
                "last_commit_at": (
                    commits["last_at"].isoformat() if commits and commits["last_at"] else None
                ),
                "notes_approved": counts.get("approved", 0) + counts.get("promoted", 0),
                "notes_draft": counts.get("draft", 0),
                "in_flight": len(keys),
                "undocumented_in_flight": sum(1 for k in keys if k not in documented),
            }
        )
    return result


@router.get("/api/project/member-trail")
async def member_trail(
    request: Request,
    name: str = Query(...),
    engagement_id: Optional[str] = Query(default=None),
    limit: int = Query(default=15),
    user: VerifiedUser = Depends(require_user),
):
    """One person's real recent commits and which tickets each references —
    the code trail behind their work state, for the Team handover profile.

    Commit-to-ticket linkage lives only in public.chunks.metadata.ticket_refs
    (raw.github_commits has no ticket column), so the two are joined on sha
    here rather than the caller stitching them together.

    Also returns their captured-knowledge counts. Draft *content* is
    deliberately never included — see team_continuity above.
    """
    pool = request.app.state.pool
    eid = engagement_id or LIVE_JIRA_ENGAGEMENT_ID
    if engagement_id:
        await _require_staffed(pool, user["email"], engagement_id)
    key = _person_key(name)

    rows = await pool.fetch(
        """
        SELECT c.sha, c.message, c.committed_at, c.repo, c.files_changed
        FROM raw.github_commits c
        WHERE replace(lower(c.author), '_', ' ') = $1
        ORDER BY c.committed_at DESC
        LIMIT $2
        """,
        key,
        limit,
    )

    shas = [r["sha"] for r in rows]
    refs_by_sha: dict = {}
    if shas:
        ref_rows = await pool.fetch(
            """
            SELECT c.metadata->>'sha' AS sha, ref AS ticket_key
            FROM public.chunks c,
                 jsonb_array_elements_text(c.metadata->'ticket_refs') AS ref
            WHERE c.source_type = 'github_commit'
              AND c.engagement_id = $1
              AND c.metadata ? 'ticket_refs'
              AND c.metadata->>'sha' = ANY($2::text[])
            """,
            eid,
            shas,
        )
        for r in ref_rows:
            refs_by_sha.setdefault(r["sha"], []).append(r["ticket_key"])

    email = await pool.fetchval(
        "SELECT email FROM public.project_staffing "
        "WHERE engagement_id = $1 AND replace(lower(name), '_', ' ') = $2",
        eid,
        key,
    )
    note_counts: dict = {}
    if email:
        for r in await pool.fetch(
            "SELECT status, COUNT(*) AS n FROM zone3.scratchpad_notes "
            "WHERE engagement_id = $1 AND lower(email) = lower($2) GROUP BY status",
            eid,
            email,
        ):
            note_counts[r["status"]] = r["n"]

    return {
        "name": name,
        "email": email,
        "commits": [
            {
                "sha": r["sha"],
                "sha_short": r["sha"][:7],
                "message": (r["message"] or "").splitlines()[0] if r["message"] else "",
                "committed_at": r["committed_at"].isoformat() if r["committed_at"] else None,
                "repo": r["repo"],
                "files_changed": r["files_changed"],
                "ticket_refs": refs_by_sha.get(r["sha"], []),
            }
            for r in rows
        ],
        "notes_approved": note_counts.get("approved", 0) + note_counts.get("promoted", 0),
        "notes_draft": note_counts.get("draft", 0),
    }


@router.get("/api/project/epics")
async def epics(
    request: Request,
    engagement_id: Optional[str] = Query(default=None),
    user: VerifiedUser = Depends(require_user),
):
    issues = await _all_issues(request, engagement_id, user["email"])
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
    # Jira's own issue order isn't guaranteed to be epic-number order (it
    # came back descending) — sort explicitly so this list is stable and
    # ascending, matching /api/scope/epics on the manager side.
    result.sort(key=lambda e: _epic_sort_key(e["key"]))
    return result


def _epic_sort_key(epic_key: str) -> tuple:
    prefix, _, suffix = epic_key.rpartition("-")
    return (prefix, int(suffix)) if suffix.isdigit() else (epic_key, 0)


@router.get("/api/project/sprint-history")
async def sprint_history(user: VerifiedUser = Depends(require_user)):
    _require_configured()
    sprints = await jira_client.list_sprints()

    result = []
    for s in sprints:
        if s["state"] == "future":
            result.append({"id": s["id"], "name": s["name"], "state": s["state"], "completion_pct": None})
            continue
        issues = await jira_client.sprint_issues(s["id"])
        n = len(issues)
        # jira_client.sprint_issues() returns raw Jira Agile-API issue dicts
        # ({"fields": {"status": {...}}}), not the normalized shape
        # _normalize_live() produces — _status_category(i)["status_category"]
        # would KeyError here. Read the status category straight off the
        # raw field instead of routing through the live/mock-issue helper.
        done = sum(
            1
            for i in issues
            if (i.get("fields", {}).get("status", {}).get("statusCategory", {}) or {}).get("name")
            == DONE_CATEGORY
        )
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
    user: VerifiedUser = Depends(require_user),
):
    issues = await _all_issues(request, engagement_id, user["email"])
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
    user: VerifiedUser = Depends(require_user),
):
    issues = await _all_issues(request, engagement_id, user["email"])

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

    # Sync with Scratchpad: a manager's risk view should surface knowledge
    # that's about to be silently lost, not just Jira label counts. Scoped
    # to this same engagement so it reads Team-level risk for whichever
    # project is being viewed, same as everything else on this endpoint.
    scratchpad_engagement_id = engagement_id or LIVE_JIRA_ENGAGEMENT_ID
    pool = request.app.state.pool
    expiring_soon_days = max(DRAFT_TTL_DAYS - 2, 0)
    expiring = await pool.fetchval(
        """
        SELECT COUNT(*) FROM zone3.scratchpad_notes
        WHERE engagement_id = $1 AND status = 'draft'
          AND created_at < NOW() - make_interval(days => $2)
        """,
        scratchpad_engagement_id,
        expiring_soon_days,
    )
    if expiring:
        signals.append(
            {
                "level": "high",
                "title": f"{expiring} knowledge draft{'s' if expiring != 1 else ''} expiring soon in Scratchpad",
                "detail": f"Auto-drafted notes are dismissed if unreviewed after {DRAFT_TTL_DAYS} days — nudge the developer to review.",
            }
        )
    # Worthy fixes (is_note_worthy passed) that never became a note — usually
    # because the Jira assignee couldn't be matched to project_staffing.
    # Not a perfect signal (a developer may have reviewed and dismissed one
    # on purpose), but a useful "knowledge may be leaking" nudge.
    uncaptured = await pool.fetchval(
        """
        SELECT COUNT(*) FROM zone3.scratchpad_draft_candidates c
        WHERE c.engagement_id = $1 AND c.worthy = TRUE
          AND NOT EXISTS (
              SELECT 1 FROM zone3.scratchpad_notes n
              WHERE n.engagement_id = c.engagement_id AND n.source_ticket = c.ticket_key
          )
        """,
        scratchpad_engagement_id,
    )
    if uncaptured:
        signals.append(
            {
                "level": "medium",
                "title": f"{uncaptured} notable fix{'es' if uncaptured != 1 else ''} captured no knowledge note",
                "detail": "Flagged note-worthy, but no Scratchpad note exists — likely no staffing match for the Jira assignee.",
            }
        )
    return signals


@router.get("/api/project/activity")
async def activity(request: Request, user: VerifiedUser = Depends(require_user)):
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
async def team_activity(request: Request, user: VerifiedUser = Depends(require_user)):
    """Per-person Ask Project usage, real — joined by the app's own Prisma
    user id (zone3.chat_sessions.user_id). The frontend joins this to a
    person by id, separately from the Jira-name join /api/project/team uses.

    Scratchpad notes are deliberately NOT joined in here: zone3.scratchpad_
    notes is keyed by email, not Prisma user id (see api/scratchpad.py's
    module docstring — an auto-draft can be created with no logged-in
    frontend session at all, so email is the only identity value both paths
    can independently produce). There is no cross-database join available
    from here to translate one to the other, and the frontend's rendered
    columns never consumed a notes_captured value from this endpoint, so
    this only ever reports chat activity now rather than silently querying
    a column ("user_id" on scratchpad_notes) that no longer exists.
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

    questions = {r["user_id"]: r["n"] for r in question_rows}
    total_questions = sum(questions.values())

    return [
        {
            "user_id": uid,
            "questions_asked": n,
            "chat_usage_pct": round(n / total_questions * 100, 1) if total_questions else 0,
        }
        for uid, n in questions.items()
    ]


@router.get("/api/project/services")
async def services(request: Request, user: VerifiedUser = Depends(require_user)):
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


@router.get("/api/project/recent-knowledge")
async def recent_knowledge(
    engagement_id: str,
    request: Request,
    limit: int = 8,
    user: VerifiedUser = Depends(require_user),
):
    """What has been added to the project's memory lately — approved scratchpad
    notes and confirmed PM documents, newest first. Gives a developer a way to
    see what changed since they last looked, which nothing else surfaces."""
    await _require_staffed(request.app.state.pool, user["email"], engagement_id)
    async with request.app.state.pool.acquire() as conn:
        notes = await conn.fetch(
            """
            SELECT title,
                   coalesce(approved_at, created_at) AS at,
                   email AS author
            FROM zone3.scratchpad_notes
            WHERE engagement_id = $1 AND status IN ('approved', 'promoted')
            ORDER BY coalesce(approved_at, created_at) DESC
            LIMIT $2
            """,
            engagement_id,
            limit,
        )
        documents = await conn.fetch(
            """
            SELECT source_file_name AS title,
                   doc_type,
                   coalesce(confirmed_at, uploaded_at) AS at,
                   uploaded_by AS author
            FROM public.pm_documents
            WHERE engagement_id = $1 AND ingestion_status = 'confirmed'
            ORDER BY coalesce(confirmed_at, uploaded_at) DESC
            LIMIT $2
            """,
            engagement_id,
            limit,
        )

    items = [
        {"kind": "note", "title": r["title"], "at": r["at"], "author": r["author"], "doc_type": None}
        for r in notes
    ] + [
        {
            "kind": "document",
            "title": r["title"],
            "at": r["at"],
            "author": r["author"],
            "doc_type": r["doc_type"],
        }
        for r in documents
    ]
    items.sort(key=lambda i: (i["at"] is not None, i["at"]), reverse=True)
    return items[:limit]


@router.get("/api/project/unassigned-tickets")
async def unassigned_tickets(request: Request, limit: int = 10, user: VerifiedUser = Depends(require_user)):
    """Open Jira tickets with nobody on them. Deliberately not tied to any
    person — it's a gap in the board, not a statement about anyone."""
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT ticket_key, summary, status, issue_type
            FROM raw.jira_tickets
            WHERE assignee IS NULL AND status <> 'Done'
            ORDER BY ticket_key
            LIMIT $1
            """,
            limit,
        )
    return [dict(row) for row in rows]


@router.get("/api/project/config")
async def config(user: VerifiedUser = Depends(require_user)):
    return {
        "jira_site": jira_client.SITE if jira_client.configured() else None,
        "llm_provider": os.environ.get("LLM_PROVIDER"),
        "groq_model": os.environ.get("GROQ_MODEL"),
        "gemini_model": os.environ.get("GEMINI_MODEL"),
    }
