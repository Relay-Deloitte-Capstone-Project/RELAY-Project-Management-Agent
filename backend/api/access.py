"""Project membership guard — the enforcement half of per-project isolation.

public.project_members (database/project_members.sql) already tracks who's
staffed on which project; this reuses it as the access-control source
instead of a separate table, so "staffed on a project" and "can see that
project's data" never drift apart. Login identity lives in Prisma/SQLite
(this backend has no access to that store), so membership is checked by
email — every request that names an engagement_id also carries the
logged-in user's email from the frontend's session.
"""

import asyncpg
from fastapi import HTTPException


async def is_member(pool: asyncpg.Pool, email: str, engagement_id: str) -> bool:
    if not email:
        return False
    row = await pool.fetchval(
        "SELECT 1 FROM public.project_members WHERE lower(email) = lower($1) AND engagement_id = $2",
        email,
        engagement_id,
    )
    return bool(row)


async def require_member(pool: asyncpg.Pool, email: str, engagement_id: str) -> None:
    if not await is_member(pool, email, engagement_id):
        raise HTTPException(
            status_code=403,
            detail="You're not staffed on this project",
        )
