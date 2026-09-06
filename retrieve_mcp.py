import json

with open("corpus/kpd_mcp_tickets.json") as f:
    data = json.load(f)

tickets = data["issues"]
print(f"Loaded {len(tickets)} tickets (fetched via MCP).\n")

keyword = input("Type a word to search for: ").lower()

print(f"\n--- Tickets matching '{keyword}' ---")
found = 0
for t in tickets:
    summary = t.get("summary", "")
    description = t.get("description", "") or ""
    searchable = (summary + " " + description).lower()
    if keyword in searchable:
        assignee = (t.get("assignee") or {}).get("display_name", "Unassigned")
        print(f"\n{t['key']}: {summary}")
        print(f"  Description: {description[:150]}")
        print(f"  Assignee: {assignee}")
        print(f"  Status: {t['status']['name']}")
        print(f"  URL: {t['browse_url']}")
        found += 1

print(f"\n{found} match(es) found out of {len(tickets)} tickets.")
