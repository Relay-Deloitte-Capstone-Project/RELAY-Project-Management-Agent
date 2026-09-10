"""Manager dashboard analytics — GET /api/analytics/sprints (list, for the
dashboard's sprint selector), /api/analytics/burndown and
/api/analytics/employee-breakdown (both take an optional ?sprint_id=,
defaulting to whichever sprint is currently `active`) — backed live by the
real Jira board (backend/scripts/jira_sprint_setup.py restructured KPD into
8 per-epic sprints).

Deliberately sprint-level / status-count only, per the task's compliance
constraint: no per-person velocity, no ranking or leaderboard ordering, and
no "behind schedule" flag on an individual — only the sprint as a whole ever
gets an on/off-track signal.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from api import jira_client

router = APIRouter()

DONE_CATEGORY = "Done"


def _remaining_count(issues: list) -> int:
    return sum(1 for i in issues if i["fields"]["status"]["statusCategory"]["name"] != DONE_CATEGORY)


def _parse(ts: str) -> datetime:
    # Sprint start/end come as "...Z"; changelog "created" timestamps come as
    # "...+0530" (no colon in the offset) — Python 3.9's fromisoformat only
    # accepts the colon form, so that shape needs strptime instead.
    if ts.endswith("Z"):
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%f%z")


async def _actual_daily_series(issues: list, start: datetime, end: datetime) -> list:
    """Real remaining-count-per-day, built from each issue's actual status
    changelog — not a single "today" snapshot. An issue only counts as done
    on the day of its *last* transition into a Done-category status, so one
    that was completed, reopened, and redone still reads as done exactly
    once, on the transition that stuck.
    """
    done_names = {
        i["fields"]["status"]["name"]
        for i in issues
        if i["fields"]["status"]["statusCategory"]["name"] == DONE_CATEGORY
    }
    if not done_names:
        return []

    changelogs = await jira_client.issue_status_changelogs([i["key"] for i in issues])

    done_at = {}
    for issue in issues:
        key = issue["key"]
        # Only issues currently sitting in a Done-category status count as
        # resolved for burndown purposes — one that visited Done and bounced
        # back out is still outstanding work.
        if issue["fields"]["status"]["name"] not in done_names:
            continue
        transitions = [
            _parse(changed_at) for changed_at, new_status in changelogs.get(key, []) if new_status in done_names
        ]
        if transitions:
            done_at[key] = max(transitions)

    now = datetime.now(timezone.utc)
    last_day = min(now, end)
    total = len(issues)

    series = []
    day = start
    while day.date() <= last_day.date():
        day_end = day.replace(hour=23, minute=59, second=59, microsecond=999999)
        remaining = total - sum(1 for d in done_at.values() if d <= day_end)
        series.append({"date": day.date().isoformat(), "remaining": remaining})
        day += timedelta(days=1)
    return series


@router.get("/api/analytics/sprints")
async def sprints():
    if not jira_client.configured():
        raise HTTPException(status_code=503, detail="Jira is not configured on the backend")

    all_sprints = await jira_client.list_sprints()
    return [
        {"id": s["id"], "name": s["name"], "state": s["state"], "start": s.get("startDate"), "end": s.get("endDate")}
        for s in all_sprints
    ]


@router.get("/api/analytics/burndown")
async def burndown(sprint_id: Optional[int] = Query(default=None)):
    if not jira_client.configured():
        raise HTTPException(status_code=503, detail="Jira is not configured on the backend")

    sprint = await jira_client.get_sprint(sprint_id) if sprint_id is not None else await jira_client.active_sprint()
    if sprint is None:
        return {"sprint": None, "total_issues": 0, "remaining_issues": 0, "ideal": [], "actual": []}

    issues = await jira_client.sprint_issues(sprint["id"])
    total = len(issues)
    remaining = _remaining_count(issues)

    start = _parse(sprint["startDate"])
    end = _parse(sprint["endDate"])
    now = datetime.now(timezone.utc)
    span_days = max((end - start).days, 1)

    # Ideal line: a straight burn from `total` at sprint start to 0 at sprint
    # end — ticket-count based (not story points; none are tracked in this
    # board), one point per day.
    ideal = [
        {
            "date": (start + timedelta(days=day)).date().isoformat(),
            "remaining": round(total * (1 - day / span_days), 1),
        }
        for day in range(span_days + 1)
    ]

    # A real per-day remaining-count series, from Jira's own status changelog
    # — not a fabricated curve. This board's ticket data was bulk-seeded (every
    # status set once, in one batch) rather than worked day by day, so a
    # sprint only shows real movement if its window happens to bracket that
    # batch's timestamps. Sprint 4 (id 37) was deliberately realigned to do
    # so (see scripts/jira_realign_dates.py); Jira doesn't allow editing dates
    # on an already-closed sprint, so sprints 1/35/36 keep their original
    # windows and will legitimately show a flat actual line.
    actual = await _actual_daily_series(issues, start, end) if now >= start else []

    return {
        "sprint": {
            "id": sprint["id"],
            "name": sprint["name"],
            "state": sprint["state"],
            "start": sprint["startDate"],
            "end": sprint["endDate"],
        },
        "total_issues": total,
        "remaining_issues": remaining,
        "ideal": ideal,
        "actual": actual,
    }


@router.get("/api/analytics/employee-breakdown")
async def employee_breakdown(sprint_id: Optional[int] = Query(default=None)):
    if not jira_client.configured():
        raise HTTPException(status_code=503, detail="Jira is not configured on the backend")

    sprint = await jira_client.get_sprint(sprint_id) if sprint_id is not None else await jira_client.active_sprint()
    if sprint is None:
        return {"sprint": None, "breakdown": []}

    issues = await jira_client.sprint_issues(sprint["id"])

    # Status-count only per assignee — no velocity, no completion ratio, no
    # ordering by "most/least done" (would read as a de facto ranking).
    by_person: dict = {}
    for issue in issues:
        fields = issue["fields"]
        assignee = fields.get("assignee")
        name = assignee["displayName"] if assignee else "Unassigned"
        bucket = by_person.setdefault(name, {"assignee": name, "to_do": 0, "in_progress": 0, "done": 0})
        category = fields["status"]["statusCategory"]["name"]
        if category == "Done":
            bucket["done"] += 1
        elif category == "In Progress":
            bucket["in_progress"] += 1
        else:
            bucket["to_do"] += 1

    # Alphabetical, not by ticket count — sorting by workload would read as
    # an implicit ranking, which the task explicitly rules out.
    breakdown = sorted(by_person.values(), key=lambda b: b["assignee"])

    return {
        "sprint": {"id": sprint["id"], "name": sprint["name"]},
        "breakdown": breakdown,
    }
