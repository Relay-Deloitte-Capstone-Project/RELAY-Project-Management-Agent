from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from api import jira_client
from api.auth import VerifiedUser, require_role

router = APIRouter(prefix="/api/scope", tags=["scope"])

# Scope Guardian is a manager-facing view (mgr.scope.tsx / mgr.epics.tsx) —
# had no auth at all before.
_Manager = Depends(require_role("ADMIN", "MANAGER"))

# The epic summary is also surfaced on dev.epics.tsx (a developer generating
# a plain-language recap of their own epic) — narrower than _Manager on
# purpose, since the other routes below return SOW compliance/deliverable
# data developers shouldn't see, but this one route only ever returns a
# short synthesized paragraph.
_ManagerOrDeveloper = Depends(require_role("ADMIN", "MANAGER", "DEVELOPER"))


@router.get("/deliverables")
async def deliverables(request: Request, user: VerifiedUser = _Manager):
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                deliverable_key,
                deliverable_title,
                total_tickets,
                in_scope_count,
                compliance_percent
            FROM sow_deliverable_compliance
            ORDER BY deliverable_key
        """)

    return [dict(row) for row in rows]


@router.get("/alerts")
async def alerts(request: Request, user: VerifiedUser = _Manager):
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                ticket_id,
                ticket_summary,
                deliverable_key,
                status,
                clause,
                reason,
                computed_at
            FROM sow_scope_alerts
            ORDER BY computed_at DESC, ticket_id
            LIMIT 50
        """)

    return [dict(row) for row in rows]


@router.get("/tickets/{epic_key}")
async def epic_tickets(epic_key: str, request: Request, user: VerifiedUser = _Manager):
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                ticket_id,
                ticket_summary,
                epic_key,
                deliverable_key,
                status,
                clause,
                reason,
                computed_at
            FROM sow_ticket_classifications
            WHERE epic_key = $1
            ORDER BY ticket_id
        """, epic_key)

    return [dict(row) for row in rows]


@router.get("/epics")
async def epic_progress(request: Request, user: VerifiedUser = _Manager):
    """Return Epic Progress using live Jira status and Scope Guardian compliance."""
    from api.jira_client import epic_issues

    pool = request.app.state.pool

    epic_titles = {
        "KPD-1": "Data Ingestion Connectors (Jira + GitHub)",
        "KPD-2": "Ticket-to-Commit Linkage & Coverage Reporting",
        "KPD-3": "Hybrid Search & Cited Q&A",
        "KPD-4": "Handover Brief & Work-State Assembly",
        "KPD-5": "Scope Guardian — SOW Parsing & Classification",
        "KPD-6": "Provenance & Read-Time Permission Evaluation",
        "KPD-7": "Secrets Scanning & Canary Tokens",
        "KPD-8": "Auto-Draft from PRs — Assisted Capture",
    }

    # Scope Guardian classification counts.
    rows = await pool.fetch(
        """
        SELECT epic_key, ticket_id
        FROM sow_ticket_classifications
        WHERE epic_key IS NOT NULL
        ORDER BY epic_key, ticket_id
        """
    )

    classified_by_epic = {}
    for row in rows:
        classified_by_epic.setdefault(row["epic_key"], []).append(row["ticket_id"])

    result = []

    for epic_key in [f"KPD-{i}" for i in range(1, 9)]:
        classified_keys = set(classified_by_epic.get(epic_key, []))

        # Get the authoritative live Jira workflow status.
        try:
            jira_issues = await epic_issues(epic_key)
        except Exception as exc:
            print(f"Jira epic lookup failed for {epic_key}: {exc}")
            jira_issues = []

        total = len(classified_keys)

        # Only count classified tickets when calculating implementation progress.
        live_statuses = {
            issue.get("key"): (
                (issue.get("fields") or {}).get("status") or {}
            )
            for issue in jira_issues
            if issue.get("key") in classified_keys
        }

        done = sum(
            1
            for status in live_statuses.values()
            if (
                ((status.get("statusCategory") or {}).get("key") or "").lower()
                == "done"
                or (status.get("name") or "").lower()
                in {"done", "closed", "resolved", "complete", "completed"}
            )
        )

        completion = round((done / total) * 100, 2) if total else 0

        compliance_row = await pool.fetchrow(
            """
            SELECT compliance_percent
            FROM sow_deliverable_compliance
            WHERE deliverable_key = $1
            """,
            f"D{epic_key.split('-')[1]}",
        )

        compliance = (
            float(compliance_row["compliance_percent"])
            if compliance_row
            else 0
        )

        result.append(
            {
                "epic_key": epic_key,
                "epic_title": epic_titles[epic_key],
                "ticket_count": total,
                "completion_percent": completion,
                "scope_compliance_percent": compliance,
                "status": (
                    "Done"
                    if total and completion == 100
                    else "In progress"
                ),
            }
        )

    return result

@router.post("/epics/{epic_key}/summary")
async def generate_epic_summary(epic_key: str, request: Request, user: VerifiedUser = _ManagerOrDeveloper):
    """Generate an AI summary from the latest classified Jira state."""
    import os
    from groq import AsyncGroq

    pool = request.app.state.pool

    rows = await pool.fetch(
        """
        SELECT ticket_id, ticket_summary, status, reason
        FROM sow_ticket_classifications
        WHERE epic_key = $1
        ORDER BY ticket_id
        """,
        epic_key,
    )

    if not rows:
        return {
            "epic_key": epic_key,
            "summary": f"No classified Jira tickets are available for {epic_key} yet.",
        }

    total = len(rows)
    in_scope = sum(1 for r in rows if r["status"] == "in_scope")
    out_scope = sum(1 for r in rows if r["status"] == "out_of_scope")

    ticket_lines = "\n".join(
        f"- {r['ticket_id']}: {r['ticket_summary']} [{r['status']}]"
        for r in rows[:40]
    )

    prompt = f"""
You are summarizing the current state of Jira Epic {epic_key}.

There are {total} classified tickets.
{in_scope} are in scope.
{out_scope} are out of scope.

Current Jira/SOW ticket data:
{ticket_lines}

Write a concise 3-4 sentence executive summary.
Mention:
1. what work dominates this epic,
2. scope/compliance concerns,
3. notable risks or out-of-scope work,
4. what should be reviewed next.

Do not invent facts or ticket numbers.
"""

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return {
            "epic_key": epic_key,
            "summary": "AI summary unavailable: GROQ_API_KEY is not configured.",
        }

    client = AsyncGroq(api_key=api_key)

    response = await client.chat.completions.create(
        model=os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b"),
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=300,
    )

    return {
        "epic_key": epic_key,
        "summary": response.choices[0].message.content.strip(),
    }
