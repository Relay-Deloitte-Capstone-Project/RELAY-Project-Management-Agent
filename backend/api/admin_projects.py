"""Admin project setup — public.projects plus its linked per-step tables.

Backs the setup wizard (src/routes/_authenticated.admin.projects.new.tsx):
Step 1 creates the core project row, Steps 2-4 each write to their own
linked table (project_jira_links, project_github_links,
project_governance — see database/project_setup.sql) instead of widening
public.projects with unrelated columns, and finishing the wizard flips
status to 'active'. This is what gives the SOW upload pipeline (api/sow.py)
a real engagement_id to attach to, instead of every test upload landing on
the one hand-seeded 'proj-001' row.

Team assignment (wizard Step 5) writes public.project_members rows via the
/api/admin/projects/{id}/members endpoints below — that table doubles as
the access-control list api/access.py enforces for Ask Project. "User" rows
are reachable via FK because prisma db push targets this same Postgres
instance (the older SQLite split no longer applies).
"""

import re
import uuid
from datetime import date
from typing import Optional

import asyncpg
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40]
    return slug or "project"


def _make_engagement_id(name: str) -> str:
    # Short random suffix avoids a collision check round-trip on create —
    # two projects can share a name without colliding on this.
    return "{}-{}".format(_slugify(name), uuid.uuid4().hex[:6])


class NewProject(BaseModel):
    name: str
    client_name: str
    # date, not str: asyncpg binds directly to Postgres DATE columns and
    # needs a real datetime.date — it doesn't parse ISO strings itself the
    # way some drivers do. Pydantic parses "2026-09-08" into date for us.
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    created_by: Optional[str] = None


class UpdateProject(BaseModel):
    end_date: Optional[date] = None
    status: Optional[str] = None


class JiraLink(BaseModel):
    base_url: Optional[str] = None
    project_key: str


class GithubLink(BaseModel):
    repo_url: str
    branch: str = "main"


class Governance(BaseModel):
    retention_days: Optional[int] = None
    dpa_reference: Optional[str] = None


def _row_to_project(r) -> dict:
    return {
        "engagement_id": r["engagement_id"],
        "name": r["name"],
        "client_name": r["client_name"],
        "status": r["status"],
        "start_date": r["start_date"],
        "end_date": r["end_date"],
        "created_by": r["created_by"],
        "created_at": r["created_at"],
    }


