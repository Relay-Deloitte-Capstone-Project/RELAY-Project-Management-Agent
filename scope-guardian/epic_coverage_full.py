import os
import json
import requests
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

from status_and_priority import get_status_and_priority

load_dotenv()

base = os.environ["JIRA_BASE_URL"].rstrip("/")
auth = (os.environ["JIRA_EMAIL"], os.environ["JIRA_API_TOKEN"])

EPIC_TITLES = {
    "KPD-1": "Ingestion pipeline -- Jira + GitHub connectors",
    "KPD-2": "Ticket-to-commit linkage and coverage reporting",
    "KPD-3": "Hybrid retrieval and cited Q&A",
    "KPD-4": "Handover brief and work-state assembly",
    "KPD-5": "Scope Guardian -- SOW parsing and classification",
    "KPD-6": "Provenance and read-time permission evaluation",
    "KPD-7": "Secrets scanning and canary tokens",
    "KPD-8": "Auto-draft from PRs -- assisted capture",
}


def extract_plain_text(description):
    if description is None:
        return ""
    if isinstance(description, str):
        return description
    if isinstance(description, dict):
        texts = []
        def walk(node):
            if isinstance(node, dict):
                if node.get("type") == "text":
                    texts.append(node.get("text", ""))
                for child in node.get("content", []):
                    walk(child)
            elif isinstance(node, list):
                for item in node:
                    walk(item)
        walk(description)
        return " ".join(texts).strip()
    return str(description)


def fetch_linked_tickets(epic_key):
    r = requests.post(
        f"{base}/rest/api/3/search/jql",
        auth=auth,
        json={"jql": f"project=KPD AND parent={epic_key}", "maxResults": 100,
              "fields": ["summary", "description", "status"]},
    )
    r.raise_for_status()
    return r.json()["issues"]


if __name__ == "__main__":
    conn = psycopg2.connect("dbname=project_db")
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    github_links = {}
    try:
        cur.execute("SELECT ticket_id, commit_count, pr_count FROM github_ticket_links;")
        github_links = {row["ticket_id"]: row for row in cur.fetchall()}
    except psycopg2.errors.UndefinedTable:
        conn.rollback()

    scope_data = {}
    try:
        cur.execute("SELECT deliverable_key, compliance_percent FROM sow_deliverable_compliance;")
        scope_data = {row["deliverable_key"]: row["compliance_percent"] for row in cur.fetchall()}
    except psycopg2.errors.UndefinedTable:
        conn.rollback()

    results = []
    for epic_key, title in EPIC_TITLES.items():
        tickets = fetch_linked_tickets(epic_key)
        total = len(tickets)

        done_count = sum(1 for t in tickets if t["fields"]["status"]["name"].lower() == "done")
        documented_count = sum(
            1 for t in tickets if extract_plain_text(t["fields"].get("description")).strip()
        )
        coded_count = sum(1 for t in tickets if t["key"] in github_links)

        completion_pct = round((done_count / total * 100), 1) if total > 0 else 0
        doc_pct = round((documented_count / total * 100), 1) if total > 0 else 0
        code_pct = round((coded_count / total * 100), 1) if total > 0 else 0

        deliverable_map = {"KPD-1": "D1", "KPD-2": "D2", "KPD-3": "D2", "KPD-4": "D2",
                            "KPD-5": "D4", "KPD-6": "D3", "KPD-7": "D3", "KPD-8": "D2"}
        deliverable_key = deliverable_map.get(epic_key)
        scope_pct = float(scope_data.get(deliverable_key, 0)) if deliverable_key else 0

        status_info = get_status_and_priority(scope_pct, doc_pct, completion_pct)

        results.append({
            "epic_key": epic_key,
            "title": title,
            "ticket_count": total,
            "scope_compliance_percent": scope_pct,
            "completion_percent": completion_pct,
            "documentation_percent": doc_pct,
            "implementation_percent": code_pct,
            "status": status_info["status"],
            "priority": status_info["priority"],
            "priority_label": status_info["priority_label"],
            "description": status_info["description"],
        })

    cur.close()
    conn.close()

    # Sort so URGENT items appear first — a manager sees what needs action immediately
    priority_order = {"urgent": 0, "high": 1, "low": 2}
    results.sort(key=lambda r: priority_order[r["priority"]])

    print(json.dumps(results, indent=2))
