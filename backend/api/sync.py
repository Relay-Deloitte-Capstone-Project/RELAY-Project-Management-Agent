"""Live sync: Jira + GitHub → raw.* (zone 1) → public.chunks (zone 2).

The database started as a static dump — Jira edits (assignee, status) and new
GitHub commits/PRs never reached it. This module closes that gap:

- sync_jira()           issues updated since the last cursor → upsert
                        raw.jira_tickets, then update/re-embed the matching
                        public.chunks row when summary/description changed
                        (metadata — status, assignee — is refreshed either way)
- sync_github_commits() commits since the last cursor → raw.github_commits +
                        a new chunk per commit (message + ticket_refs only;
                        code itself is still never stored)
- sync_github_prs()     all PRs sorted by updated → raw.github_prs + chunks
                        with source_type='github_pr'
- sync_ticket()         one Jira issue, on demand — the UI's assignee-change
                        action calls this so the change is searchable
                        immediately instead of at the next poll

State lives in public.sync_state (one row per source). The first run for a
source has no cursor and does a full pull; existing chunks are only
re-embedded when their text actually changed, so a full first run over the
dumped corpus is mostly metadata refreshes.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone

import asyncpg
import httpx
from starlette.concurrency import run_in_threadpool

from api import github_client, jira_client
from api.intents import _adf_text
from api.query import DEFAULT_ENGAGEMENT_ID, embed, to_pgvector

logger = logging.getLogger(__name__)

TICKET_REF_RE = re.compile(r"\b([A-Z]+-\d+)\b")

# How often the background poller syncs. Override with SYNC_INTERVAL_MINUTES.
SYNC_INTERVAL_MINUTES = int(os.environ.get("SYNC_INTERVAL_MINUTES", "5"))

_GH_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

CHUNK_LOOKUP_SQL = """
    SELECT id, content, metadata FROM public.chunks
    WHERE engagement_id = $1 AND source_type = $2 AND source_doc_id = $3
    LIMIT 1
"""

CHUNK_INSERT_SQL = """
    INSERT INTO public.chunks (engagement_id, source_type, source_doc_id, content, metadata, embedding)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector)
"""

CHUNK_UPDATE_SQL = """
    UPDATE public.chunks SET content = $2, metadata = $3::jsonb, embedding = $4::vector
    WHERE id = $1
"""

CHUNK_META_SQL = """
    UPDATE public.chunks SET metadata = $2::jsonb WHERE id = $1
"""


async def _cursor(pool, source: str):
    row = await pool.fetchrow(
        "SELECT cursor FROM public.sync_state WHERE source = $1", source
    )
    return row["cursor"] if row else None


async def _save_state(pool, source: str, cursor: str, status: str, count: int):
    await pool.execute(
        """
        INSERT INTO public.sync_state (source, last_synced_at, cursor, last_status, last_count)
        VALUES ($1, NOW(), $2, $3, $4)
        ON CONFLICT (source) DO UPDATE
        SET last_synced_at = NOW(), cursor = $2, last_status = $3, last_count = $4
        """,
        source,
        cursor,
        status,
        count,
    )


async def _embed(model, text: str) -> str:
    vec = await run_in_threadpool(embed, model, text)
    return to_pgvector(vec)


def _meta_of(row) -> dict:
    m = row["metadata"]
    if isinstance(m, str):
        try:
            return json.loads(m)
        except Exception:
            return {}
    return m or {}


async def _upsert_chunk(pool, model, source_type, doc_id, content, metadata):
    """Insert the chunk, or update it — re-embedding only when the text the
    embedding was computed from actually changed."""
    import json

    row = await pool.fetchrow(
        CHUNK_LOOKUP_SQL, DEFAULT_ENGAGEMENT_ID, source_type, doc_id
    )
    if row is None:
        vec = await _embed(model, content)
        await pool.execute(
            CHUNK_INSERT_SQL,
            DEFAULT_ENGAGEMENT_ID,
            source_type,
            doc_id,
            content,
            json.dumps(metadata),
            vec,
        )
        return "inserted"
    if row["content"] != content:
        vec = await _embed(model, content)
        await pool.execute(CHUNK_UPDATE_SQL, row["id"], content, json.dumps(metadata), vec)
        return "updated"
    if _meta_of(row) != metadata:
        await pool.execute(CHUNK_META_SQL, row["id"], json.dumps(metadata))
        return "metadata"
    return "unchanged"


# --- Jira -------------------------------------------------------------------

# JQL's `updated >=` wants this exact format.
def _jql_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y/%m/%d %H:%M")


def _parse_dt(value):
    """Jira ('+0530', no colon) and GitHub ('Z') timestamps → datetime, or
    None. asyncpg rejects raw strings for timestamptz columns."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


