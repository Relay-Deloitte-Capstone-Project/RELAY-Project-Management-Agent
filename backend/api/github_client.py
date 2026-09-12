"""Live GitHub fetch for code questions.

Commit chunks in zone1 store only messages/metadata by design — code itself
is never persisted in Postgres. When a question asks about the actual code
change, the diff is fetched here at query time, trimmed to the relevant
hunks, handed to the LLM, and discarded. Only the generated summary lands
in zone3.chat_messages.

Requires GITHUB_TOKEN (repo read access). configured() lets callers fall
back to plain RAG when no token is set.
"""

from __future__ import annotations

import os

import httpx

TOKEN = os.environ.get("GITHUB_TOKEN", "")

# Total patch characters handed to the LLM across all files. Diffs can be
# huge; the prompt only needs enough to summarize and quote one short hunk.
PATCH_BUDGET_CHARS = 6000
MAX_FILES = 8


def configured() -> bool:
    return bool(TOKEN)


async def get_commit(repo: str, sha: str) -> dict | None:
    """{message, author, date, files: [{filename, status, patch}]} or None."""
    if not configured():
        return None
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"https://api.github.com/repos/{repo}/commits/{sha}",
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
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
