import json
import psycopg2
import psycopg2.extras

conn = psycopg2.connect("dbname=project_db")
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

cur.execute("""
    SELECT ticket_id, ticket_summary, deliverable_key, status, clause, reason, computed_at
    FROM sow_scope_alerts
    ORDER BY computed_at DESC
    LIMIT 10;
""")

alerts = cur.fetchall()

formatted_alerts = []
for a in alerts:
    label = "Out of scope" if a["status"] == "out_of_scope" else "Ambiguous"
    citation = f'{a["reason"]}'
    if a["clause"]:
        citation += f' — Clause {a["clause"]}'

    formatted_alerts.append({
        "label": label,
        "ticket_id": a["ticket_id"],
        "title": a["ticket_summary"],
        "citation": citation,
        "deliverable": a["deliverable_key"],
    })

print(json.dumps(formatted_alerts, indent=2, default=str))

cur.close()
conn.close()
