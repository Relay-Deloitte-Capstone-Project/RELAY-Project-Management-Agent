"""
ticket_summarizer.py — Project Memory Capstone
Takes a Jira ticket ID, finds linked GitHub commits/PRs,
formats them into an LLM prompt, and generates a summary.
"""

import json
import os
import re
import httpx
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ── Config ──────────────────────────────────────────────────────────
CORPUS_DIR = Path("corpus")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

GITHUB_HEADERS = {
    "Accept": "application/vnd.github.v3+json",
    "Authorization": f"token {GITHUB_TOKEN}"
}

# ── GitHub REST fallback for patches ────────────────────────────────
def get_commit_with_patches(sha: str) -> dict:
    url = f"https://api.github.com/repos/apache/kafka/commits/{sha}"
    resp = httpx.get(url, headers=GITHUB_HEADERS, timeout=15.0)
    resp.raise_for_status()
    return resp.json()

# ── LLM Fallback Chain: Gemini → Groq → Ollama ─────────────────────
def generate_summary(prompt: str) -> dict:
    """
        Tries Groq → Gemini → Ollama.
        Returns {"summary": str, "provider": str} or {"summary": error, "provider": "failed"}
    """
    # Try 1: Groq
    try:
        summary = _call_groq(prompt)
        return {"summary": summary, "provider": "groq"}
    except Exception as e:
        print(f"    ⚠️  Groq failed: {e}")

    # Try 2: Gemini
    for attempt in range(2):
        try:
            if attempt > 0:
                time.sleep(3)
            summary = _call_gemini(prompt)
            return {"summary": summary, "provider": "gemini"}
        except Exception as e:
            print(f"    ⚠️  Gemini failed (attempt {attempt+1}): {e}")

    # Try 3: Ollama
    try:
        summary = _call_ollama(prompt)
        return {"summary": summary, "provider": "ollama"}
    except Exception as e:
        print(f"    ⚠️  Ollama failed: {e}")

    return {"summary": "ERROR: All LLM providers failed. Check API keys.", "provider": "failed"}


def _call_gemini(prompt: str) -> str:
    """
    Gemini using Google Cloud API key (AQ... format).
    MUST use X-goog-api-key header, NOT ?key= query param.
    Uses gemini-flash-latest which auto-resolves to the current model.
    """
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    headers = {
        "Content-Type": "application/json",
        "X-goog-api-key": GEMINI_API_KEY
    }
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.35, "maxOutputTokens": 1024}
    }
    resp = httpx.post(url, json=payload, headers=headers, timeout=15.0)
    resp.raise_for_status()
    return resp.json()["candidates"][0]["content"]["parts"][0]["text"]


def _call_groq(prompt: str) -> str:
    """Groq llama3-8b-8192 — most reliable free-tier model."""
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "openai/gpt-oss-120b",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.35,
        "max_tokens": 1024
    }
    resp = httpx.post(url, json=payload, headers=headers, timeout=15.0)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _call_ollama(prompt: str) -> str:
    """Local fallback — only works if ollama serve is running."""
    url = "http://localhost:11434/api/generate"
    payload = {
        "model": "llama3.1:8b",
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.35}
    }
    resp = httpx.post(url, json=payload, timeout=30.0)
    resp.raise_for_status()
    return resp.json()["response"]


# ── Data loading & prompt building ─────────────────────────────────
def load_json(filename):
    with open(CORPUS_DIR / filename) as f:
        return json.load(f)


def find_commits_by_ticket(ticket_id: str, commits_data: list) -> list:
    pattern = re.compile(rf'\b{re.escape(ticket_id)}\b', re.IGNORECASE)
    matches = []
    for commit in commits_data:
        msg = commit.get("commit", {}).get("message", "")
        if pattern.search(msg):
            matches.append({
                "sha": commit["sha"],
                "sha_short": commit["sha"][:7],
                "message": msg,
                "author": commit.get("commit", {}).get("author", {}).get("name", "unknown"),
                "date": commit.get("commit", {}).get("author", {}).get("date", ""),
                "url": commit.get("html_url", "")
            })
    return matches


def find_prs_by_ticket(ticket_id: str, prs_data: list) -> list:
    pattern = re.compile(rf'\b{re.escape(ticket_id)}\b', re.IGNORECASE)
    matches = []
    for pr in prs_data:
        text = f"{pr.get('title', '')} {pr.get('body', '')}"
        if pattern.search(text):
            matches.append({
                "number": pr["number"],
                "title": pr["title"],
                "body": pr.get("body", "")[:800],
                "state": pr.get("state"),
                "author": pr.get("user", {}).get("login", "unknown"),
                "additions": pr.get("additions", 0),
                "deletions": pr.get("deletions", 0),
                "changed_files": pr.get("changed_files", 0)
            })
    return matches


