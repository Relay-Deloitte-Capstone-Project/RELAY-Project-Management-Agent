"""Manager dashboard analytics — GET /api/analytics/burndown and
/api/analytics/employee-breakdown, backed live by the real Jira board
(backend/scripts/jira_sprint_setup.py restructured KPD into 8 per-epic
sprints — this reads whichever one is currently `active`).

Deliberately sprint-level / status-count only, per the task's compliance
constraint: no per-person velocity, no ranking or leaderboard ordering, and
no "behind schedule" flag on an individual — only the sprint as a whole ever
gets an on/off-track signal.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from api import jira_client

router = APIRouter()

DONE_CATEGORY = "Done"


def _remaining_count(issues: list) -> int:
    return sum(1 for i in issues if i["fields"]["status"]["statusCategory"]["name"] != DONE_CATEGORY)


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


@router.get("/api/analytics/burndown")
async def burndown():
    if not jira_client.configured():
        raise HTTPException(status_code=503, detail="Jira is not configured on the backend")

    sprint = await jira_client.active_sprint()
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

    # Only one real point, for today — we don't have historical status
    # snapshots (no changelog ingestion), so a fabricated daily-actual series
    # would misrepresent what's genuinely known versus the ideal projection.
    actual = []
    if start <= now <= end:
        actual = [{"date": now.date().isoformat(), "remaining": remaining}]
    elif now > end:
        actual = [{"date": end.date().isoformat(), "remaining": remaining}]

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
async def employee_breakdown():
    if not jira_client.configured():
        raise HTTPException(status_code=503, detail="Jira is not configured on the backend")

    sprint = await jira_client.active_sprint()
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
