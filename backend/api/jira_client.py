"""Thin async Jira Cloud client shared by backend API routes."""

from __future__ import annotations

import base64
import os

import httpx

SITE = os.environ.get("JIRA_SITE", "")
EMAIL = os.environ.get("JIRA_EMAIL", "")
TOKEN = os.environ.get("JIRA_API_TOKEN", "")
BOARD_ID = int(os.environ.get("JIRA_BOARD_ID", "34"))

_AUTH_HEADER = "Basic " + base64.b64encode(f"{EMAIL}:{TOKEN}".encode()).decode()

LEAVE_PROPERTY = "relay.handover.leave"


def configured() -> bool:
    return bool(SITE and EMAIL and TOKEN)


def _headers() -> dict[str, str]:
    return {
        "Authorization": _AUTH_HEADER,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


async def get(path: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(base_url=f"https://{SITE}", timeout=30) as client:
        resp = await client.get(
            path,
            params=params,
            headers={"Authorization": _AUTH_HEADER, "Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()


async def active_sprint(board_id: int = BOARD_ID) -> dict | None:
    data = await get(f"/rest/agile/1.0/board/{board_id}/sprint", {"state": "active"})
    sprints = data.get("values", [])
    return sprints[0] if sprints else None


async def sprint_issues(sprint_id: int) -> list:
    """All issues in a sprint, with just the fields the analytics endpoints need."""
    issues = []
    start_at = 0

    while True:
        data = await get(
            f"/rest/agile/1.0/sprint/{sprint_id}/issue",
            {"fields": "status,assignee", "startAt": start_at, "maxResults": 100},
        )

        batch = data.get("issues", [])
        issues.extend(batch)
        start_at += len(batch)

        if start_at >= data.get("total", 0) or not batch:
            break

    return issues


async def kpd_issues() -> list:
    """Read open issues from the real KPD Jira board."""
    issues = []
    start_at = 0

    while True:
        data = await get(
            f"/rest/agile/1.0/board/{BOARD_ID}/issue",
            {
                "jql": "project = KPD AND statusCategory != Done ORDER BY updated DESC",
                "fields": "summary,status,assignee,priority,updated",
                "startAt": start_at,
                "maxResults": 100,
            },
        )

        batch = data.get("issues", [])
        issues.extend(batch)
        start_at += len(batch)

        if start_at >= data.get("total", 0) or not batch:
            break

    return issues


async def assign_issue(issue_key: str, account_id: str | None) -> None:
    """Assign a Jira issue to a user, or unassign it."""
    async with httpx.AsyncClient(base_url=f"https://{SITE}", timeout=30) as client:
        resp = await client.put(
            f"/rest/api/3/issue/{issue_key}/assignee",
            json={"accountId": account_id},
            headers=_headers(),
        )
        resp.raise_for_status()


async def project_team(project_key: str = "KPD") -> list[dict]:
    """Return real Jira users who can be assigned issues in the KPD project."""
    users: list[dict] = []
    start_at = 0

    while True:
        data = await get(
            "/rest/api/3/user/assignable/search",
            {
                "project": project_key,
                "startAt": start_at,
                "maxResults": 100,
            },
        )

        if not isinstance(data, list):
            break

        users.extend(data)

        if len(data) < 100:
            break

        start_at += len(data)

    return [
        {
            "account_id": user.get("accountId"),
            "name": user.get("displayName") or user.get("emailAddress") or "Unknown",
        }
        for user in users
        if user.get("accountId")
    ]


async def set_user_leave(
    account_id: str,
    on_leave: bool,
    leave_date: str | None = None,
    return_date: str | None = None,
) -> None:
    """Persist Team Handover leave state on the real Jira user."""
    value = {
        "on_leave": on_leave,
        "leave_date": leave_date,
        "return_date": return_date,
    }

    async with httpx.AsyncClient(base_url=f"https://{SITE}", timeout=30) as client:
        resp = await client.put(
            f"/rest/api/3/user/properties/{LEAVE_PROPERTY}",
            params={"accountId": account_id},
            json=value,
            headers=_headers(),
        )
        resp.raise_for_status()


async def get_user_leave(account_id: str) -> dict | None:
    """Read Team Handover leave state from the real Jira user."""
    async with httpx.AsyncClient(base_url=f"https://{SITE}", timeout=30) as client:
        resp = await client.get(
            f"/rest/api/3/user/properties/{LEAVE_PROPERTY}",
            params={"accountId": account_id},
            headers={
                "Authorization": _AUTH_HEADER,
                "Accept": "application/json",
            },
        )

        if resp.status_code == 404:
            return None

        resp.raise_for_status()

        data = resp.json()
        return data.get("value")