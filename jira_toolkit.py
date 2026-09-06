"""
Jira Toolkit — all-in-one script.
Combines: fetching (public + authenticated + MCP), retrieval, and LLM summarization.

Run: python3 jira_toolkit.py
Then pick an option from the menu.
"""

import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()


# ============================================================
# SECTION 1: FETCH — public Apache Jira (no auth)
# ============================================================
def fetch_public_jira(project="KAFKA", max_results=50):
    url = "https://issues.apache.org/jira/rest/api/2/search"
    params = {
        "jql": f"project={project} ORDER BY created DESC",
        "maxResults": max_results,
        "fields": "summary,status,assignee,created,description,comment",
    }
    r = requests.get(url, params=params, timeout=15)
    r.raise_for_status()
    issues = r.json()["issues"]

    normalized = []
    for issue in issues:
        f = issue["fields"]
        normalized.append({
            "ticket_id": issue["key"],
            "summary": f.get("summary"),
            "status": f["status"]["name"],
            "assignee": (f.get("assignee") or {}).get("displayName"),
            "description": f.get("description"),
            "source_url": f"https://issues.apache.org/jira/browse/{issue['key']}",
        })

    os.makedirs("corpus", exist_ok=True)
    with open("corpus/public_jira_tickets.json", "w") as f:
        json.dump(normalized, f, indent=2)
    print(f"Fetched {len(normalized)} tickets -> corpus/public_jira_tickets.json")


# ============================================================
# SECTION 2: FETCH — your own authenticated Jira site
# ============================================================
def fetch_authenticated_jira(project_key):
    base = os.environ["JIRA_BASE_URL"].rstrip("/")
    auth = (os.environ["JIRA_EMAIL"], os.environ["JIRA_API_TOKEN"])

    r = requests.get(f"{base}/rest/api/2/myself", auth=auth, timeout=10)
    r.raise_for_status()
    print(f"Connected as: {r.json()['displayName']}")

    r = requests.post(
        f"{base}/rest/api/3/search/jql",
        auth=auth,
        json={
            "jql": f"project={project_key}",
            "maxResults": 50,
            "fields": ["summary", "status", "assignee", "description"],
        },
        timeout=15,
    )
    r.raise_for_status()
    issues = r.json()["issues"]

    for t in issues:
        f = t["fields"]
        assignee = (f.get("assignee") or {}).get("displayName", "Unassigned")
        print(f"  {t['key']}: {f['summary']} -> {assignee}")

    os.makedirs("corpus", exist_ok=True)
    outfile = f"corpus/{project_key.lower()}_tickets.json"
    with open(outfile, "w") as f:
        json.dump(issues, f, indent=2)
    print(f"Saved to {outfile}")


# ============================================================
# SECTION 3: FETCH — via MCP server (mcp-atlassian)
# ============================================================
async def _mcp_fetch(project_key):
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    server_params = StdioServerParameters(
        command="uvx",
        args=["mcp-atlassian"],
        env={
            **os.environ,
            "JIRA_URL": os.environ["JIRA_BASE_URL"],
            "JIRA_USERNAME": os.environ["JIRA_EMAIL"],
            "JIRA_API_TOKEN": os.environ["JIRA_API_TOKEN"],
        },
    )
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(
                "jira_search",
                arguments={"jql": f"project={project_key} ORDER BY created DESC", "limit": 50},
            )
            parsed = json.loads(result.content[0].text)
            os.makedirs("corpus", exist_ok=True)
            outfile = f"corpus/{project_key.lower()}_mcp_tickets.json"
            with open(outfile, "w") as f:
                json.dump(parsed, f, indent=2)
            print(f"Saved {len(parsed['issues'])} tickets to {outfile}")


def fetch_via_mcp(project_key):
    import asyncio
    asyncio.run(_mcp_fetch(project_key))


# ============================================================
# SECTION 4: RETRIEVE — keyword search over any fetched file
# ============================================================
def retrieve(filepath, keyword):
    with open(filepath) as f:
        data = json.load(f)

    tickets = data["issues"] if isinstance(data, dict) and "issues" in data else data
    keyword = keyword.lower()
    found = 0

    for t in tickets:
        if "fields" in t:
            f = t["fields"]
            key, summary = t["key"], f.get("summary", "")
            description = f.get("description") or ""
            if isinstance(description, dict):
                description = json.dumps(description)
        else:
            key, summary = t.get("key", t.get("ticket_id", "")), t.get("summary", "")
            description = t.get("description", "") or ""

        if keyword in (summary + " " + str(description)).lower():
            print(f"\n{key}: {summary}")
            found += 1

    print(f"\n{found} match(es) found.")


# ============================================================
# SECTION 5: SUMMARIZE — via Groq
# ============================================================
def summarize(filepath):
    from groq import Groq

    with open(filepath) as f:
        data = json.load(f)
    tickets = data["issues"] if isinstance(data, dict) and "issues" in data else data

    lines = []
    for t in tickets[:20]:
        if "fields" in t:
            lines.append(f"- {t['key']}: {t['fields'].get('summary', '')}")
        else:
            lines.append(f"- {t.get('ticket_id', '')}: {t.get('summary', '')}")

    prompt = (
        "Here are Jira tickets:\n\n" + "\n".join(lines) +
        "\n\nWrite a short summary (4-6 sentences) of what this team is working on."
    )

    client = Groq(api_key=os.environ["GROQ_API_KEY"])
    r = client.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[{"role": "user", "content": prompt}],
    )
    print("\n--- Summary ---")
    print(r.choices[0].message.content)


# ============================================================
# MENU
# ============================================================
if __name__ == "__main__":
    print("Jira Toolkit")
    print("1. Fetch public Apache Kafka tickets")
    print("2. Fetch from your own authenticated Jira")
    print("3. Fetch via MCP server")
    print("4. Retrieve/search a fetched file")
    print("5. Summarize a fetched file with an LLM")

    choice = input("\nChoose an option (1-5): ").strip()

    if choice == "1":
        fetch_public_jira()
    elif choice == "2":
        key = input("Project key (e.g. KAN, KPD): ").strip()
        fetch_authenticated_jira(key)
    elif choice == "3":
        key = input("Project key (e.g. KPD): ").strip()
        fetch_via_mcp(key)
    elif choice == "4":
        path = input("File path (e.g. corpus/kpd_tickets.json): ").strip()
        kw = input("Keyword to search: ").strip()
        retrieve(path, kw)
    elif choice == "5":
        path = input("File path (e.g. corpus/kpd_tickets.json): ").strip()
        summarize(path)
    else:
        print("Invalid choice.")