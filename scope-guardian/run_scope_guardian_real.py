import os
import json
import requests
import psycopg2
from pathlib import Path
from dotenv import load_dotenv
from groq import Groq

# Load the REAL Relay project environment
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BASE = os.environ["JIRA_BASE_URL"].rstrip("/")
AUTH = (os.environ["JIRA_EMAIL"], os.environ["JIRA_API_TOKEN"])
DB_URL = os.environ["DATABASE_URL"]
GROQ_KEY = os.environ["GROQ_API_KEY"]

client = Groq(api_key=GROQ_KEY)

# SOW source: project-approved SOW definition.
# The database stores Scope Guardian results, while the signed SOW
# definition is maintained as the structured source used for classification.
SOW_PATH = Path(__file__).with_name("sow_source.json")
SOW = json.loads(SOW_PATH.read_text())

# New SOW mapping: D1 -> KPD-1 ... D8 -> KPD-8
DELIVERABLES = {}
EPIC_TO_DELIVERABLE = {}

for d in SOW["deliverables"]:
    key = d["id"]
    DELIVERABLES[key] = d
    EPIC_TO_DELIVERABLE[d["epic_key"]] = key


def jira_text(value):
    if not value:
        return ""

    if isinstance(value, str):
        return value

    if isinstance(value, dict):
        parts = []

        def walk(x):
            if isinstance(x, dict):
                if x.get("type") == "text" and x.get("text"):
                    parts.append(x["text"])
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)

        walk(value)
        return " ".join(parts)

    return str(value)


def fetch_epic_tickets(epic_key):
    response = requests.post(
        f"{BASE}/rest/api/3/search/jql",
        auth=AUTH,
        json={
            "jql": f"project=KPD AND parent={epic_key} ORDER BY key",
            "maxResults": 100,
            "fields": ["summary", "description"],
        },
        timeout=30,
    )

    response.raise_for_status()
    return response.json().get("issues", [])


def classify_batch(epic_key, deliverable, tickets):
    rules = f"""
SOW DELIVERABLE:
ID: {deliverable['id']}
NAME: {deliverable['name']}

DESCRIPTION:
{deliverable.get('description', '')}

ACCEPTANCE CRITERIA:
{deliverable.get('acceptance', '')}

EXCLUDES:
{json.dumps(deliverable.get('excludes', []))}
"""

    all_results = []
    batch_size = 8
    total_batches = (len(tickets) + batch_size - 1) // batch_size

    for batch_no in range(total_batches):
        batch = tickets[
            batch_no * batch_size:
            (batch_no + 1) * batch_size
        ]

        print(
            f"  AI batch {batch_no + 1}/{total_batches} "
            f"({len(batch)} tickets)..."
        )

        ticket_text = []

        for issue in batch:
            fields = issue.get("fields", {})
            ticket_text.append({
                "ticket_id": issue["key"],
                "summary": fields.get("summary", ""),
                "description": jira_text(
                    fields.get("description", "")
                ),
            })

        prompt = f"""
You are Scope Guardian for a software delivery project.

Classify EACH Jira ticket against the supplied SOW deliverable.

{rules}

TICKETS:
{json.dumps(ticket_text, ensure_ascii=False)}

Return ONLY valid JSON in exactly this format:

{{
  "classifications": [
    {{
      "ticket_id": "KPD-123",
      "status": "in_scope",
      "clause": "relevant SOW requirement",
      "reason": "short explanation"
    }}
  ]
}}

Rules:
- Every supplied ticket MUST appear exactly once.
- status MUST be exactly one of:
  "in_scope", "out_of_scope", "ambiguous"
- Use "in_scope" when the ticket directly implements or supports the
  deliverable description or acceptance criteria.
- Use "out_of_scope" when it clearly belongs to another area or violates
  an explicit exclusion.
- Use "ambiguous" only when the relationship cannot be determined.
- Do not invent SOW requirements.
"""

        try:
            response = client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a strict JSON classification engine. "
                            "Return valid JSON only."
                        ),
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    },
                ],
                temperature=0,
                max_tokens=1800,
                response_format={"type": "json_object"},
            )

            raw = response.choices[0].message.content.strip()
            data = json.loads(raw)

            results = data.get("classifications", [])

            valid_ids = {x["key"] for x in batch}

            for result in results:
                ticket_id = result.get("ticket_id")

                if ticket_id not in valid_ids:
                    continue

                status = result.get("status", "ambiguous")

                if status not in {
                    "in_scope",
                    "out_of_scope",
                    "ambiguous",
                }:
                    status = "ambiguous"

                all_results.append({
                    "ticket_id": ticket_id,
                    "status": status,
                    "clause": result.get("clause"),
                    "reason": result.get(
                        "reason",
                        "AI classification completed."
                    ),
                })

            # Ensure no ticket disappears if AI omitted one.
            returned_ids = {
                x["ticket_id"]
                for x in all_results
            }

            for issue in batch:
                if issue["key"] not in returned_ids:
                    all_results.append({
                        "ticket_id": issue["key"],
                        "status": "ambiguous",
                        "clause": None,
                        "reason": "AI did not return a classification.",
                    })

        except Exception as e:
            print(
                f"  WARNING: AI batch failed for {epic_key}: {e}"
            )

            for issue in batch:
                all_results.append({
                    "ticket_id": issue["key"],
                    "status": "ambiguous",
                    "clause": None,
                    "reason": "AI classification unavailable.",
                })

    return all_results

