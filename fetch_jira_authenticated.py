import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

BASE = os.environ["JIRA_BASE_URL"].rstrip("/")
AUTH = (os.environ["JIRA_EMAIL"], os.environ["JIRA_API_TOKEN"])


def whoami():
    r = requests.get(f"{BASE}/rest/api/2/myself", auth=AUTH, timeout=10)
    r.raise_for_status()
    me = r.json()
    print(f"Connected as: {me['displayName']} ({me['emailAddress']})")
    return me


def fetch_project_tickets(project_key, max_results=50):
    r = requests.post(
        f"{BASE}/rest/api/3/search/jql",
        auth=AUTH,
        json={
            "jql": f"project={project_key}",
            "maxResults": max_results,
            "fields": ["summary", "status", "assignee", "created", "description"],
        },
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["issues"]


if __name__ == "__main__":
    whoami()
    project_key = input("Project key to fetch (e.g. KAN): ").strip()
    tickets = fetch_project_tickets(project_key)
    print(f"Fetched {len(tickets)} tickets from {project_key}")

    for t in tickets:
        f = t["fields"]
        assignee = (f.get("assignee") or {}).get("displayName", "Unassigned")
        print(f"  {t['key']}: {f['summary']}  ->  {assignee}")

    os.makedirs("corpus", exist_ok=True)
    with open(f"corpus/{project_key.lower()}_tickets.json", "w") as f:
        json.dump(tickets, f, indent=2)
    print(f"Saved to corpus/{project_key.lower()}_tickets.json")
