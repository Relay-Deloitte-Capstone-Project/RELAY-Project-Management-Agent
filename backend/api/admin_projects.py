"""Admin project setup — public.projects plus its linked per-step tables.

Backs the setup wizard (src/routes/_authenticated.admin.projects.new.tsx):
Step 1 creates the core project row, Steps 2-4 each write to their own
linked table (project_jira_links, project_github_links,
project_governance — see database/project_setup.sql) instead of widening
public.projects with unrelated columns, and finishing the wizard flips
status to 'active'. This is what gives the SOW upload pipeline (api/sow.py)
a real engagement_id to attach to, instead of every test upload landing on
the one hand-seeded 'proj-001' row.

Team assignment (wizard Step 5) is public.project_staffing
(database/project_staffing.sql) — one table doing double duty as both the
real-world staffing roster (name/email/department/role, no FK — this app's
login users live in Prisma/SQLite on the Node side, not in this Postgres
instance) and, keyed by email, the access-control list api/access.py
enforces for Ask Project reads. Managed by the
/api/admin/projects/{id}/staffing endpoints below; adding a person there
checks every OTHER active/setup project for the same email and flags
(never silently blocks) a double-staffing conflict. There used to be a
second table here (project_members, keyed by a Prisma "User".id FK) for
access control specifically — dropped because it required a "User" row
inside this Postgres instance, which never existed (see
database/project_members.sql's header for the full story).
"""

import re
import uuid
from datetime import date
from typing import Optional

import asyncpg
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from api.scratchpad_triggers import cascade_delete_engagement

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


ROLE_CHOICES = ("Manager", "Developer", "QA", "Designer", "Observer")


class NewStaffMember(BaseModel):
    name: str
    email: str
    department: Optional[str] = None
    role: str = "Developer"
    # Set on the second call, after the admin has seen the double-staffing
    # warning and chosen to add the person anyway.
    force: bool = False


