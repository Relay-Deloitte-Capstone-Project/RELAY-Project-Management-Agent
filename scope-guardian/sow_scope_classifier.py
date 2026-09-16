import os
import json
import requests
import psycopg2
from dotenv import load_dotenv
from groq import Groq

from mock_sow import SOW_DELIVERABLES, EPIC_TO_DELIVERABLE

load_dotenv()

base = os.environ["JIRA_BASE_URL"].rstrip("/")
auth = (os.environ["JIRA_EMAIL"], os.environ["JIRA_API_TOKEN"])
groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])


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


def fetch_tickets_for_epic(epic_key):
    r = requests.post(
        f"{base}/rest/api/3/search/jql",
        auth=auth,
        json={"jql": f"project=KPD AND parent={epic_key}", "maxResults": 100,
              "fields": ["summary", "description"]},
    )
    r.raise_for_status()
    return r.json()["issues"]


def classify_ticket(ticket_summary, ticket_description, deliverable_key):
    deliverable = SOW_DELIVERABLES[deliverable_key]
    clauses_text = "\n".join(f"{k}: {v}" for k, v in deliverable["clauses"].items())

    prompt = (
        f"You are checking a work ticket against a signed contract's scope clauses.\n\n"
        f"Deliverable: {deliverable['title']}\n"
        f"Clauses:\n{clauses_text}\n\n"
        f"Ticket: {ticket_summary}\n"
        f"Details: {ticket_description[:500]}\n\n"
        f"Does this ticket stay within scope, go outside scope, or is it ambiguous?\n"
        f"Respond with EXACTLY this JSON format, nothing else:\n"
        f'{{"status": "in_scope" or "out_of_scope" or "ambiguous", '
        f'"clause": "the clause ID if violated or relevant, else null", '
        f'"reason": "one sentence explaining why"}}'
    )

    response = groq_client.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.choices[0].message.content.strip()
    raw = raw.replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"status": "ambiguous", "clause": None, "reason": "Could not parse classification"}


if __name__ == "__main__":
    conn = psycopg2.connect("dbname=project_db")
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sow_scope_alerts (
            id SERIAL PRIMARY KEY,
            ticket_id TEXT NOT NULL,
            ticket_summary TEXT,
            deliverable_key TEXT,
            status TEXT,
            clause TEXT,
            reason TEXT,
            computed_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sow_deliverable_compliance (
            deliverable_key TEXT PRIMARY KEY,
            deliverable_title TEXT,
            total_tickets INT,
            in_scope_count INT,
            compliance_percent NUMERIC,
            computed_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)
    conn.commit()

    deliverable_totals = {d: {"total": 0, "in_scope": 0} for d in SOW_DELIVERABLES}

    for epic_key, deliverable_key in EPIC_TO_DELIVERABLE.items():
        tickets = fetch_tickets_for_epic(epic_key)
        print(f"\n{epic_key} -> {deliverable_key} ({len(tickets)} tickets)")

        for t in tickets:
            summary = t["fields"].get("summary", "")
            description = extract_plain_text(t["fields"].get("description"))

            result = classify_ticket(summary, description, deliverable_key)
            status = result.get("status", "ambiguous")
            clause = result.get("clause")
            reason = result.get("reason", "")

            deliverable_totals[deliverable_key]["total"] += 1
            if status == "in_scope":
                deliverable_totals[deliverable_key]["in_scope"] += 1

            print(f"  {t['key']}: {status.upper()}" + (f" ({clause})" if clause else ""))

            if status in ("out_of_scope", "ambiguous"):
                cur.execute(
                    """
                    INSERT INTO sow_scope_alerts
                        (ticket_id, ticket_summary, deliverable_key, status, clause, reason)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (t["key"], summary, deliverable_key, status, clause, reason),
                )

    conn.commit()

    print("\n--- Deliverable Scope Compliance ---")
    for d_key, totals in deliverable_totals.items():
        total = totals["total"]
        in_scope = totals["in_scope"]
        pct = round((in_scope / total * 100), 1) if total > 0 else 0
        title = SOW_DELIVERABLES[d_key]["title"]

        cur.execute(
            """
            INSERT INTO sow_deliverable_compliance
                (deliverable_key, deliverable_title, total_tickets, in_scope_count, compliance_percent)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (deliverable_key) DO UPDATE SET
                total_tickets = EXCLUDED.total_tickets,
                in_scope_count = EXCLUDED.in_scope_count,
                compliance_percent = EXCLUDED.compliance_percent,
                computed_at = NOW();
            """,
            (d_key, title, total, in_scope, pct),
        )
        print(f"{d_key} {title}: {pct}% ({in_scope}/{total} tickets in scope)")

    conn.commit()
    cur.close()
    conn.close()
