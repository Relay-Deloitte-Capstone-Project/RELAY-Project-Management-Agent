"""Thin async Jira Cloud client shared by backend API routes."""

from __future__ import annotations

import asyncio
import base64
import os

import httpx

# Accept the site with or without scheme — pasting "https://x.atlassian.net"
# would otherwise produce a malformed https://https://... base URL and every
# analytics call would 500 (surfacing as "Failed to fetch" in the browser,
# since FastAPI's unhandled-error responses bypass the CORS middleware).
SITE = os.environ.get("JIRA_SITE", "").removeprefix("https://").removeprefix("http://").strip("/")
EMAIL = os.environ.get("JIRA_EMAIL", "")
TOKEN = os.environ.get("JIRA_API_TOKEN", "")
BOARD_ID = int(os.environ.get("JIRA_BOARD_ID", "34"))
PROJECT_KEY = os.environ.get("JIRA_PROJECT_KEY", "KPD")

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


async def list_sprints(board_id: int = BOARD_ID) -> list:
    """All sprints on the board (any state), for the dashboard's sprint selector."""
    data = await get(f"/rest/agile/1.0/board/{board_id}/sprint", {"maxResults": 50})
    return data.get("values", [])


async def get_sprint(sprint_id: int) -> dict:
    return await get(f"/rest/agile/1.0/sprint/{sprint_id}")


async def sprint_issues(sprint_id: int, fields: str = "status,assignee") -> list:
    """All issues in a sprint, with just the fields the caller needs."""
    issues = []
    start_at = 0

    while True:
        data = await get(
            f"/rest/agile/1.0/sprint/{sprint_id}/issue",
            {"fields": fields, "startAt": start_at, "maxResults": 100},
        )

        batch = data.get("issues", [])
        issues.extend(batch)
        start_at += len(batch)

        if start_at >= data.get("total", 0) or not batch:
            break

    return issues


async def search_issues(jql: str, fields: str, max_results: int = 100) -> list:
    """Paginated project-wide JQL search via /rest/api/3/search/jql — the v3
    replacement for the deprecated /rest/api/3/search, cursor-paginated via
    nextPageToken (no `total`, hence looping on `isLast` instead).
    """
    issues = []
    next_token = None
    while True:
        params = {"jql": jql, "fields": fields, "maxResults": max_results}
        if next_token:
            params["nextPageToken"] = next_token
        data = await get("/rest/api/3/search/jql", params)
        issues.extend(data.get("issues", []))
        if data.get("isLast", True):
            break
        next_token = data.get("nextPageToken")
        if not next_token:
            break
    return issues


async def epic_issues(epic_key: str, fields: str = "status") -> list:
    """Every issue under one epic. Jira's v3 API exposes the epic link as the
    issue's `parent`, the same field api/project.py reads back as epic_key.
    """
    return await search_issues(f"parent = {epic_key}", fields)


async def assignable_users(project_key: str = PROJECT_KEY) -> list:
    data = await get("/rest/api/3/user/assignable/search", {"project": project_key, "maxResults": 50})
    return data


async def issue_status_changelogs(issue_keys: list) -> dict:
    """{issue_key: [(changed_at_iso, new_status_name), ...]} for every real status
    transition on each issue, from Jira's own changelog — not a snapshot, the
    actual history. One shared client so N issues cost one connection, not N.
    """
    async with httpx.AsyncClient(base_url=f"https://{SITE}", timeout=30) as client:
        headers = {"Authorization": _AUTH_HEADER, "Accept": "application/json"}

        async def one(key: str):
            resp = await client.get(
                f"/rest/api/3/issue/{key}",
                params={"expand": "changelog", "fields": "status"},
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
            transitions = [
                (history["created"], item["toString"])
                for history in data["changelog"]["histories"]
                for item in history["items"]
                if item["field"] == "status"
            ]
            return key, transitions

        results = await asyncio.gather(*[one(k) for k in issue_keys])
        return dict(results)


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
