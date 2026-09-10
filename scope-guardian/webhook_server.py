"""
Receives Jira webhook events and re-syncs the affected Epic's
documentation score, SOW classification, AND AI summary — all live.

Also exposes GET /generate-summary/{epic_key} for an on-demand button.

Run: uvicorn webhook_server:app --reload --port 8000
"""
import os
import json
import requests
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, Request
from dotenv import load_dotenv
from groq import Groq

from mock_sow import SOW_DELIVERABLES, EPIC_TO_DELIVERABLE

load_dotenv()
app = FastAPI()

base = os.environ["JIRA_BASE_URL"].rstrip("/")
auth = (os.environ["JIRA_EMAIL"], os.environ["JIRA_API_TOKEN"])
groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])

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


def get_mock_doc_count(epic_key):
    return sum(ord(c) for c in epic_key) % 4


def fetch_linked_tickets(epic_key):
    r = requests.post(
        f"{base}/rest/api/3/search/jql",
        auth=auth,
        json={"jql": f"project=KPD AND parent={epic_key}", "maxResults": 100,
              "fields": ["summary", "description", "status"]},
    )
    r.raise_for_status()
    return r.json()["issues"]


def classify_ticket(ticket_summary, ticket_description, deliverable_key):
    deliverable = SOW_DELIVERABLES[deliverable_key]
    clauses_text = "\n".join(f"{k}: {v}" for k, v in deliverable["clauses"].items())
    prompt = (
        f"You are checking a work ticket against a signed contract's scope clauses.\n\n"
        f"Deliverable: {deliverable['title']}\nClauses:\n{clauses_text}\n\n"
        f"Ticket: {ticket_summary}\nDetails: {ticket_description[:500]}\n\n"
        f"Does this ticket stay within scope, go outside scope, or is it ambiguous?\n"
        f"Respond with EXACTLY this JSON format, nothing else:\n"
        f'{{"status": "in_scope" or "out_of_scope" or "ambiguous", '
        f'"clause": "the clause ID if violated or relevant, else null", '
        f'"reason": "one sentence explaining why"}}'
    )
    response = groq_client.chat.completions.create(model="openai/gpt-oss-120b", messages=[{"role": "user", "content": prompt}])
    raw = response.choices[0].message.content.strip().replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"status": "ambiguous", "clause": None, "reason": "Could not parse classification"}


def generate_summary_text(epic_key, epic_title, scope_pct, completion_pct, doc_pct, tickets):
    ticket_lines = [f"- {t['key']}: {t['fields']['summary']} ({t['fields']['status']['name']})" for t in tickets[:15]]
    prompt = (
        f"Write a short (3-4 sentence) plain-English summary of this Epic's current state, "
        f"for a project manager who has 10 seconds to read it.\n\n"
        f"Epic: {epic_title}\nScope compliance: {scope_pct}%\nCompletion: {completion_pct}%\n"
        f"Documentation coverage: {doc_pct}%\n\nTickets:\n" + "\n".join(ticket_lines) + "\n\n"
        f"Be direct and specific. If there's a real risk (high completion but low documentation, "
        f"or low scope compliance), call it out clearly. Don't just restate the numbers."
    )
    response = groq_client.chat.completions.create(model="openai/gpt-oss-120b", messages=[{"role": "user", "content": prompt}])
    return response.choices[0].message.content


