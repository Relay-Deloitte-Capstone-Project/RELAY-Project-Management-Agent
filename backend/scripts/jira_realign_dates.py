"""One-off script: realign the 4 past/active KPD sprints' start/end dates to
actually bracket when their tickets' real status changes happened.

Why: jira_sprint_setup.py picked arbitrary single-day windows for these
sprints. Checking live changelog data afterward showed every sprint's real
transitions cluster in the same ~24h window (2026-09-05 ~18:00 UTC ->
2026-09-06 ~18:00 UTC) - none of the picked windows actually contained it.
That mismatch is why the dashboard's burndown "actual" line was flat/a
single dot: outside a sprint's window, a real transition doesn't count.

Only touches dates on sprints 1, 35, 36, 37 (closed/closed/closed/active) -
states are unchanged, and futures sprints 38-41 aren't touched (they haven't
started, so there's no real history to align them to yet).

Not part of the app - run once, by hand, from backend/:
    .venv/bin/python scripts/jira_realign_dates.py
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


def set_sprint(sprint_id: int, name: str, state: str, start: str, end: str):
    # PUT needs the full body every time - a partial one (e.g. dates without
    # `name`) errors with "Sprint name is required".
    call(
        "PUT",
        f"/rest/agile/1.0/sprint/{sprint_id}",
        {"name": name, "state": state, "startDate": start, "endDate": end},
    )


PLAN = [
    # (sprint_id, name, state, new_start, new_end)
    (1, "Sprint 1 — Linkage", "closed",
     "2026-08-30T09:00:00.000Z", "2026-09-07T00:00:00.000Z"),
    (35, "Sprint 2 — Provenance", "closed",
     "2026-08-30T09:00:00.000Z", "2026-09-07T00:00:00.000Z"),
    (36, "Sprint 3 — Handover", "closed",
     "2026-08-31T09:00:00.000Z", "2026-09-07T09:00:00.000Z"),
    (37, "Sprint 4 — Retrieval", "active",
     "2026-09-05T12:00:00.000Z", "2026-09-19T12:00:00.000Z"),
]


def main():
    for sprint_id, name, state, start, end in PLAN:
        print(f"\n== sprint {sprint_id} ({name}) -> {start} .. {end} ==")
        if state == "closed":
            # A closed sprint silently ignores date changes sent alongside
            # state="closed" (confirmed: first attempt returned 200 but the
            # dates never actually changed) - has to be reopened, redated,
            # then closed again, same as the original close flow.
            set_sprint(sprint_id, name, "active", start, end)
            set_sprint(sprint_id, name, "closed", start, end)
        else:
            set_sprint(sprint_id, name, state, start, end)
        print("   ok")
    print("\nDone.")


if __name__ == "__main__":
    main()
