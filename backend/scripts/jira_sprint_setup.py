"""One-off script: restructure KPD board into 8 per-epic sprints, reflecting
real ticket completion state (checked live against Jira before writing this).

Not part of the app — run once, by hand, from backend/:
    .venv/bin/python scripts/jira_sprint_setup.py
"""

from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).parent.parent.parent / ".env")

SITE = os.environ["JIRA_SITE"]
EMAIL = os.environ["JIRA_EMAIL"]
TOKEN = os.environ["JIRA_API_TOKEN"]
BOARD_ID = 34
EXISTING_SPRINT_ID = 1  # "KPD Sprint 1" — reused as the first completed sprint

AUTH = base64.b64encode(f"{EMAIL}:{TOKEN}".encode()).decode()


def call(method: str, path: str, body: dict | None = None) -> dict:
    url = f"https://{SITE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Basic {AUTH}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        print(f"  !! {method} {path} -> HTTP {e.code}: {e.read().decode()[:300]}")
        raise


def epic_issue_keys(epic_key: str) -> list:
    keys = []
    d = call(
        "GET",
        "/rest/api/3/search/jql?"
        f"jql=project%3DKPD+AND+%22Epic+Link%22%3D{epic_key}&fields=key&maxResults=100",
    )
    keys.extend(i["key"] for i in d["issues"])
    return keys


def move_issues(sprint_id: int, keys: list):
    for i in range(0, len(keys), 50):
        call("POST", f"/rest/agile/1.0/sprint/{sprint_id}/issue", {"issues": keys[i : i + 50]})


def create_sprint(name: str) -> int:
    d = call("POST", "/rest/agile/1.0/sprint", {"name": name, "originBoardId": BOARD_ID})
    return d["id"]


def set_sprint(sprint_id: int, name: str, state: str, start: str = None, end: str = None):
    body = {"name": name, "state": state}
    if start:
        body["startDate"] = start
    if end:
        body["endDate"] = end
    call("PUT", f"/rest/agile/1.0/sprint/{sprint_id}", body)


PLAN = [
    # (epic_key, sprint_name, target_state, start_iso, end_iso, reuse_sprint_id)
    # Names capped at 30 chars — Jira's sprint-name limit.
    ("KPD-2", "Sprint 1 — Linkage", "closed",
     "2026-09-05T09:00:00.000Z", "2026-09-05T21:00:00.000Z", EXISTING_SPRINT_ID),
    ("KPD-6", "Sprint 2 — Provenance", "closed",
     "2026-09-06T09:00:00.000Z", "2026-09-06T21:00:00.000Z", None),
    ("KPD-4", "Sprint 3 — Handover", "closed",
     "2026-09-07T09:00:00.000Z", "2026-09-07T21:00:00.000Z", None),
    ("KPD-3", "Sprint 4 — Retrieval", "active",
     "2026-09-09T09:00:00.000Z", "2026-09-21T09:00:00.000Z", None),
    ("KPD-1", "Sprint 5 — Ingestion", "future",
     "2026-09-21T09:00:00.000Z", "2026-10-03T09:00:00.000Z", None),
    ("KPD-7", "Sprint 6 — Secrets", "future",
     "2026-10-03T09:00:00.000Z", "2026-10-15T09:00:00.000Z", None),
    ("KPD-5", "Sprint 7 — Scope Guardian", "future",
     "2026-10-15T09:00:00.000Z", "2026-10-27T09:00:00.000Z", None),
    ("KPD-8", "Sprint 8 — Auto-draft", "future",
     "2026-10-27T09:00:00.000Z", "2026-11-08T09:00:00.000Z", None),
]


def main():
    for epic_key, name, state, start, end, reuse_id in PLAN:
        print(f"\n== {epic_key}: {name} ({state}) ==")
        keys = epic_issue_keys(epic_key)
        print(f"   {len(keys)} issues")

        sprint_id = reuse_id if reuse_id else create_sprint(name)
        print(f"   sprint id {sprint_id}")

        # Populate before transitioning state — issues can be added to a
        # future sprint; adding after closing a sprint is more error-prone.
        move_issues(sprint_id, keys)
        print(f"   moved {len(keys)} issues")

        if state == "closed":
            set_sprint(sprint_id, name, "active", start, end)
            set_sprint(sprint_id, name, "closed", start, end)
        elif state == "active":
            set_sprint(sprint_id, name, "active", start, end)
        else:
            set_sprint(sprint_id, name, "future", start, end)
        print(f"   state -> {state}")

    print("\nDone.")


if __name__ == "__main__":
    main()