def resync_documentation_score(epic_key):
    r = requests.post(f"{base}/rest/api/3/search/jql", auth=auth,
                       json={"jql": f"project=KPD AND key={epic_key}", "maxResults": 1, "fields": ["summary"]})
    r.raise_for_status()
    epic_issues = r.json()["issues"]
    if not epic_issues:
        return None
    epic_summary = epic_issues[0]["fields"]["summary"]

    linked = fetch_linked_tickets(epic_key)
    total = len(linked)
    documented_ids, undocumented_ids = [], []
    for t in linked:
        desc = extract_plain_text(t["fields"].get("description"))
        (documented_ids if desc.strip() else undocumented_ids).append(t["key"])

    doc_ratio = (len(documented_ids) / total) if total > 0 else 0
    mock_docs = get_mock_doc_count(epic_key)
    score = round((doc_ratio * 70) + (min(mock_docs, 3) / 3 * 30), 1)

    conn = psycopg2.connect("dbname=project_db")
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO scope_guardian_scores
            (epic_key, epic_summary, linked_ticket_count, tickets_with_description,
             mock_doc_count, coverage_score, documented_ticket_ids, undocumented_ticket_ids)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (epic_key) DO UPDATE SET
            linked_ticket_count = EXCLUDED.linked_ticket_count,
            tickets_with_description = EXCLUDED.tickets_with_description,
            mock_doc_count = EXCLUDED.mock_doc_count,
            coverage_score = EXCLUDED.coverage_score,
            documented_ticket_ids = EXCLUDED.documented_ticket_ids,
            undocumented_ticket_ids = EXCLUDED.undocumented_ticket_ids,
            computed_at = NOW();
        """,
        (epic_key, epic_summary, total, len(documented_ids), mock_docs, score, documented_ids, undocumented_ids),
    )
    conn.commit()
    cur.close()
    conn.close()
    print(f"  [doc score] {epic_key}: {score}%")
    return score


def resync_sow_classification(epic_key):
    deliverable_key = EPIC_TO_DELIVERABLE.get(epic_key)
    if not deliverable_key:
        return 0

    tickets = fetch_linked_tickets(epic_key)
    conn = psycopg2.connect("dbname=project_db")
    cur = conn.cursor()
    cur.execute("DELETE FROM sow_scope_alerts WHERE deliverable_key = %s;", (deliverable_key,))

    in_scope_count = 0
    for t in tickets:
        summary = t["fields"].get("summary", "")
        description = extract_plain_text(t["fields"].get("description"))
        result = classify_ticket(summary, description, deliverable_key)
        status = result.get("status", "ambiguous")
        if status == "in_scope":
            in_scope_count += 1
        else:
            cur.execute(
                "INSERT INTO sow_scope_alerts (ticket_id, ticket_summary, deliverable_key, status, clause, reason) VALUES (%s, %s, %s, %s, %s, %s)",
                (t["key"], summary, deliverable_key, status, result.get("clause"), result.get("reason", "")),
            )

    total = len(tickets)
    pct = round((in_scope_count / total * 100), 1) if total > 0 else 0
    title = SOW_DELIVERABLES[deliverable_key]["title"]

    cur.execute(
        """
        INSERT INTO sow_deliverable_compliance (deliverable_key, deliverable_title, total_tickets, in_scope_count, compliance_percent)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (deliverable_key) DO UPDATE SET
            total_tickets = EXCLUDED.total_tickets, in_scope_count = EXCLUDED.in_scope_count,
            compliance_percent = EXCLUDED.compliance_percent, computed_at = NOW();
        """,
        (deliverable_key, title, total, in_scope_count, pct),
    )
    conn.commit()
    cur.close()
    conn.close()
    print(f"  [sow] {deliverable_key} ({title}): {pct}% compliant")
    return pct


def resync_ai_summary(epic_key, scope_pct, doc_pct):
    """NEW: regenerates the AI summary using fresh numbers."""
    title = EPIC_TITLES.get(epic_key, epic_key)
    tickets = fetch_linked_tickets(epic_key)
    total = len(tickets)
    done = sum(1 for t in tickets if t["fields"]["status"]["name"].lower() == "done")
    completion_pct = round((done / total * 100), 1) if total > 0 else 0

    summary = generate_summary_text(epic_key, title, scope_pct, completion_pct, doc_pct, tickets)

    conn = psycopg2.connect("dbname=project_db")
    cur = conn.cursor()
    cur.execute("CREATE TABLE IF NOT EXISTS epic_summaries (epic_key TEXT PRIMARY KEY, summary TEXT, generated_at TIMESTAMPTZ DEFAULT NOW());")
    cur.execute(
        "INSERT INTO epic_summaries (epic_key, summary) VALUES (%s, %s) ON CONFLICT (epic_key) DO UPDATE SET summary = EXCLUDED.summary, generated_at = NOW();",
        (epic_key, summary),
    )
    conn.commit()
    cur.close()
    conn.close()
    print(f"  [ai summary] {epic_key}: {summary[:80]}...")
    return summary


def resync_one_epic(epic_key):
    """Runs ALL THREE pipelines for one Epic."""
    doc_score = resync_documentation_score(epic_key) or 0
    scope_pct = resync_sow_classification(epic_key)
    resync_ai_summary(epic_key, scope_pct, doc_score)


@app.post("/webhooks/jira")
async def jira_webhook(request: Request):
    payload = await request.json()
    issue = payload.get("issue", {})
    fields = issue.get("fields", {})
    issue_key = issue.get("key", "unknown")

    print(f"\n[webhook received] {issue_key} was changed")

    issue_type = (fields.get("issuetype") or {}).get("name")
    if issue_type == "Epic":
        resync_one_epic(issue_key)
        return {"status": "ok", "resynced_epic": issue_key}

    parent = fields.get("parent")
    if parent:
        epic_key = parent["key"]
        print(f"  {issue_key} belongs to Epic {epic_key} — resyncing that Epic")
        resync_one_epic(epic_key)
        return {"status": "ok", "resynced_epic": epic_key}

    print(f"  {issue_key} has no parent Epic — nothing to resync")
    return {"status": "ok", "resynced_epic": None}


@app.get("/generate-summary/{epic_key}")
def generate_summary_endpoint(epic_key: str):
    """On-demand endpoint — this is what a 'Generate summary' button would call."""
    conn = psycopg2.connect("dbname=project_db")
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    doc_score = 0
    try:
        cur.execute("SELECT coverage_score FROM scope_guardian_scores WHERE epic_key = %s;", (epic_key,))
        row = cur.fetchone()
        if row:
            doc_score = float(row["coverage_score"])
    except psycopg2.errors.UndefinedTable:
        conn.rollback()

    scope_pct = 0
    deliverable_key = EPIC_TO_DELIVERABLE.get(epic_key)
    if deliverable_key:
        try:
            cur.execute("SELECT compliance_percent FROM sow_deliverable_compliance WHERE deliverable_key = %s;", (deliverable_key,))
            row = cur.fetchone()
            if row:
                scope_pct = float(row["compliance_percent"])
        except psycopg2.errors.UndefinedTable:
            conn.rollback()

    cur.close()
    conn.close()

    summary = resync_ai_summary(epic_key, scope_pct, doc_score)
    return {"epic_key": epic_key, "summary": summary}


@app.get("/")
def health():
    return {"status": "webhook server running"}
