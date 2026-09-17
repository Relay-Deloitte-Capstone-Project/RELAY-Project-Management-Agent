"""Resolves a logged-in user's own project scope.

The frontend's session identity lives in Prisma/SQLite (name/email/role) and
has never known which engagement_id(s) that person is actually staffed on —
every developer page hit one hardcoded ENGAGEMENT_ID constant regardless of
who was logged in. This is the one call the frontend makes right after
login to find out which real project(s) belong to this person, so every
other request (Ask Project, the work/epics/coverage dashboards) can be
scoped to it instead of a shared default.
"""

import asyncpg
from fastapi import APIRouter, Depends, Request

from api.auth import VerifiedUser, require_user

router = APIRouter()


@router.get("/api/me/projects")
async def my_projects(request: Request, user: VerifiedUser = Depends(require_user)):
    """Scoped to the verified caller's own email — used to be a plain
    `email` query param, letting anyone look up any other person's project
    list and role just by knowing (or guessing) their email address."""
    pool: asyncpg.Pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT p.engagement_id, p.project_code, p.name, p.client_name, m.role
        FROM public.project_staffing m
        JOIN public.projects p ON p.engagement_id = m.engagement_id
        WHERE lower(m.email) = lower($1) AND p.status != 'archived'
        ORDER BY m.assigned_at ASC
        """,
        user["email"],
    )
    return [dict(r) for r in rows]