def _row_to_project(r) -> dict:
    return {
        "engagement_id": r["engagement_id"],
        "project_code": r["project_code"],
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
        RETURNING engagement_id, project_code, name, client_name, status, start_date, end_date,
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
        SELECT p.engagement_id, p.project_code, p.name, p.client_name, p.status,
               p.start_date, p.end_date, p.created_by, p.created_at,
               jl.base_url AS jira_base_url, jl.project_key AS jira_project_key,
               gl.repo_url AS github_repo_url, gl.branch AS github_branch,
               gov.retention_days, gov.dpa_reference,
               (SELECT COUNT(*) FROM public.project_staffing m WHERE m.engagement_id = p.engagement_id) AS member_count
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
        SELECT p.engagement_id, p.project_code, p.name, p.client_name, p.status,
               p.start_date, p.end_date, p.created_by, p.created_at,
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
        RETURNING engagement_id, project_code, name, client_name, status, start_date, end_date,
                  created_by, created_at
        """,
        engagement_id,
        body.end_date,
        body.status,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return _row_to_project(row)


@router.delete("/api/admin/projects/{engagement_id}")
async def delete_project(engagement_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    # project_jira_links/github_links/governance/sow_documents/ingestion_logs/
    # project_staffing/project_tickets/project_commits all FK engagement_id
    # ON DELETE CASCADE (database/*.sql) — one delete here cleans all of them.
    # public.chunks has no FK to projects (its rows can outlive a project on
    # purpose, e.g. while re-tagging data to a different engagement_id), so
    # it's untouched by this — clear it out separately first if that's not
    # wanted for a given engagement.
    #
    # zone3.scratchpad_notes has no FK either (Zone 3 is developer-private,
    # deliberately outside the public schema's cascade graph) — this is R9,
    # the Scratchpad offboarding rule: a client leaving destroys every note
    # still carrying that client's provenance (provenance_ids IS NOT NULL),
    # even a private one nobody promoted. A note a developer already
    # approved (provenance cut — see api/scratchpad.py's approve_note)
    # survives. Order doesn't matter relative to the projects delete below;
    # neither depends on the other.
    await cascade_delete_engagement(pool, engagement_id)

    deleted = await pool.fetchval(
        "DELETE FROM public.projects WHERE engagement_id = $1 RETURNING engagement_id",
        engagement_id,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"deleted": True}


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


# --- Team (wizard Step 5) — public.project_staffing is now the single
# --- table for both "who's staffed on this project" and (via api/access.py,
# --- checked by email) "who can read this project's data in Ask Project".
# ---
# --- This used to be two separate tables: project_staffing (email-keyed,
# --- no FK) here, plus a project_members keyed by a Prisma "User".id FK for
# --- access control specifically. That required a real "User" table inside
# --- this Postgres instance, which never existed — this app's login users
# --- are Prisma/SQLite (prisma/schema.prisma, provider "sqlite"), a
# --- completely separate database this backend can't query. Every endpoint
# --- built on that assumption 500'd. Consolidated onto the one table that
# --- actually works, keyed by email throughout. -----------------------------


# Note: there is no GET /api/admin/users here. Prisma's "User" table is
# SQLite (prisma/schema.prisma, provider "sqlite"), a separate database this
# Python backend has no access to — a Postgres-side lookup here would just
# 500 forever. The wizard's user picker calls the real one instead:
# listAppUsers() in src/lib/admin/functions.ts, a TanStack server function
# that queries Prisma directly from the Node side.

# --- Staffing roster (wizard Step 5 UI) — public.project_staffing. ----------

@router.get("/api/admin/projects/{engagement_id}/staffing")
async def list_staffing(engagement_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    await _require_project(pool, engagement_id)
    rows = await pool.fetch(
        """
        SELECT id, engagement_id, name, email, department, role, assigned_at
        FROM public.project_staffing
        WHERE engagement_id = $1
        ORDER BY assigned_at ASC
        """,
        engagement_id,
    )
    return [dict(r) for r in rows]


@router.post("/api/admin/projects/{engagement_id}/staffing")
async def add_staff_member(engagement_id: str, body: NewStaffMember, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    await _require_project(pool, engagement_id)

    name = body.name.strip()
    email = body.email.strip().lower()
    if not name or not email:
        raise HTTPException(status_code=400, detail="name and email are required")
    if body.role not in ROLE_CHOICES:
        raise HTTPException(status_code=400, detail="Invalid role")

    already_here = await pool.fetchval(
        "SELECT 1 FROM public.project_staffing WHERE engagement_id = $1 AND email = $2",
        engagement_id,
        email,
    )
    if already_here:
        raise HTTPException(status_code=409, detail="This person is already on this project")

    # Double-staffing check: is this email already assigned to a DIFFERENT
    # project that hasn't been archived? Flagged, never silently blocked —
    # a mid-size firm routinely staffs one person across a couple of active
    # engagements, so the admin decides, the system just surfaces it.
    conflicts = await pool.fetch(
        """
        SELECT p.engagement_id, p.name AS project_name, p.project_code, m.role
        FROM public.project_staffing m
        JOIN public.projects p ON p.engagement_id = m.engagement_id
        WHERE m.email = $1 AND m.engagement_id != $2 AND p.status != 'archived'
        """,
        email,
        engagement_id,
    )
    if conflicts and not body.force:
        return {
            "conflict": True,
            "conflicts": [dict(c) for c in conflicts],
        }

    row = await pool.fetchrow(
        """
        INSERT INTO public.project_staffing (engagement_id, name, email, department, role)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, engagement_id, name, email, department, role, assigned_at
        """,
        engagement_id,
        name,
        email,
        body.department.strip() if body.department else None,
        body.role,
    )
    return {"conflict": False, "member": dict(row)}


@router.delete("/api/admin/projects/{engagement_id}/staffing/{member_id}")
async def remove_staff_member(engagement_id: str, member_id: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    deleted = await pool.fetchval(
        """
        DELETE FROM public.project_staffing
        WHERE id = $1 AND engagement_id = $2
        RETURNING id
        """,
        member_id,
        engagement_id,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Member not found on this project")
    return {"deleted": True}
