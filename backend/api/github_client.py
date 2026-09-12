"""Minimal GitHub REST client for the scratchpad's PR-diff-triggered
versioning. Only two calls exist because that's all the scratchpad feature
needs — this is not a general-purpose GitHub integration.

Auth: a personal access token in GITHUB_TOKEN (repo scope), not an MCP/App
integration. GITHUB_REPO is "owner/name" for the mock client's repo.
"""

import os

import httpx

TOKEN = os.environ.get("GITHUB_TOKEN", "")
REPO = os.environ.get("GITHUB_REPO", "")

API_BASE = "https://api.github.com"


def configured() -> bool:
    return bool(TOKEN and REPO)


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


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
