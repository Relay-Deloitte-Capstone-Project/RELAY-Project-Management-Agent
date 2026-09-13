"""GitHub REST client for the backend.

Two uses share this module:

- Live commit-diff fetch for code questions (Ask Project). Commit chunks in
  zone1 store only messages/metadata by design — code itself is never
  persisted in Postgres. When a question asks about the actual code change,
  the diff is fetched here at query time, trimmed to the relevant hunks,
  handed to the LLM, and discarded. Only the generated summary lands in
  zone3.chat_messages.
- PR head-sha / diffstat lookups for the scratchpad's PR-diff-triggered
  versioning.

Auth: a personal access token in GITHUB_TOKEN (repo scope). The scratchpad
calls additionally need GITHUB_REPO as "owner/name"; Ask Project and sync
derive the repo from chunk metadata instead. configured() gates on the token
alone — use pr_configured() where a repo slug is required.
"""

from __future__ import annotations

import os

import httpx

TOKEN = os.environ.get("GITHUB_TOKEN", "")
REPO = os.environ.get("GITHUB_REPO", "")

API_BASE = "https://api.github.com"

# Total patch characters handed to the LLM across all files. Diffs can be
# huge; the prompt only needs enough to summarize and quote one short hunk.
PATCH_BUDGET_CHARS = 6000
MAX_FILES = 8


def configured() -> bool:
    return bool(TOKEN)


def pr_configured() -> bool:
    return bool(TOKEN and REPO)


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def get_commit(repo: str, sha: str) -> dict | None:
    """{message, author, date, files: [{filename, status, patch}]} or None."""
    if not configured():
        return None
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{API_BASE}/repos/{repo}/commits/{sha}",
            headers=_headers(),
        )
        if resp.status_code != 200:
            return None
        data = resp.json()

    files = []
    budget = PATCH_BUDGET_CHARS
    for f in (data.get("files") or [])[:MAX_FILES]:
        patch = f.get("patch") or ""
        if len(patch) > budget:
            patch = patch[:budget] + "\n… (truncated)"
        budget -= len(patch)
        files.append(
            {
                "filename": f.get("filename"),
                "status": f.get("status"),
                "patch": patch,
            }
        )
        if budget <= 0:
            break

    commit = data.get("commit") or {}
    return {
        "message": (commit.get("message") or "").split("\n")[0],
        "author": (commit.get("author") or {}).get("name"),
        "date": (commit.get("author") or {}).get("date"),
        "files": files,
    }


def format_diff_for_prompt(commit: dict) -> str:
    parts = [
        "Commit: {msg} (by {author}, {date})".format(
            msg=commit["message"], author=commit["author"], date=commit["date"]
        )
    ]
    for f in commit["files"]:
        parts.append("--- {filename} ({status})\n{patch}".format(**f))
    return "\n\n".join(parts)


async def get_pr_head_sha(pr_number: str) -> str:
    """Current HEAD commit sha of a PR — used to detect the underlying code
    changed since a scratchpad note last synced with it."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{API_BASE}/repos/{REPO}/pulls/{pr_number}", headers=_headers()
        )
        resp.raise_for_status()
        return resp.json()["head"]["sha"]


async def get_pr_diffstat(pr_number: str) -> str:
    """Short human-readable summary of a PR's current diff, e.g.
    '3 files changed, +42 -10' — stored as context on a pr_update version."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{API_BASE}/repos/{REPO}/pulls/{pr_number}", headers=_headers()
        )
        resp.raise_for_status()
        data = resp.json()
        return (
            f"{data['changed_files']} files changed, "
            f"+{data['additions']} -{data['deletions']}"
        )
