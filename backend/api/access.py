"""Per-project access control (SOW deliverable D6).

public.project_members (database/project_members.sql) decides who can read
which project's data. The rule enforced here:

  - ADMIN (Prisma "User".role) reads every project, membership row or not —
    an admin who just created a project in the setup wizard can use it
    immediately without adding themselves first.
  - Everyone else reads only projects they hold a membership row for.

require_access() is called by the Ask Project paths (api/sessions.py on
session creation AND on every message — so revoking a membership takes
effect on the user's next query, per D6's "no cache flush or restart") and
optionally by api/query.py.

Auth caveat, unchanged from before: the Python backend trusts the user_id
the Node frontend sends — it can't verify the JWT session cookie itself
(src/lib/auth/session.server.ts stays on the Node side). This module
controls what a given user_id may reach; it doesn't prove the caller is
that user.
"""

import asyncpg
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

ADMIN_ROLE = "ADMIN"


async def can_access(pool: asyncpg.Pool, user_id: str, engagement_id: str) -> bool:
    role = await pool.fetchval('SELECT role FROM "User" WHERE id = $1', user_id)
    if role is None:
        return False
    if role == ADMIN_ROLE:
        return True
    return bool(
        await pool.fetchval(
            "SELECT 1 FROM public.project_members WHERE engagement_id = $1 AND user_id = $2",
            engagement_id,
            user_id,
        )
    )


async def require_access(pool: asyncpg.Pool, user_id: str, engagement_id: str):
    if not await can_access(pool, user_id, engagement_id):
        raise HTTPException(
            status_code=403, detail="You are not a member of this project"
        )


@router.get("/api/my-projects")
async def my_projects(user_id: str, request: Request):
    """The projects this user may read — drives the Ask Project project
    picker, which replaces the old hardcoded proj-001. ADMINs get every
    project; others get only their memberships. Empty list means "not
    assigned anywhere yet", which the UI renders as an empty state."""
    pool: asyncpg.Pool = request.app.state.pool
    role = await pool.fetchval('SELECT role FROM "User" WHERE id = $1', user_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Unknown user")

    if role == ADMIN_ROLE:
        rows = await pool.fetch(
            """
            SELECT engagement_id, name, client_name, status
            FROM public.projects
            ORDER BY created_at DESC
            """
        )
    else:
        rows = await pool.fetch(
            """
            SELECT p.engagement_id, p.name, p.client_name, p.status
            FROM public.project_members pm
            JOIN public.projects p ON p.engagement_id = pm.engagement_id
            WHERE pm.user_id = $1
            ORDER BY p.created_at DESC
            """,
            user_id,
        )
    return [dict(r) for r in rows]