async def upsert_jira_issue(pool, model, issue: dict) -> str:
    key = issue["key"]
    f = issue.get("fields", {})
    summary = f.get("summary") or ""
    desc = _adf_text(f.get("description"))[:1500]
    assignee = (f.get("assignee") or {}).get("displayName")
    status = (f.get("status") or {}).get("name")
    issue_type = (f.get("issuetype") or {}).get("name")
    priority = (f.get("priority") or {}).get("name")
    created = f.get("created")
    updated = f.get("updated")

    await pool.execute(
        """
        INSERT INTO raw.jira_tickets
            (ticket_key, summary, status, assignee, issue_type, priority,
             jira_created, jira_updated, payload, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
        ON CONFLICT (ticket_key) DO UPDATE SET
            summary = $2, status = $3, assignee = $4, issue_type = $5,
            priority = $6, jira_created = $7, jira_updated = $8,
            payload = $9::jsonb, synced_at = NOW()
        """,
        key,
        summary,
        status,
        assignee,
        issue_type,
        priority,
        _parse_dt(created),
        _parse_dt(updated),
        json.dumps(issue),
    )

    # Same "Ticket KEY: summary. description" shape the dumped chunks use, so
    # unchanged tickets compare equal and are never pointlessly re-embedded.
    content = "Ticket {}: {}. {}".format(key, summary, desc).strip()
    metadata = {
        "summary": summary,
        "status": status,
        "assignee": assignee,
        "issue_type": issue_type,
        "priority": priority,
        "created_at": created,
        "url": "https://{}/browse/{}".format(jira_client.SITE, key),
    }
    return await _upsert_chunk(pool, model, "jira_ticket", key, content, metadata)


async def sync_jira(pool, model, full: bool = False) -> int:
    if not jira_client.configured():
        return 0
    cursor = None if full else await _cursor(pool, "jira")
    if cursor:
        jql = 'project = {} AND updated >= "{}" ORDER BY updated ASC'.format(
            jira_client.PROJECT_KEY, cursor
        )
    else:
        jql = "project = {} ORDER BY created ASC".format(jira_client.PROJECT_KEY)
    issues = await jira_client.search_issues(
        jql, fields="summary,description,status,assignee,priority,issuetype,created,updated"
    )
    for issue in issues:
        await upsert_jira_issue(pool, model, issue)
    await _save_state(pool, "jira", _jql_now(), "ok", len(issues))
    return len(issues)


async def sync_ticket(pool, model, ticket_key: str) -> bool:
    """One issue, right now — called after the UI changes an assignee/status
    in Jira so the change is reflected without waiting for the next poll."""
    if not jira_client.configured():
        return False
    issue = await jira_client.get(
        "/rest/api/3/issue/{}".format(ticket_key),
        {"fields": "summary,description,status,assignee,priority,issuetype,created,updated"},
    )
    if not issue or not issue.get("key"):
        return False
    await upsert_jira_issue(pool, model, issue)
    return True


# --- GitHub -------------------------------------------------------------------


async def _repo(pool) -> str:
    repo = os.environ.get("GITHUB_REPO", "")
    if repo:
        return repo
    row = await pool.fetchrow(
        "SELECT metadata->>'repo' AS repo FROM public.chunks "
        "WHERE source_type = 'github_commit' AND metadata ? 'repo' LIMIT 1"
    )
    return row["repo"] if row else ""


async def _gh_get(path: str, params: dict | None = None):
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "https://api.github.com{}".format(path),
            params=params,
            headers={**_GH_HEADERS, "Authorization": "Bearer {}".format(github_client.TOKEN)},
        )
        resp.raise_for_status()
        return resp.json()


