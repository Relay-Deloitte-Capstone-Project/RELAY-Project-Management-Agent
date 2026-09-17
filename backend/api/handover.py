from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api import jira_client
from api.auth import VerifiedUser, require_role

router = APIRouter()

# Handover Kit is a manager tool (it can reassign live Jira tickets and
# leave status) — had no auth at all before.
_Manager = Depends(require_role("ADMIN", "MANAGER"))


@router.get("/api/handover/kpd/tickets")
async def kpd_tickets(user: VerifiedUser = _Manager):
    if not jira_client.configured():
        raise HTTPException(
            status_code=503,
            detail="Jira is not configured on the backend",
        )

    try:
        issues = await jira_client.kpd_issues()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to read Jira KPD board: {exc}",
        ) from exc

    return [
        {
            "key": issue["key"],
            "summary": issue["fields"].get("summary", ""),
            "status": issue["fields"].get("status", {}).get("name", ""),
            "priority": (issue["fields"].get("priority") or {}).get("name", "Medium"),
            "assignee": (issue["fields"].get("assignee") or {}).get("displayName"),
            "assignee_account_id": (issue["fields"].get("assignee") or {}).get("accountId"),
            "updated": issue["fields"].get("updated"),
        }
        for issue in issues
    ]


class AssigneeUpdate(BaseModel):
    account_id: Optional[str]


@router.put("/api/handover/kpd/tickets/{issue_key}/assignee")
async def update_kpd_assignee(issue_key: str, payload: AssigneeUpdate, user: VerifiedUser = _Manager):
    if not jira_client.configured():
        raise HTTPException(
            status_code=503,
            detail="Jira is not configured on the backend",
        )

    try:
        await jira_client.assign_issue(issue_key, payload.account_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to update Jira assignee: {exc}",
        ) from exc

    return {
        "key": issue_key,
        "account_id": payload.account_id,
        "updated": True,
    }


class LeaveUpdate(BaseModel):
    account_id: str
    on_leave: bool
    leave_date: Optional[str] = None
    return_date: Optional[str] = None


@router.put("/api/handover/kpd/leave")
async def update_kpd_leave(payload: LeaveUpdate, user: VerifiedUser = _Manager):
    """Sync Team Handover leave status to the real Jira user."""
    if not jira_client.configured():
        raise HTTPException(
            status_code=503,
            detail="Jira is not configured on the backend",
        )

    try:
        await jira_client.set_user_leave(
            account_id=payload.account_id,
            on_leave=payload.on_leave,
            leave_date=payload.leave_date,
            return_date=payload.return_date,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to sync leave status to Jira: {exc}",
        ) from exc

    return {
        "account_id": payload.account_id,
        "on_leave": payload.on_leave,
        "updated": True,
    }


@router.get("/api/handover/kpd/leave/{account_id}")
async def get_kpd_leave(account_id: str, user: VerifiedUser = _Manager):
    """Read Team Handover leave status from the real Jira user."""
    if not jira_client.configured():
        raise HTTPException(
            status_code=503,
            detail="Jira is not configured on the backend",
        )

    try:
        value = await jira_client.get_user_leave(account_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to read leave status from Jira: {exc}",
        ) from exc

    return {
        "account_id": account_id,
        "on_leave": bool(value and value.get("on_leave")),
        "leave_date": value.get("leave_date") if value else None,
        "return_date": value.get("return_date") if value else None,
    } 