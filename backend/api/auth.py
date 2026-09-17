"""Verified caller identity for Ask Project.

Every endpoint in api/sessions.py and api/query.py used to trust whatever
`email` / `user_id` / `user_name` a client put in the request body — there
was no check that the caller was actually logged in as that person. Combined
with this backend's CORS being open to any origin, that meant anyone who
knew (or guessed) a staffed email could call the API directly as that
person, no login required. The GitHub-commit guardrail in api/query.py and
api/intents.py is worthless against that: an attacker can't be blocked from
seeing someone else's commits by a check that reads the very identity field
the attacker controls.

This module verifies the same JWT the Node frontend already signs
(src/lib/auth/session.server.ts, HS256, shared JWT_SECRET) via an
`Authorization: Bearer <token>` header, and returns the identity from the
token's own signed payload — never from the request body. The frontend
mints a short-lived copy of this token specifically for calling this API
(src/lib/auth/functions.ts's getAskApiToken) rather than exposing the
30-day httpOnly session cookie itself, which client-side JS can't read
anyway (HttpOnly) and shouldn't be able to.

Wired into every backend router — see require_role() below for the
admin/manager-only surfaces that also need a specific role, not just any
logged-in identity.
"""

from __future__ import annotations

import os
from typing import Optional, TypedDict

import jwt
from fastapi import Depends, HTTPException, Request


class VerifiedUser(TypedDict):
    id: str
    email: str
    name: str
    role: str


def _secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        raise HTTPException(
            status_code=500,
            detail="JWT_SECRET is not configured on the backend — Ask Project auth cannot run.",
        )
    return secret


def require_user(request: Request) -> VerifiedUser:
    """FastAPI dependency: decode and verify the bearer token, or 401.

    Raises rather than returns None so a route can simply declare
    `user: VerifiedUser = Depends(require_user)` and never see an
    unauthenticated request at all.
    """
    header = request.headers.get("authorization") or request.headers.get("Authorization")
    if not header or not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = header[7:].strip()
    try:
        payload = jwt.decode(token, _secret(), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session token expired, refresh and retry")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session token")

    for field in ("id", "email", "name", "role"):
        if not payload.get(field):
            raise HTTPException(status_code=401, detail="Malformed session token")

    return {
        "id": payload["id"],
        "email": payload["email"],
        "name": payload["name"],
        "role": payload["role"],
    }


def require_role(*roles: str):
    """FastAPI dependency factory: require_user, then also require the
    verified role be one of `roles` (e.g. Depends(require_role("ADMIN"))).

    Used for the admin/manager-only surfaces that trusted a client-supplied
    email with no role check at all — a UI that merely hides a nav link
    isn't access control, since the underlying API URL is still reachable
    directly by anyone who knows it.
    """

    def _check(user: VerifiedUser = Depends(require_user)) -> VerifiedUser:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="You don't have permission to do this")
        return user

    return _check


def try_verify_user(request: Request) -> Optional[VerifiedUser]:
    """Same decode as require_user, but returns None instead of raising.

    For /api/query only, which backend/scripts/eval_ask.py and smoke tests
    call directly with no login context at all — making auth mandatory there
    would break internal tooling that has nothing to do with a real
    developer session. The commit-authorship guardrail in api/query.py fails
    closed on a missing identity (empty allowlist, so a commit-citing
    question from an unauthenticated caller gets no commits, not all of
    them) so this stays safe without forcing a token on every caller.
    """
    header = request.headers.get("authorization") or request.headers.get("Authorization")
    if not header or not header.lower().startswith("bearer "):
        return None
    try:
        payload = jwt.decode(header[7:].strip(), _secret(), algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
    if not all(payload.get(f) for f in ("id", "email", "name", "role")):
        return None
    return {
        "id": payload["id"],
        "email": payload["email"],
        "name": payload["name"],
        "role": payload["role"],
    }


# --- rate limiting -----------------------------------------------------------
# Postgres-backed, not Redis: this app runs on free-tier infrastructure, and a
# COUNT query against an already-indexed, already-small table is cheap enough
# not to justify a new paid dependency. Scoped per verified user (never per
# IP, which would punish an office/VPN full of people behind one address).

RATE_LIMIT_MESSAGES = int(os.environ.get("ASK_RATE_LIMIT_MESSAGES", "20"))
RATE_LIMIT_WINDOW_SECONDS = int(os.environ.get("ASK_RATE_LIMIT_WINDOW_SECONDS", "300"))

RATE_LIMIT_SQL = """
    SELECT count(*) FROM zone3.chat_messages m
    JOIN zone3.chat_sessions s ON s.id = m.session_id
    WHERE s.user_id = $1 AND m.role = 'user'
      AND m.created_at > NOW() - ($2 || ' seconds')::interval
"""


async def enforce_rate_limit(pool, user_id: str) -> None:
    count = await pool.fetchval(RATE_LIMIT_SQL, user_id, str(RATE_LIMIT_WINDOW_SECONDS))
    if count is not None and count >= RATE_LIMIT_MESSAGES:
        raise HTTPException(
            status_code=429,
            detail=(
                f"You've asked {count} questions in the last "
                f"{RATE_LIMIT_WINDOW_SECONDS // 60} minutes — wait a moment before asking another."
            ),
        )
