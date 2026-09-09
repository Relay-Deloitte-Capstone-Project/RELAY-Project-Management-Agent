"""Thin async Jira Cloud client shared by api/analytics.py.

Uses the same three JIRA_* env vars as scripts/jira_sprint_setup.py (root
.env — loaded by backend/main.py). Talks to the Agile API (v1.0) for board/
sprint/issue data; search/jql (v3) is deprecated, so nothing here uses it.
"""

from __future__ import annotations

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

_AUTH_HEADER = "Basic " + base64.b64encode(f"{EMAIL}:{TOKEN}".encode()).decode()


def configured() -> bool:
    return bool(SITE and EMAIL and TOKEN)


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
        issues.extend(data.get("issues", []))
        start_at += len(data.get("issues", []))
        if start_at >= data.get("total", 0) or not data.get("issues"):
            break
    return issues