async def _require_project(pool: asyncpg.Pool, engagement_id: str):
    exists = await pool.fetchval(
        "SELECT 1 FROM public.projects WHERE engagement_id = $1", engagement_id
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Project not found")


@router.post("/api/admin/projects")
async def create_project(body: NewProject, request: Request):
    name = body.name.strip()
    client_name = body.client_name.strip()
    if not name or not client_name:
        raise HTTPException(status_code=400, detail="name and client_name are required")

    pool: asyncpg.Pool = request.app.state.pool
    engagement_id = _make_engagement_id(name)

    row = await pool.fetchrow(
        """
        INSERT INTO public.projects
            (engagement_id, name, client_name, status, start_date, end_date, created_by)
        VALUES ($1, $2, $3, 'setup', $4, $5, $6)
        RETURNING engagement_id, name, client_name, status, start_date, end_date,
                  created_by, created_at
        """,
        engagement_id,
        name,
        client_name,
        body.start_date or None,
        body.end_date or None,
        body.created_by,
    )
    return _row_to_project(row)


@router.get("/api/admin/projects")
async def list_projects(request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT p.engagement_id, p.name, p.client_name, p.status, p.start_date, p.end_date,
               p.created_by, p.created_at,
               jl.base_url AS jira_base_url, jl.project_key AS jira_project_key,
               gl.repo_url AS github_repo_url, gl.branch AS github_branch,
               gov.retention_days, gov.dpa_reference
        FROM public.projects p
        LEFT JOIN public.project_jira_links jl ON jl.engagement_id = p.engagement_id
        LEFT JOIN public.project_github_links gl ON gl.engagement_id = p.engagement_id
        LEFT JOIN public.project_governance gov ON gov.engagement_id = p.engagement_id
        ORDER BY p.created_at DESC
        """
    )
    return [dict(r) for r in rows]


@router.get("/api/admin/projects/{engagement_id}")
async def get_project(engagement_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    row = await pool.fetchrow(
        """
        SELECT p.engagement_id, p.name, p.client_name, p.status, p.start_date, p.end_date,
               p.created_by, p.created_at,
               jl.base_url AS jira_base_url, jl.project_key AS jira_project_key,
               gl.repo_url AS github_repo_url, gl.branch AS github_branch,
               gov.retention_days, gov.dpa_reference
        FROM public.projects p
        LEFT JOIN public.project_jira_links jl ON jl.engagement_id = p.engagement_id
        LEFT JOIN public.project_github_links gl ON gl.engagement_id = p.engagement_id
        LEFT JOIN public.project_governance gov ON gov.engagement_id = p.engagement_id
        WHERE p.engagement_id = $1
        """,
        engagement_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return dict(row)


@router.patch("/api/admin/projects/{engagement_id}")
async def update_project(engagement_id: str, body: UpdateProject, request: Request):
    if body.status is not None and body.status not in ("setup", "active", "archived"):
        raise HTTPException(status_code=400, detail="Invalid status")

    pool: asyncpg.Pool = request.app.state.pool
    row = await pool.fetchrow(
        """
        UPDATE public.projects
        SET end_date = COALESCE($2, end_date),
            status   = COALESCE($3, status)
        WHERE engagement_id = $1
        RETURNING engagement_id, name, client_name, status, start_date, end_date,
                  created_by, created_at
        """,
        engagement_id,
        body.end_date,
        body.status,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _row_to_project(row)


@router.put("/api/admin/projects/{engagement_id}/jira")
async def upsert_jira_link(engagement_id: str, body: JiraLink, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    await _require_project(pool, engagement_id)
    if not body.project_key.strip():
        raise HTTPException(status_code=400, detail="project_key is required")

    row = await pool.fetchrow(
        """
        INSERT INTO public.project_jira_links (engagement_id, base_url, project_key)
        VALUES ($1, $2, $3)
        ON CONFLICT (engagement_id) DO UPDATE
            SET base_url = EXCLUDED.base_url,
                project_key = EXCLUDED.project_key,
                updated_at = NOW()
        RETURNING engagement_id, base_url, project_key, connected_at, updated_at
        """,
        engagement_id,
        body.base_url,
        body.project_key.strip(),
    )
    return dict(row)


@router.put("/api/admin/projects/{engagement_id}/github")
async def upsert_github_link(engagement_id: str, body: GithubLink, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    await _require_project(pool, engagement_id)
    if not body.repo_url.strip():
        raise HTTPException(status_code=400, detail="repo_url is required")

    row = await pool.fetchrow(
        """
        INSERT INTO public.project_github_links (engagement_id, repo_url, branch)
        VALUES ($1, $2, $3)
        ON CONFLICT (engagement_id) DO UPDATE
            SET repo_url = EXCLUDED.repo_url,
                branch = EXCLUDED.branch,
                updated_at = NOW()
        RETURNING engagement_id, repo_url, branch, connected_at, updated_at
        """,
        engagement_id,
        body.repo_url.strip(),
        body.branch.strip() or "main",
    )
    return dict(row)


@router.put("/api/admin/projects/{engagement_id}/governance")
async def upsert_governance(engagement_id: str, body: Governance, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    await _require_project(pool, engagement_id)

    row = await pool.fetchrow(
        """
        INSERT INTO public.project_governance (engagement_id, retention_days, dpa_reference)
        VALUES ($1, $2, $3)
        ON CONFLICT (engagement_id) DO UPDATE
            SET retention_days = EXCLUDED.retention_days,
                dpa_reference = EXCLUDED.dpa_reference,
                updated_at = NOW()
        RETURNING engagement_id, retention_days, dpa_reference, updated_at
        """,
        engagement_id,
        body.retention_days,
        body.dpa_reference,
    )
    return dict(row)


# --- Team (wizard Step 5) — public.project_members, the same table
# --- api/access.py enforces for Ask Project reads. -------------------------

MEMBER_ROLES = ("DEVELOPER", "MANAGER", "OBSERVER")


class NewMember(BaseModel):
    user_id: str
    role: str = "DEVELOPER"


def _row_to_member(r) -> dict:
    return {
        "user_id": r["user_id"],
        "name": r["name"],
        "email": r["email"],
        "role": r["role"],
        "added_by": r["added_by"],
        "created_at": r["created_at"],
    }


@router.get("/api/admin/users")
async def search_users(request: Request, q: Optional[str] = None):
    """User picker for wizard Step 5 — searches the real Prisma "User" table
    instead of the mock roster the wizard used before."""
    pool: asyncpg.Pool = request.app.state.pool
    if q and q.strip():
        rows = await pool.fetch(
            """
            SELECT id, name, email, role FROM "User"
            WHERE name ILIKE $1 OR email ILIKE $1
            ORDER BY name
            LIMIT 20
            """,
            f"%{q.strip()}%",
        )
    else:
        rows = await pool.fetch('SELECT id, name, email, role FROM "User" ORDER BY name LIMIT 50')
    return [dict(r) for r in rows]


@router.get("/api/admin/projects/{engagement_id}/members")
async def list_members(engagement_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT pm.user_id, u.name, u.email, pm.role, pm.added_by, pm.created_at
        FROM public.project_members pm
        JOIN "User" u ON u.id = pm.user_id
        WHERE pm.engagement_id = $1
        ORDER BY pm.created_at
        """,
        engagement_id,
    )
    return [_row_to_member(r) for r in rows]


@router.put("/api/admin/projects/{engagement_id}/members")
async def upsert_member(engagement_id: str, body: NewMember, request: Request):
    role = body.role.upper()
    if role not in MEMBER_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {MEMBER_ROLES}")

    pool: asyncpg.Pool = request.app.state.pool
    await _require_project(pool, engagement_id)
    if not await pool.fetchval('SELECT 1 FROM "User" WHERE id = $1', body.user_id):
        raise HTTPException(status_code=404, detail="Unknown user")

    row = await pool.fetchrow(
        """
        INSERT INTO public.project_members (engagement_id, user_id, role, added_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (engagement_id, user_id) DO UPDATE SET role = EXCLUDED.role
        RETURNING engagement_id, user_id, role, created_at
        """,
        engagement_id,
        body.user_id,
        role,
        None,
    )
    user = await pool.fetchrow('SELECT name, email FROM "User" WHERE id = $1', body.user_id)
    return {
        "user_id": row["user_id"],
        "name": user["name"],
        "email": user["email"],
        "role": row["role"],
        "added_by": None,
        "created_at": row["created_at"],
    }


@router.delete("/api/admin/projects/{engagement_id}/members/{user_id}")
async def remove_member(engagement_id: str, user_id: str, request: Request):
    """Removing the row is the whole revocation story: api/access.py checks
    membership on every Ask Project message, so the user loses read access
    to this project's data on their very next query."""
    pool: asyncpg.Pool = request.app.state.pool
    result = await pool.execute(
        "DELETE FROM public.project_members WHERE engagement_id = $1 AND user_id = $2",
        engagement_id,
        user_id,
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Membership not found")
    return {"ok": True}
