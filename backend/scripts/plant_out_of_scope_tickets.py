"""One-off script: plant 3 test tickets on KPD for the Scope Guardian demo.

Per TASK_wire_mock_client.md Step 3 — KPD is being treated as the mock
client board (Arclight Systems / "Continuity", per sow_mock_client.md).
Creates exactly 3 new backlog issues (no epic, priority Medium) and adds a
comment on each explaining why it exists. Does not touch any existing issue.

Not part of the app - run once, by hand, from backend/:
    .venv/bin/python scripts/plant_out_of_scope_tickets.py
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
PROJECT_KEY = "KPD"

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
        print(f"  !! {method} {path} -> HTTP {e.code}: {e.read().decode()[:500]}")
        raise


def adf_paragraph(text: str) -> dict:
    return {
        "type": "doc",
        "version": 1,
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


TICKETS = [
    {
        "summary": "Add automatic credential rotation when Secrets Scanning finds a leaked key",
        "comment": (
            "Test ticket for Scope Guardian demo — expected classification: OUT OF SCOPE. "
            "D7 (Secrets Scanning & Canary Tokens) explicitly excludes 'automatically "
            "rotating, revoking, or remediating a discovered secret' — this asks for exactly that."
        ),
    },
    {
        "summary": "Add Stripe billing and per-seat subscription management to Continuity",
        "comment": (
            "Test ticket for Scope Guardian demo — expected classification: OUT OF SCOPE. "
            "Billing/subscription management isn't part of any of the 8 contracted "
            "deliverables (D1-D8) — unrelated to an engineering knowledge/handover platform."
        ),
    },
    {
        "summary": "Let Continuity's Q&A assistant auto-answer questions posted in engineering Slack channels",
        "comment": (
            "Test ticket for Scope Guardian demo — expected classification: AMBIGUOUS. "
            "D3 (Hybrid Search & Cited Q&A) covers a 'text-based Q&A surface' but doesn't "
            "say whether that includes a new channel integration like Slack, or is scoped to "
            "Continuity's own UI only — a stretch, not a clean fit either way."
        ),
    },
]


def main():
    created = []
    for t in TICKETS:
        print(f"Creating: {t['summary']}")
        result = call(
            "POST",
            "/rest/api/3/issue",
            {
                "fields": {
                    "project": {"key": PROJECT_KEY},
                    "summary": t["summary"],
                    "issuetype": {"name": "Task"},
                    "priority": {"name": "Medium"},
                }
            },
        )
        key = result["key"]
        print(f"  -> {key}")

        call(
            "POST",
            f"/rest/api/3/issue/{key}/comment",
            {"body": adf_paragraph(t["comment"])},
        )
        print(f"  -> comment added")

        created.append({"key": key, "summary": t["summary"]})

    print()
    print("Created:")
    for c in created:
        print(f"  {c['key']}  {c['summary']}")


if __name__ == "__main__":
    main()
