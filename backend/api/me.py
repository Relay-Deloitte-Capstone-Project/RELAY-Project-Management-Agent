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
from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/api/me/projects")
async def my_projects(email: str, request: Request):
    pool: asyncpg.Pool = request.app.state.pool
    rows = await pool.fetch(
        """
        SELECT p.engagement_id, p.project_code, p.name, p.client_name, m.role
        FROM public.project_staffing m
        JOIN public.projects p ON p.engagement_id = m.engagement_id
        WHERE lower(m.email) = lower($1) AND p.status != 'archived'
        ORDER BY m.assigned_at ASC
        """,
        email,
    )
    return [dict(r) for r in rows]
