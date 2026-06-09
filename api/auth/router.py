from fastapi import APIRouter, HTTPException, Depends, Response, Request, BackgroundTasks
from fastapi.responses import HTMLResponse
import os
from typing import Optional
from pydantic import BaseModel
from loguru import logger as log
from auth.schemas import LoginRequest, TokenResponse, UserResponse, UserUpdateRequest
from auth.service import verify_password, create_access_token, create_action_token, decode_action_token
from auth.dependencies import get_current_user, require_admin
from auth.audit import audit
from database import get_db
from config import settings
from limiter import limiter
from email_utils.utils import send_email_multi, get_publish_authority_emails

_COOKIE_NAME = "mst_token"
_COOKIE_MAX_AGE = int(settings.JWT_EXPIRE_HOURS * 3600)


class ContributeRequestCreate(BaseModel):
    reason: str


class ContributeRequestResponse(BaseModel):
    id: str
    user_id: str
    reason: str
    status: str
    admin_note: Optional[str] = None
    created_at: str


class ReviewContributeRequest(BaseModel):
    status: str  # 'approved' or 'rejected'
    admin_note: Optional[str] = None

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(request: Request, req: LoginRequest, response: Response):
    db = await get_db()
    user = await db.fetchrow("SELECT * FROM users WHERE username = $1", req.username)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user["password_hash"] or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    await db.execute("UPDATE users SET last_login = now() WHERE id = $1", user["id"])

    token = create_access_token(str(user["id"]), user["role"])

    # Set httpOnly cookie in addition to returning token in body (dual mode).
    # The cookie prevents XSS token theft; the body keeps API/CLI clients working.
    response.set_cookie(
        key=_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=False,       # set to True behind HTTPS (nginx terminates TLS)
        samesite="lax",
        max_age=_COOKIE_MAX_AGE,
        path="/",
    )
    return TokenResponse(access_token=token)


