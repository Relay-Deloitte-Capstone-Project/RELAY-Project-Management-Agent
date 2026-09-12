"""Thin async Jira Cloud client shared by api/analytics.py.

Uses the same three JIRA_* env vars as scripts/jira_sprint_setup.py (root
.env — loaded by backend/main.py). Talks to the Agile API (v1.0) for board/
sprint/issue data; search/jql (v3) is deprecated, so nothing here uses it.
"""

from __future__ import annotations

import asyncio
import base64
import os

import httpx

SITE = os.environ.get("JIRA_SITE", "")
EMAIL = os.environ.get("JIRA_EMAIL", "")
TOKEN = os.environ.get("JIRA_API_TOKEN", "")
BOARD_ID = int(os.environ.get("JIRA_BOARD_ID", "34"))
PROJECT_KEY = os.environ.get("JIRA_PROJECT_KEY", "KPD")

_AUTH_HEADER = "Basic " + base64.b64encode(f"{EMAIL}:{TOKEN}".encode()).decode()


def configured() -> bool:
    return bool(SITE and EMAIL and TOKEN)


async def get(path: str, params: dict | None = None):
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
        issues.extend(data.get("issues", []))
        start_at += len(data.get("issues", []))
        if start_at >= data.get("total", 0) or not data.get("issues"):
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
