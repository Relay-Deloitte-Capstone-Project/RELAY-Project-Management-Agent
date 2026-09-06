import json

with open("corpus/kpd_tickets.json") as f:
    data = json.load(f)

tickets = []
for t in data:
    f = t["fields"]
    tickets.append({
        "id": t["key"],
        "summary": f.get("summary", ""),
        "description": f.get("description") or "(no description on this ticket)",
        "assignee": (f.get("assignee") or {}).get("displayName", "Unassigned"),
    })

print(f"Loaded {len(tickets)} tickets.\n")

keyword = input("Type a word to search for: ").lower()

print(f"\n--- Tickets matching '{keyword}' ---")
found = 0
for t in tickets:
    searchable = (t["summary"] + " " + str(t["description"])).lower()
    if keyword in searchable:
        print(f"\n{t['id']}: {t['summary']}")
        print(f"  Description: {t['description']}")
        print(f"  Assignee: {t['assignee']}")
        found += 1

print(f"\n{found} match(es) found out of {len(tickets)} tickets.")
