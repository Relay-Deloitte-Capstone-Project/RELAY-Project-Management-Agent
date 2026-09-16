import os
import requests
from dotenv import load_dotenv

load_dotenv()
base = os.environ["JIRA_BASE_URL"].rstrip("/")
auth = (os.environ["JIRA_EMAIL"], os.environ["JIRA_API_TOKEN"])

r = requests.post(
    f"{base}/rest/api/3/search/jql",
    auth=auth,
    json={"jql": "project=KPD AND issuetype=Epic", "maxResults": 10, "fields": ["summary", "key"]},
)
r.raise_for_status()
epics = r.json()["issues"]
print(f"Found {len(epics)} Epics:")
for e in epics:
    print(f"  {e['key']}: {e['fields']['summary']}")

if epics:
    test_epic = epics[0]["key"]
    r2 = requests.post(
        f"{base}/rest/api/3/search/jql",
        auth=auth,
        json={"jql": f"project=KPD AND parent={test_epic}", "maxResults": 5, "fields": ["summary"]},
    )
    r2.raise_for_status()
    linked = r2.json()["issues"]
    print(f"\nTickets linked to {test_epic} via 'parent' field: {len(linked)}")
    for t in linked:
        print(f"  {t['key']}: {t['fields']['summary']}")