async def sync_github_commits(pool, model, full: bool = False) -> int:
    if not github_client.configured():
        return 0
    repo = await _repo(pool)
    if not repo:
        return 0
    since = None if full else await _cursor(pool, "github_commits")
    params = {"per_page": 100}
    if since:
        params["since"] = since
    commits = await _gh_get("/repos/{}/commits".format(repo), params)

    count = 0
    now = datetime.now(timezone.utc).isoformat()
    for c in commits:
        sha = c.get("sha")
        commit = c.get("commit") or {}
        message = commit.get("message") or ""
        author = (commit.get("author") or {}).get("name")
        date = (commit.get("author") or {}).get("date")
        if not sha:
            continue
        await pool.execute(
            """
            INSERT INTO raw.github_commits (sha, repo, author, message, committed_at, payload, synced_at)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
            ON CONFLICT (sha) DO UPDATE SET
                author = $3, message = $4, committed_at = $5, payload = $6::jsonb, synced_at = NOW()
            """,
            sha,
            repo,
            author,
            message,
            _parse_dt(date),
            json.dumps(c),
        )
        ticket_refs = sorted(set(TICKET_REF_RE.findall(message)))
        metadata = {
            "sha": sha,
            "sha_short": sha[:7],
            "author": author,
            "date": date,
            "message": message.split("\n")[0],
            "ticket_refs": ticket_refs,
            "repo": repo,
            "branch": "main",
            "url": "https://github.com/{}/commit/{}".format(repo, sha),
        }
        result = await _upsert_chunk(pool, model, "github_commit", sha, message, metadata)
        if result != "unchanged":
            count += 1
    await _save_state(pool, "github_commits", now, "ok", count)
    return count


async def sync_github_prs(pool, model, full: bool = False) -> int:
    if not github_client.configured():
        return 0
    repo = await _repo(pool)
    if not repo:
        return 0
    prs = await _gh_get(
        "/repos/{}/pulls".format(repo),
        {"state": "all", "sort": "updated", "direction": "desc", "per_page": 100},
    )
    count = 0
    now = datetime.now(timezone.utc).isoformat()
    for pr in prs:
        number = pr.get("number")
        title = pr.get("title") or ""
        body = (pr.get("body") or "")[:1500]
        author = (pr.get("user") or {}).get("login")
        state = "merged" if pr.get("merged_at") else pr.get("state")
        if number is None:
            continue
        await pool.execute(
            """
            INSERT INTO raw.github_prs (repo, number, title, state, author, pr_created, pr_updated, payload, synced_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
            ON CONFLICT (repo, number) DO UPDATE SET
                title = $3, state = $4, author = $5, pr_created = $6,
                pr_updated = $7, payload = $8::jsonb, synced_at = NOW()
            """,
            repo,
            number,
            title,
            state,
            author,
            _parse_dt(pr.get("created_at")),
            _parse_dt(pr.get("updated_at")),
            json.dumps(pr),
        )
        ticket_refs = sorted(set(TICKET_REF_RE.findall(title + "\n" + body)))
        content = "PR #{}: {}. {}".format(number, title, body).strip()
        metadata = {
            "number": number,
            "title": title,
            "author": author,
            "state": state,
            "ticket_refs": ticket_refs,
            "repo": repo,
            "url": pr.get("html_url"),
        }
        result = await _upsert_chunk(pool, model, "github_pr", str(number), content, metadata)
        if result != "unchanged":
            count += 1
    await _save_state(pool, "github_prs", now, "ok", count)
    return count


async def sync_all(pool, model, full: bool = False) -> dict:
    """One pass over every source; a failure in one is recorded in sync_state
    and doesn't stop the others."""
    results = {}
    for name, fn in (
        ("jira", sync_jira),
        ("github_commits", sync_github_commits),
        ("github_prs", sync_github_prs),
    ):
        try:
            results[name] = await fn(pool, model, full=full)
        except Exception as exc:
            logger.exception("sync failed for %s", name)
            await _save_state(pool, name, (await _cursor(pool, name)) or "", str(exc)[:400], 0)
            results[name] = "error: {}".format(exc)
    return results


# --- on-demand endpoints ------------------------------------------------------

import asyncio  # noqa: E402

from fastapi import APIRouter, HTTPException, Request  # noqa: E402

router = APIRouter()


@router.get("/api/sync/status")
async def sync_status(request: Request):
    rows = await request.app.state.pool.fetch(
        "SELECT source, last_synced_at, last_status, last_count FROM public.sync_state ORDER BY source"
    )
    return [dict(r) for r in rows]


@router.post("/api/sync")
async def sync_now(request: Request, full: bool = False):
    """Kick off a sync pass in the background; returns immediately. ?full=true
    ignores cursors and re-pulls everything (first boot, recovery)."""
    asyncio.create_task(
        sync_all(request.app.state.pool, request.app.state.embedding_model, full=full)
    )
    return {"started": True, "full": full}


@router.post("/api/sync/ticket/{ticket_key}")
async def sync_one_ticket(ticket_key: str, request: Request):
    """Immediate resync of one Jira issue — the UI's assignee/status change
    action calls this so the edit is searchable without waiting for the poll."""
    ok = await sync_ticket(
        request.app.state.pool, request.app.state.embedding_model, ticket_key.upper()
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Ticket not found in Jira")
    return {"synced": ticket_key.upper()}