def create_summary_prompt(ticket_id: str, commits: list, prs: list) -> str:
    commits_text = ""
    for c in commits:
        commits_text += f"\nCommit {c['sha_short']} by {c['author']} ({c['date'][:10]}):\n{c['message']}\n"
        if c.get("files_with_patches"):
            commits_text += "Changed files:\n"
            for f in c["files_with_patches"]:
                patch_preview = f["patch"][:600] if f["patch"] else "(no patch)"
                commits_text += f"  - {f['filename']}:\n{patch_preview}\n"

    prs_text = ""
    for p in prs:
        prs_text += f"\nPR #{p['number']} by {p['author']} ({p['state']}):\nTitle: {p['title']}\nBody: {p['body']}\nFiles changed: {p['changed_files']} (+{p['additions']}/-{p['deletions']})\n"

    # Pre-compute defaults so \n lives outside the f-string expression
    commits_section = commits_text if commits else "\n(no commits found)"
    prs_section     = prs_text     if prs     else "\n(no PRs found)"

    return f"""You are a technical documentation assistant. A project manager needs to understand what work was done for ticket {ticket_id}.

COMMITS:{commits_section}

PULL REQUESTS:{prs_section}

TASK: Write a 3-5 sentence plain-language summary of what was built, changed, or fixed. Mention the author and the type of change (bug fix, feature, refactor, test migration, etc.). If multiple commits/PRs exist, synthesize them into one coherent narrative.

SUMMARY:"""


# ── Main ────────────────────────────────────────────────────────────
def main():
    commits_list = load_json("github_commits_list.json")
    prs_list = load_json("github_prs_list.json")

    test_tickets = ["KAFKA-21002", "KAFKA-20993", "KAFKA-21000"]

    for ticket_id in test_tickets:
        print(f"\n{'='*60}")
        print(f"TICKET: {ticket_id}")
        print(f"{'='*60}")

        commits = find_commits_by_ticket(ticket_id, commits_list)
        prs = find_prs_by_ticket(ticket_id, prs_list)
        print(f"Found {len(commits)} commits, {len(prs)} PRs")

        # Enrich commits with patches via direct REST
                # Enrich commits with patches (LIMITED to avoid token bloat)
        for c in commits:
            print(f"  Fetching patches for {c['sha_short']}...")
            try:
                full = get_commit_with_patches(c["sha"])
                all_files = [
                    {"filename": f["filename"], "patch": f.get("patch", "")}
                    for f in full.get("files", []) if f.get("patch")
                ]
                # LIMIT: max 5 files, max 400 chars per patch
                MAX_FILES = 5
                MAX_PATCH_LEN = 400
                limited_files = all_files[:MAX_FILES]

                # changes from 223-236
                all_files = [
                    {"filename": f["filename"], "patch": f.get("patch", "")}
                    for f in full.get("files", []) if f.get("patch")
                ]
                # Cap at 5 files, 400 chars each to stay under token limits
                MAX_FILES, MAX_PATCH = 5, 400
                limited = all_files[:MAX_FILES]
                c["files_with_patches"] = [
                    {
                        "filename": f["filename"],
                        "patch": f["patch"][:MAX_PATCH] + ("..." if len(f["patch"]) > MAX_PATCH else "")
                    }
                    for f in limited
                ]

                if len(all_files) > MAX_FILES:
                    c["files_with_patches"].append({
                        "filename": f"... and {len(all_files) - MAX_FILES} more files",
                        "patch": "(truncated from full diff)"
                    })
                print(f"    ✓ {len(all_files)} files found, showing top {len(limited_files)}")
            except Exception as e:
                print(f"    ✗ Error: {e}")
                c["files_with_patches"] = []

        if not commits and not prs:
            print("No data found.")
            continue

        # Build prompt
        prompt = create_summary_prompt(ticket_id, commits, prs)
        print(f"\n--- PROMPT ({len(prompt)} chars) ---")

        # Save prompt
        prompt_file = CORPUS_DIR / f"prompt_{ticket_id}.txt"
        prompt_file.write_text(prompt)
        print(f"💾 Prompt saved: {prompt_file}")

        # ── CALL LLM ──
        print(f"\n🤖 Calling LLM (Groq → Gemini → Ollama)...")
        result = generate_summary(prompt)

        print(f"\n✅ Provider used: {result['provider']}")
        print(f"\n--- GENERATED SUMMARY ---")
        print(result["summary"])
        print("-" * 60)

        # Save summary
        summary_file = CORPUS_DIR / f"summary_{ticket_id}.txt"
        summary_file.write_text(
            f"Provider: {result['provider']}\n\n{result['summary']}"
        )
        print(f"💾 Summary saved: {summary_file}")


if __name__ == "__main__":
    main()