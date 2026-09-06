import json
import psycopg2

conn = psycopg2.connect("dbname=dummy_db")
cur = conn.cursor()

cur.execute("""
    CREATE TABLE IF NOT EXISTS zone1_vault (
        id SERIAL PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        summary TEXT,
        description TEXT,
        assignee TEXT,
        status TEXT
    );
""")

with open("corpus/kpd_tickets.json") as f:
    data = json.load(f)

count = 0
for t in data:
    f = t["fields"]
    cur.execute(
        "INSERT INTO zone1_vault (ticket_id, summary, description, assignee, status) VALUES (%s, %s, %s, %s, %s)",
        (
            t["key"],
            f.get("summary", ""),
            f.get("description") or "",
            (f.get("assignee") or {}).get("displayName", "Unassigned"),
            f["status"]["name"] if f.get("status") else None,
        ),
    )
    count += 1

conn.commit()
print(f"Loaded {count} real KPD tickets into zone1_vault")
cur.close()
conn.close()