def main():
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    print("Connected to REAL database:", DB_URL.split("@")[-1])
    print()

    # Store every ticket classification, not only alerts.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sow_ticket_classifications (
            ticket_id TEXT PRIMARY KEY,
            ticket_summary TEXT,
            epic_key TEXT NOT NULL,
            deliverable_key TEXT NOT NULL,
            status TEXT NOT NULL,
            clause TEXT,
            reason TEXT,
            computed_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)

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

    # Rebuild Scope Guardian results from REAL Jira.
    cur.execute("DELETE FROM sow_ticket_classifications")
    cur.execute("DELETE FROM sow_scope_alerts")
    cur.execute("DELETE FROM sow_deliverable_compliance")
    conn.commit()

    for epic_key in [f"KPD-{i}" for i in range(1, 9)]:
        deliverable_key = EPIC_TO_DELIVERABLE.get(epic_key)

        if not deliverable_key:
            print("Skipping", epic_key, "- no SOW mapping")
            continue

        deliverable = DELIVERABLES[deliverable_key]

        print(f"Fetching {epic_key} -> {deliverable_key}...")
        tickets = fetch_epic_tickets(epic_key)

        print(f"  Found {len(tickets)} real Jira child tickets")
        print(f"  Sending ONE batch classification request...")

        classifications = classify_batch(
            epic_key,
            deliverable,
            tickets,
        )

        by_id = {x["ticket_id"]: x for x in classifications}

        in_scope = 0

        for issue in tickets:
            ticket_id = issue["key"]
            summary = issue["fields"].get("summary", "")
            c = by_id.get(ticket_id)

            if not c:
                c = {
                    "ticket_id": ticket_id,
                    "status": "ambiguous",
                    "clause": None,
                    "reason": "No classification returned",
                }

            status = c.get("status", "ambiguous")

            if status == "in_scope":
                in_scope += 1

            cur.execute("""
                INSERT INTO sow_ticket_classifications
                (ticket_id, ticket_summary, epic_key, deliverable_key,
                 status, clause, reason)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
            """, (
                ticket_id,
                summary,
                epic_key,
                deliverable_key,
                status,
                c.get("clause"),
                c.get("reason"),
            ))

            if status in ("out_of_scope", "ambiguous"):
                cur.execute("""
                    INSERT INTO sow_scope_alerts
                    (ticket_id, ticket_summary, deliverable_key,
                     status, clause, reason)
                    VALUES (%s,%s,%s,%s,%s,%s)
                """, (
                    ticket_id,
                    summary,
                    deliverable_key,
                    status,
                    c.get("clause"),
                    c.get("reason"),
                ))

        total = len(tickets)
        compliance = round((in_scope / total) * 100, 2) if total else 100

        cur.execute("""
            INSERT INTO sow_deliverable_compliance
            (deliverable_key, deliverable_title, total_tickets,
             in_scope_count, compliance_percent)
            VALUES (%s,%s,%s,%s,%s)
        """, (
            deliverable_key,
            deliverable["name"],
            total,
            in_scope,
            compliance,
        ))

        conn.commit()

        print(
            f"  DONE: {in_scope}/{total} in scope = {compliance}%"
        )
        print()

    cur.close()
    conn.close()

    print("======================================")
    print("SCOPE GUARDIAN COMPLETE")
    print("Real Jira -> Real PostgreSQL")
    print("======================================")


if __name__ == "__main__":
    main()
