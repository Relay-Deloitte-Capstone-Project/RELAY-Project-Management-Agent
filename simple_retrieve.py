import json

with open("corpus/kpd_tickets.json") as f:
    data = json.load(f)

tickets = []
for t in data:
    f = t["fields"]
    tickets.append({
        "id": t["key"],
        "summary": f.get("summary", ""),
        "assignee": (f.get("assignee") or {}).get("displayName", "Unassigned"),
    })

print(f"Loaded {len(tickets)} tickets.\n")

keyword = input("Type a word to search for (e.g. 'auth', 'embedding', 'webhook', 'provenance'): ").lower()

print(f"\n--- Tickets matching '{keyword}' ---")
found = 0
for t in tickets:
    if keyword in t["summary"].lower():
        print(f"\n{t['id']}: {t['summary']}")
        print(f"  assignee: {t['assignee']}")
        found += 1

print(f"\n{found} match(es) found out of {len(tickets)} tickets.")