@router.post("/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie(key=_COOKIE_NAME, path="/")
    return {"message": "Logged out"}


@router.get("/me", response_model=UserResponse)
async def get_me(user: dict = Depends(get_current_user)):
    return UserResponse(
        id=str(user["id"]),
        username=user["username"],
        email=user.get("email"),
        display_name=user["display_name"],
        initials=user.get("initials"),
        role=user["role"],
        dept_name_en=user.get("dept_name_en"),
        created_at=user["created_at"],
    )


_USER_UPDATABLE_FIELDS = frozenset({"display_name", "initials"})


@router.put("/me", response_model=UserResponse)
async def update_me(req: UserUpdateRequest, user: dict = Depends(get_current_user)):
    db = await get_db()
    updates = {}
    if req.display_name is not None:
        updates["display_name"] = req.display_name
    if req.initials is not None:
        updates["initials"] = req.initials

    # Defensive: only columns in the whitelist may reach the query
    updates = {k: v for k, v in updates.items() if k in _USER_UPDATABLE_FIELDS}

    if updates:
        set_clause = ", ".join(f"{k} = ${i+2}" for i, k in enumerate(updates.keys()))
        values = list(updates.values())
        await db.execute(
            f"UPDATE users SET {set_clause} WHERE id = $1",
            user["id"],
            *values,
        )

    updated = await db.fetchrow("SELECT * FROM users WHERE id = $1", user["id"])
    return UserResponse(
        id=str(updated["id"]),
        username=updated["username"],
        email=updated.get("email"),
        display_name=updated["display_name"],
        initials=updated.get("initials"),
        role=updated["role"],
        dept_name_en=updated.get("dept_name_en"),
        created_at=updated["created_at"],
    )


# ── Contribute Requests ────────────────────────────────────

@router.post("/contribute-request", response_model=ContributeRequestResponse)
async def submit_contribute_request(
    req: ContributeRequestCreate, background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    """Submit a request to become a content contributor."""
    db = await get_db()
    # Check if user already has an active/approved request
    existing = await db.fetchrow(
        "SELECT id, status FROM contribute_requests WHERE user_id = $1 AND status IN ('pending', 'approved')",
        user["id"],
    )
    if existing:
        if existing["status"] == "approved":
            raise HTTPException(status_code=400, detail="You already have content creator access")
        raise HTTPException(status_code=400, detail="You already have a pending request")
    if not req.reason.strip():
        raise HTTPException(status_code=400, detail="Reason cannot be empty")

    row = await db.fetchrow(
        "INSERT INTO contribute_requests (user_id, reason) VALUES ($1, $2) RETURNING *",
        user["id"], req.reason.strip(),
    )

    # Notify admins (with one-click approve/reject buttons) and confirm to the requester.
    requester_name = user.get("display_name") or user.get("username") or "there"
    background_tasks.add_task(
        _notify_admins_new_request,
        str(row["id"]), requester_name,
        user.get("username") or "", user.get("email") or "", row["reason"],
    )
    background_tasks.add_task(
        _notify_requester_received, user.get("email") or "", requester_name,
    )

    return ContributeRequestResponse(
        id=str(row["id"]), user_id=str(row["user_id"]),
        reason=row["reason"], status=row["status"],
        admin_note=row.get("admin_note"),
        created_at=row["created_at"].isoformat(),
    )


@router.get("/contribute-request", response_model=Optional[ContributeRequestResponse])
async def get_my_contribute_request(user: dict = Depends(get_current_user)):
    """Get the current user's latest contribution request."""
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM contribute_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
        user["id"],
    )
    if not row:
        return None
    return ContributeRequestResponse(
        id=str(row["id"]), user_id=str(row["user_id"]),
        reason=row["reason"], status=row["status"],
        admin_note=row.get("admin_note"),
        created_at=row["created_at"].isoformat(),
    )


_REVIEW_TOKEN_PURPOSE = "contribute_review"


def _review_action_link(request_id: str, action: str) -> str:
    """Build a signed one-click approve/reject link for admin emails."""
    token = create_action_token(
        _REVIEW_TOKEN_PURPOSE, {"rid": request_id, "action": action}
    )
    return f"{settings.PORTAL_BASE_URL}/auth/contribute-request/action?token={token}"


async def _notify_admins_new_request(request_id: str, requester_name: str,
                                     username: str, requester_email: str, reason: str):
    """Email the Publish Authority about a new contributor request, with one-click action buttons."""
    recipients = await get_publish_authority_emails()
    if not recipients:
        log.warning(
            "Contributor request notification skipped: no deliverable 'Publish Authority' emails. "
            "Configure 'Publish Authority' in Admin → Settings (real, non-.internal/.local addresses). "
            "| request_id={}", request_id,
        )
        return
    approve_link = _review_action_link(request_id, "approved")
    reject_link = _review_action_link(request_id, "rejected")
    review_link = f"{settings.PORTAL_BASE_URL}/admin/contributions"
    who = f"{requester_name}" + (f" ({username})" if username else "")
    html = f"""
    <div style="font-family:Inter,sans-serif;background:#0a0f14;padding:32px;border-radius:12px;max-width:600px;margin:auto;">
      <h2 style="color:#258cf4;font-size:20px;margin-bottom:4px;">New Contributor Request</h2>
      <p style="color:#64748b;font-size:13px;margin-bottom:24px;">{who} has requested content creator access.</p>
      <div style="background:#131a22;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:16px;margin-bottom:20px;">
        <p style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Requested by</p>
        <p style="color:#f1f5f9;font-size:15px;font-weight:600;margin:0 0 12px;">{who}{(' &lt;' + requester_email + '&gt;') if requester_email else ''}</p>
        <p style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Reason</p>
        <p style="color:#f1f5f9;font-size:14px;margin:0;">{reason}</p>
      </div>
      <div style="margin-top:8px;">
        <a href="{approve_link}" style="display:inline-block;background:#22c55e;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;margin-right:8px;">Approve ✓</a>
        <a href="{reject_link}" style="display:inline-block;background:#ef4444;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">Decline ✕</a>
      </div>
      <p style="color:#475569;font-size:11px;margin-top:24px;">Or open the <a href="{review_link}" style="color:#64748b;">admin review page</a>. These action links expire in 7 days.</p>
      <p style="color:#475569;font-size:11px;margin-top:8px;">MST AI Portal · Contributor Requests</p>
    </div>
    """
    try:
        await send_email_multi(
            subject=f"New contributor request from {requester_name}",
            html_content=html,
            to_emails=recipients,
        )
    except Exception as e:
        log.error(f"Failed to send admin contributor-request notification: {e}")


async def _notify_requester_received(to_email: str, display_name: str):
    """Confirm to the requester that their contributor request was received."""
    if not to_email or "@" not in to_email:
        return
    html = f"""
    <div style="font-family:Inter,sans-serif;background:#0a0f14;padding:32px;border-radius:12px;max-width:600px;margin:auto;">
      <h2 style="color:#258cf4;font-size:20px;margin-bottom:4px;">Request Received</h2>
      <p style="color:#64748b;font-size:13px;margin-bottom:24px;">Hi {display_name}, we've received your request to become a content contributor.</p>
      <div style="background:#131a22;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:16px;margin-bottom:20px;">
        <p style="color:#f1f5f9;font-size:14px;margin:0;">An administrator will review it shortly. You'll get another email once a decision has been made.</p>
      </div>
      <p style="color:#475569;font-size:11px;margin-top:24px;">MST AI Portal · Contributor Requests</p>
    </div>
    """
    try:
        await send_email_multi(
            subject="Your contributor request was received",
            html_content=html,
            to_emails=[to_email],
        )
    except Exception as e:
        log.error(f"Failed to send contributor-request confirmation: {e}")


async def _notify_admins_decision(request_id: str, requester_name: str, approved: bool):
    """Inform the Publish Authority that a contributor request has been resolved."""
    recipients = await get_publish_authority_emails()
    if not recipients:
        return
    status_word = "approved" if approved else "declined"
    status_color = "#22c55e" if approved else "#ef4444"
    html = f"""
    <div style="font-family:Inter,sans-serif;background:#0a0f14;padding:32px;border-radius:12px;max-width:600px;margin:auto;">
      <h2 style="color:{status_color};font-size:20px;margin-bottom:4px;">Contributor Request {status_word.capitalize()}</h2>
      <p style="color:#64748b;font-size:13px;margin-bottom:24px;">The contributor request from {requester_name} has been {status_word}. No further action is needed.</p>
      <p style="color:#475569;font-size:11px;margin-top:24px;">MST AI Portal · Contributor Requests</p>
    </div>
    """
    try:
        await send_email_multi(
            subject=f"Contributor request from {requester_name} {status_word}",
            html_content=html,
            to_emails=recipients,
        )
    except Exception as e:
        log.error(f"Failed to send admin contributor-decision notification: {e}")


async def _notify_contribute_decision(to_email: str, display_name: str,
                                      approved: bool, admin_note: str | None):
    """Email the requesting user when their contributor request is reviewed."""
    if not to_email or "@" not in to_email:
        return
    status_word = "Approved" if approved else "Declined"
    status_color = "#22c55e" if approved else "#ef4444"
    intro = (
        "You now have content creator access — you can upload videos, create articles, "
        "and publish to the marketplace."
        if approved else
        "Your request to become a content contributor was not approved at this time."
    )
    note_html = (
        f"<p style='color:#94a3b8;font-size:13px;'><b>Admin note:</b> {admin_note}</p>"
        if admin_note else ""
    )
    action_html = (
        f'<a href="{settings.PORTAL_URL}" style="display:inline-block;background:#258cf4;'
        f'color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;'
        f'font-size:14px;margin-top:8px;">Go to Portal →</a>'
        if approved else ""
    )
    html = f"""
    <div style="font-family:Inter,sans-serif;background:#0a0f14;padding:32px;border-radius:12px;max-width:600px;margin:auto;">
      <h2 style="color:{status_color};font-size:20px;margin-bottom:4px;">Contributor Request {status_word}</h2>
      <p style="color:#64748b;font-size:13px;margin-bottom:24px;">Hi {display_name}, your request to become a content contributor has been reviewed.</p>
      <div style="background:#131a22;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:16px;margin-bottom:20px;">
        <p style="color:#f1f5f9;font-size:14px;margin:0;">{intro}</p>
      </div>
      {note_html}
      {action_html}
      <p style="color:#475569;font-size:11px;margin-top:24px;">MST AI Portal · Contributor Requests</p>
    </div>
    """
    try:
        await send_email_multi(
            subject=f"Contributor Request {status_word}",
            html_content=html,
            to_emails=[to_email],
        )
    except Exception as e:
        log.error(f"Failed to send contributor decision notification: {e}")


# ── Admin: Manage Contribute Requests ─────────────────────

@router.get("/admin/contribute-requests", response_model=list[ContributeRequestResponse])
async def list_contribute_requests(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT cr.*, u.display_name, u.username
        FROM contribute_requests cr
        JOIN users u ON u.id = cr.user_id
        ORDER BY cr.created_at DESC
        """,
    )
    return [
        ContributeRequestResponse(
            id=str(r["id"]), user_id=str(r["user_id"]),
            reason=r["reason"], status=r["status"],
            admin_note=r.get("admin_note"),
            created_at=r["created_at"].isoformat(),
        )
        for r in rows
    ]


async def _apply_contribute_review(request_id: str, status: str, admin_note: str | None,
                                   reviewed_by: str | None, background_tasks: BackgroundTasks,
                                   require_pending: bool = False):
    """Shared approve/reject logic. Approved → sets user role to 'content'.
    Returns (row, result) where result is 'not_found' | 'already_done' | 'applied'."""
    db = await get_db()
    row = await db.fetchrow(
        """
        SELECT cr.*, u.email AS user_email, u.display_name AS user_display_name
        FROM contribute_requests cr
        JOIN users u ON u.id = cr.user_id
        WHERE cr.id = $1
        """,
        request_id,
    )
    if not row:
        return None, "not_found"
    if require_pending and row["status"] != "pending":
        return row, "already_done"

    await db.execute(
        "UPDATE contribute_requests SET status = $1, admin_note = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $4",
        status, admin_note, reviewed_by, request_id,
    )
    if status == "approved":
        await db.execute(
            "UPDATE users SET role = 'content' WHERE id = $1 AND role = 'user'",
            row["user_id"],
        )

    approved = status == "approved"
    name = row.get("user_display_name") or "there"
    # Notify the requesting user of the decision, and the admins of the outcome.
    background_tasks.add_task(
        _notify_contribute_decision, row.get("user_email") or "", name, approved, admin_note,
    )
    background_tasks.add_task(_notify_admins_decision, request_id, name, approved)
    return row, "applied"


@router.put("/admin/contribute-requests/{request_id}", response_model=ContributeRequestResponse)
async def review_contribute_request(
    request: Request, request_id: str, req: ReviewContributeRequest,
    background_tasks: BackgroundTasks, admin: dict = Depends(require_admin)
):
    """Approve or reject a contribution request. Approved → sets user role to 'content'."""
    if req.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be 'approved' or 'rejected'")

    row, result = await _apply_contribute_review(
        request_id, req.status, req.admin_note, admin["id"], background_tasks,
    )
    if result == "not_found":
        raise HTTPException(status_code=404, detail="Request not found")

    await audit(request, admin, f"contribute_request.{req.status}", "contribute_request", request_id,
                {"user_id": str(row["user_id"]), "admin_note": req.admin_note})
    db = await get_db()
    updated = await db.fetchrow("SELECT * FROM contribute_requests WHERE id = $1", request_id)
    return ContributeRequestResponse(
        id=str(updated["id"]), user_id=str(updated["user_id"]),
        reason=updated["reason"], status=updated["status"],
        admin_note=updated.get("admin_note"),
        created_at=updated["created_at"].isoformat(),
    )


def _review_result_page(title: str, message: str, color: str = "#258cf4") -> HTMLResponse:
    html = f"""<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{title}</title></head>
    <body style="font-family:Inter,system-ui,sans-serif;background:#0a0f14;margin:0;padding:0;">
      <div style="max-width:520px;margin:64px auto;background:#131a22;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:40px;text-align:center;">
        <h1 style="color:{color};font-size:22px;margin:0 0 12px;">{title}</h1>
        <p style="color:#94a3b8;font-size:14px;margin:0 0 28px;">{message}</p>
        <a href="{settings.PORTAL_BASE_URL}/admin/contributions" style="display:inline-block;background:#258cf4;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Open review page →</a>
      </div>
    </body></html>"""
    return HTMLResponse(content=html)


@router.get("/contribute-request/action", response_class=HTMLResponse)
async def contribute_request_action(token: str, background_tasks: BackgroundTasks):
    """One-click approve/reject from an admin notification email. The action is
    authorised by a signed token embedded in the link (no login required)."""
    payload = decode_action_token(token, _REVIEW_TOKEN_PURPOSE)
    if not payload:
        return _review_result_page(
            "Link expired or invalid",
            "This approval link is no longer valid. Please use the admin review page instead.",
            color="#ef4444",
        )
    action = payload.get("action")
    request_id = payload.get("rid")
    if action not in ("approved", "rejected") or not request_id:
        return _review_result_page(
            "Invalid action",
            "This link doesn't carry a valid action.",
            color="#ef4444",
        )

    row, result = await _apply_contribute_review(
        request_id, action, None, None, background_tasks, require_pending=True,
    )
    name = (row.get("user_display_name") if row else None) or "the requester"
    if result == "not_found":
        return _review_result_page(
            "Request not found",
            "This contributor request no longer exists.",
            color="#ef4444",
        )
    if result == "already_done":
        return _review_result_page(
            "Already reviewed",
            f"This request from {name} was already {row['status']}. No change was made.",
        )
    verb = "approved" if action == "approved" else "declined"
    color = "#22c55e" if action == "approved" else "#ef4444"
    return _review_result_page(
        f"Request {verb}",
        f"The contributor request from {name} has been {verb} and they have been notified.",
        color=color,
    )


# ── Admin: User Role Management ────────────────────────────

@router.get("/admin/users", response_model=list[UserResponse])
async def list_users(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch("SELECT * FROM users ORDER BY created_at DESC LIMIT 200")
    return [
        UserResponse(
            id=str(r["id"]), username=r["username"], email=r.get("email"),
            display_name=r["display_name"], initials=r.get("initials"),
            role=r["role"], created_at=r["created_at"],
        )
        for r in rows
    ]


class AdminCreateUser(BaseModel):
    username: str
    display_name: str
    password: str
    role: str = "user"
    email: Optional[str] = None


@router.post("/admin/users", response_model=UserResponse)
async def create_user(request: Request, body: AdminCreateUser, admin: dict = Depends(require_admin)):
    import asyncpg
    if body.role not in ("user", "content", "admin"):
        raise HTTPException(status_code=400, detail="Role must be user, content, or admin")
    _validate_password_strength(body.password)
    db = await get_db()
    existing = await db.fetchrow(
        "SELECT id FROM users WHERE username = $1 OR (email = $2 AND $2 IS NOT NULL)",
        body.username, body.email or None,
    )
    if existing:
        raise HTTPException(status_code=409, detail="Username or email already in use")
    from auth.service import hash_password
    pw_hash = hash_password(body.password)
    initials = "".join(w[0].upper() for w in body.display_name.split()[:2]) or body.display_name[0].upper()
    try:
        row = await db.fetchrow(
            """
            INSERT INTO users (username, email, display_name, initials, password_hash, role)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            """,
            body.username, body.email or None, body.display_name, initials, pw_hash, body.role,
        )
    except asyncpg.UniqueViolationError as e:
        detail = "Email already in use" if "users_email_key" in str(e) else "Username already taken"
        raise HTTPException(status_code=409, detail=detail)
    await audit(request, admin, "user.create", "user", str(row["id"]),
                {"username": body.username, "role": body.role})
    return UserResponse(
        id=str(row["id"]), username=row["username"], email=row.get("email"),
        display_name=row["display_name"], initials=row.get("initials"),
        role=row["role"], created_at=row["created_at"],
    )


@router.put("/admin/users/{user_id}/role")
async def update_user_role(request: Request, user_id: str, role: str, admin: dict = Depends(require_admin)):
    if role not in ("user", "content", "admin"):
        raise HTTPException(status_code=400, detail="Role must be user, content, or admin")
    db = await get_db()
    target = await db.fetchrow("SELECT username FROM users WHERE id = $1", user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["username"] == "admin":
        raise HTTPException(status_code=403, detail="System admin role cannot be changed")
    result = await db.execute("UPDATE users SET role = $1 WHERE id = $2", role, user_id)
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="User not found")
    await audit(request, admin, "user.role_change", "user", user_id, {"new_role": role})
    return {"message": f"Role updated to '{role}'"}


class ResetPasswordRequest(BaseModel):
    new_password: str
    current_password: Optional[str] = None  # required when admin resets their own password


def _validate_password_strength(password: str) -> None:
    errors = []
    if len(password) < 8:
        errors.append("at least 8 characters")
    if not any(c.isalpha() for c in password):
        errors.append("at least one letter")
    if not any(c.isdigit() for c in password):
        errors.append("at least one number")
    if errors:
        raise HTTPException(status_code=400, detail=f"Password must contain: {', '.join(errors)}")


@router.put("/admin/users/{user_id}/password")
@limiter.limit("10/minute")
async def reset_user_password(request: Request, user_id: str, body: ResetPasswordRequest, admin: dict = Depends(require_admin)):
    from auth.service import hash_password, verify_password
    db = await get_db()
    target = await db.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["username"] == "admin" and str(admin["id"]) != user_id:
        raise HTTPException(status_code=403, detail="System admin password cannot be reset by another admin")

    # Admin changing their own password must verify current password first
    if str(admin["id"]) == user_id:
        if not body.current_password:
            raise HTTPException(status_code=400, detail="Current password is required to change your own password")
        if not verify_password(body.current_password, target["password_hash"] or ""):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

    _validate_password_strength(body.new_password)
    pw_hash = hash_password(body.new_password)
    await db.execute("UPDATE users SET password_hash = $1 WHERE id = $2", pw_hash, user_id)
    await audit(request, admin, "user.password_reset", "user", user_id)
    return {"message": "Password updated"}


@router.delete("/admin/users/{user_id}")
async def delete_user(request: Request, user_id: str, force: bool = False, admin: dict = Depends(require_admin)):
    if str(admin["id"]) == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    db = await get_db()
    target = await db.fetchrow("SELECT username FROM users WHERE id = $1", user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["username"] == "admin":
        raise HTTPException(status_code=403, detail="System admin account cannot be deleted")
    video_count = await db.fetchval(
        "SELECT COUNT(*) FROM videos WHERE created_by = $1", user_id
    )
    if video_count:
        if not force:
            raise HTTPException(
                status_code=409,
                detail=f"This user owns {video_count} video(s). Reassign all their content to you and delete this user?"
            )
        await db.execute(
            "UPDATE videos SET created_by = $1 WHERE created_by = $2",
            str(admin["id"]), user_id,
        )
    await db.execute("DELETE FROM users WHERE id = $1", user_id)
    await audit(request, admin, "user.delete", "user", user_id)
    return {"message": "User deleted"}


# ── Admin: Audit Log ──────────────────────────────────────────────────────────

@router.get("/admin/audit-log")
async def list_audit_log(
    limit: int = 100,
    offset: int = 0,
    action: Optional[str] = None,
    admin_id: Optional[str] = None,
    admin: dict = Depends(require_admin),
):
    db = await get_db()
    conditions = []
    params: list = []
    if action:
        params.append(f"%{action}%")
        conditions.append(f"action ILIKE ${len(params)}")
    if admin_id:
        params.append(admin_id)
        conditions.append(f"admin_id = ${len(params)}")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params += [limit, offset]
    rows = await db.fetch(
        f"""
        SELECT a.*, u.username
        FROM admin_audit_log a
        LEFT JOIN users u ON u.id = a.admin_id
        {where}
        ORDER BY a.ts DESC
        LIMIT ${len(params) - 1} OFFSET ${len(params)}
        """,
        *params,
    )
    total = await db.fetchval(
        f"SELECT COUNT(*) FROM admin_audit_log a {where}",
        *params[:-2],
    )
    return {
        "total": total,
        "items": [
            {
                "id": str(r["id"]),
                "ts": r["ts"].isoformat(),
                "admin_id": str(r["admin_id"]) if r["admin_id"] else None,
                "admin_name": r["admin_name"],
                "username": r.get("username"),
                "action": r["action"],
                "target_type": r["target_type"],
                "target_id": r["target_id"],
                "details": r["details"],
                "ip_address": r["ip_address"],
                "request_id": r["request_id"],
            }
            for r in rows
        ],
    }


# ── Admin: Guest Interest List ────────────────────────────────────────────────

class GuestInterestStatusUpdate(BaseModel):
    status: str  # 'contacted' or 'dismissed'
    admin_note: Optional[str] = None


@router.get("/admin/guest-interests")
async def list_guest_interests(
    status: Optional[str] = None,
    admin: dict = Depends(require_admin),
):
    db = await get_db()
    where = "WHERE gi.status = $1" if status else ""
    params = [status] if status else []
    rows = await db.fetch(
        f"""
        SELECT gi.*, u.display_name as reviewer_name
        FROM guest_interests gi
        LEFT JOIN users u ON u.id = gi.reviewed_by
        {where}
        ORDER BY gi.created_at DESC
        """,
        *params,
    )
    return [
        {
            "id": r["id"],
            "email": r["email"],
            "source": r["source"],
            "status": r["status"],
            "admin_note": r.get("admin_note"),
            "reviewer_name": r.get("reviewer_name"),
            "reviewed_at": r["reviewed_at"].isoformat() if r.get("reviewed_at") else None,
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


@router.put("/admin/guest-interests/{interest_id}")
async def update_guest_interest(
    request: Request,
    interest_id: int,
    body: GuestInterestStatusUpdate,
    admin: dict = Depends(require_admin),
):
    if body.status not in ("contacted", "dismissed", "pending"):
        raise HTTPException(status_code=400, detail="Status must be contacted, dismissed, or pending")
    db = await get_db()
    result = await db.execute(
        """
        UPDATE guest_interests
        SET status = $1, admin_note = $2, reviewed_by = $3, reviewed_at = now()
        WHERE id = $4
        """,
        body.status, body.admin_note, admin["id"], interest_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Not found")
    await audit(request, admin, f"guest_interest.{body.status}", "guest_interest", str(interest_id),
                {"admin_note": body.admin_note})
    return {"message": "Updated"}


# ── Guest interest signup (no auth required) ──────────────────────────────────

class GuestInterestRequest(BaseModel):
    email: str
    source: str = "contribute"


@router.post("/guest-interest")
async def guest_interest(req: GuestInterestRequest):
    import re
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", req.email.strip()):
        raise HTTPException(status_code=400, detail="Invalid email address")
    db = await get_db()
    await db.execute(
        "INSERT INTO guest_interests (email, source) VALUES ($1, $2)",
        req.email.strip().lower(), req.source,
    )
    return {"message": "Thank you! We'll be in touch."}
