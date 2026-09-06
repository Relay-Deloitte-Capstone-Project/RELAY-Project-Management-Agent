import os
import json
import glob
from dotenv import load_dotenv

load_dotenv()


def try_groq(prompt):
    from groq import Groq
    try:
        client = Groq(api_key=os.environ["GROQ_API_KEY"])
        r = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[{"role": "user", "content": prompt}],
            timeout=15,
        )
        return "groq", r.choices[0].message.content
    except Exception as e:
        print(f"  Groq failed: {e}")
        return None, None


def generate(prompt):
    print("Trying Groq...")
    tier, answer = try_groq(prompt)
    if tier:
        print("  answered by Groq")
        return tier, answer
    return "none", "Groq failed — check your GROQ_API_KEY in .env"


def load_tickets():
    tickets = []
    for filepath in glob.glob("corpus/*.json"):
        if "commits" in filepath:
            continue
        with open(filepath) as f:
            data = json.load(f)
        for t in data:
            if "fields" in t:
                f = t["fields"]
                tickets.append({
                    "id": t["key"],
                    "summary": f.get("summary", ""),
                    "status": f["status"]["name"] if f.get("status") else "",
                    "assignee": (f.get("assignee") or {}).get("displayName", "Unassigned"),
                })
            else:
                tickets.append({
                    "id": t.get("ticket_id", ""),
                    "summary": t.get("summary", ""),
                    "status": t.get("status", ""),
                    "assignee": t.get("assignee", "Unassigned"),
                })
    return tickets


def build_prompt(tickets):
    lines = [f"- {t['id']}: {t['summary']} (status: {t['status']}, assignee: {t['assignee']})" for t in tickets]
    ticket_list = "\n".join(lines)
    return (
        "Here is a list of Jira tickets from a software project:\n\n"
        f"{ticket_list}\n\n"
        "Write a short, plain-English summary (3-5 sentences) of what this team is currently "
        "working on, grouped by theme if there's a pattern. Mention who is working on what."
    )


if __name__ == "__main__":
    tickets = load_tickets()
    if not tickets:
        print("No tickets found in corpus/. Run fetch_jira_authenticated.py first.")
        exit()

    print(f"Loaded {len(tickets)} tickets. Generating summary...\n")
    prompt = build_prompt(tickets)
    tier, summary = generate(prompt)

    print(f"\n--- Summary (via {tier}) ---")
    print(summary)
