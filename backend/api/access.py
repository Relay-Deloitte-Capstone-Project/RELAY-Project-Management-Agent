"""Per-project access control (SOW deliverable D6).

public.project_staffing (database/project_staffing.sql) decides who can read
which project's data — the rule enforced here is "you read only projects
you have a staffing row on."

Originally written against a Postgres-side "User" table (role lookup +
user_id FK), on the assumption Prisma's login identity lived in this same
Postgres database. It doesn't — this app's users are Prisma/SQLite
(prisma/schema.prisma, provider "sqlite"), a completely separate database
the Python backend has no query access to. That made every call here 500
with "relation \"User\" does not exist". Rewritten to key off email instead
(the one piece of identity the Node frontend already has and already sends
elsewhere — see src/lib/admin/useMyProject.ts), matched against
project_staffing.email, the same table admin_projects.py's staffing
endpoints already use.

Dropped along with it: the ADMIN role bypass ("admins read every project
even with no staffing row"). Ask Project is developer-only in the actual UI
(see AppShell.tsx's nav — no /dev/ask entry for MANAGER or ADMIN), and there
is no Postgres-side signal for login role without the User table this
module can no longer assume exists. If admin-wide access to Ask Project is
wanted later, that needs either a real cross-database role lookup or a
staffing row per admin per project — not guessed at here.

require_access() is called by the Ask Project paths (api/sessions.py on
session creation AND on every message — so revoking a membership takes
effect on the user's next query, per D6's "no cache flush or restart") and
optionally by api/query.py.
"""

import asyncpg
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


async def can_access(pool: asyncpg.Pool, email: str, engagement_id: str) -> bool:
    if not email:
        return False
    return bool(
        await pool.fetchval(
            "SELECT 1 FROM public.project_staffing WHERE lower(email) = lower($1) AND engagement_id = $2",
            email,
            engagement_id,
        )
    )


async def require_access(pool: asyncpg.Pool, email: str, engagement_id: str):
    if not await can_access(pool, email, engagement_id):
        raise HTTPException(
            status_code=403, detail="You are not a member of this project"
        )


@router.get("/api/my-projects")
async def my_projects(email: str, request: Request):
    """The projects this user may read — drives the Ask Project project
    picker, which replaces the old hardcoded proj-001. Empty list means
    "not assigned anywhere yet", which the UI renders as an empty state."""
    pool: asyncpg.Pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT p.engagement_id, p.name, p.client_name, p.status
        FROM public.project_staffing s
        JOIN public.projects p ON p.engagement_id = s.engagement_id
        WHERE lower(s.email) = lower($1) AND p.status != 'archived'
        ORDER BY p.created_at DESC
        """,
        email,
    )
    return [dict(r) for r in rows]
