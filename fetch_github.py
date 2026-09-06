import requests
import json
import os
import re

REPO = "apache/kafka"

def fetch_commits(max_results=50):
    url = f"https://api.github.com/repos/{REPO}/commits"
    r = requests.get(url, params={"per_page": max_results}, timeout=15)
    r.raise_for_status()
    return r.json()

def extract_ticket_id(message):
    # Kafka commits often start with "KAFKA-1234: ..."
    match = re.search(r"KAFKA-\d+", message)
    return match.group(0) if match else None

def normalize(commit):
    message = commit["commit"]["message"]
    return {
        "sha": commit["sha"][:10],
        "message": message.split("\n")[0],  # first line only
        "author": commit["commit"]["author"]["name"],
        "date": commit["commit"]["author"]["date"],
        "linked_ticket_id": extract_ticket_id(message),
        "source": "github",
        "source_url": commit["html_url"],
    }

if __name__ == "__main__":
    os.makedirs("corpus", exist_ok=True)
    commits = fetch_commits()
    normalized = [normalize(c) for c in commits]

    linked = sum(1 for c in normalized if c["linked_ticket_id"])
    print(f"Fetched {len(normalized)} commits, {linked} reference a KAFKA ticket ID")

    with open("corpus/sample_commits.json", "w") as f:
        json.dump(normalized, f, indent=2)
    print("Saved to corpus/sample_commits.json")
