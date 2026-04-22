from fastapi import APIRouter, HTTPException, Depends
import os
from typing import Optional
from pydantic import BaseModel
from auth.schemas import LoginRequest, TokenResponse, UserResponse, UserUpdateRequest
from auth.service import verify_password, create_access_token
from auth.dependencies import get_current_user, require_admin
from database import get_db


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
async def login(req: LoginRequest):
    db = await get_db()
    user = await db.fetchrow("SELECT * FROM users WHERE username = $1", req.username)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user["password_hash"] or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    await db.execute("UPDATE users SET last_login = now() WHERE id = $1", user["id"])

    token = create_access_token(str(user["id"]), user["role"])
    return TokenResponse(access_token=token)


@router.post("/logout")
async def logout(user: dict = Depends(get_current_user)):
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
        created_at=updated["created_at"],
    )


# ── Contribute Requests ────────────────────────────────────

@router.post("/contribute-request", response_model=ContributeRequestResponse)
async def submit_contribute_request(req: ContributeRequestCreate, user: dict = Depends(get_current_user)):
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


@router.put("/admin/contribute-requests/{request_id}", response_model=ContributeRequestResponse)
async def review_contribute_request(
    request_id: str, req: ReviewContributeRequest, admin: dict = Depends(require_admin)
):
    """Approve or reject a contribution request. Approved → sets user role to 'content'."""
    if req.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be 'approved' or 'rejected'")

    db = await get_db()
    row = await db.fetchrow("SELECT * FROM contribute_requests WHERE id = $1", request_id)
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")

    await db.execute(
        "UPDATE contribute_requests SET status = $1, admin_note = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $4",
        req.status, req.admin_note, admin["id"], request_id,
    )

    if req.status == "approved":
        await db.execute(
            "UPDATE users SET role = 'content' WHERE id = $1 AND role = 'user'",
            row["user_id"],
        )

    updated = await db.fetchrow("SELECT * FROM contribute_requests WHERE id = $1", request_id)
    return ContributeRequestResponse(
        id=str(updated["id"]), user_id=str(updated["user_id"]),
        reason=updated["reason"], status=updated["status"],
        admin_note=updated.get("admin_note"),
        created_at=updated["created_at"].isoformat(),
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
async def create_user(body: AdminCreateUser, admin: dict = Depends(require_admin)):
    import asyncpg
    if body.role not in ("user", "content", "admin"):
        raise HTTPException(status_code=400, detail="Role must be user, content, or admin")
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
    return UserResponse(
        id=str(row["id"]), username=row["username"], email=row.get("email"),
        display_name=row["display_name"], initials=row.get("initials"),
        role=row["role"], created_at=row["created_at"],
    )


@router.put("/admin/users/{user_id}/role")
async def update_user_role(user_id: str, role: str, admin: dict = Depends(require_admin)):
    if role not in ("user", "content", "admin"):
        raise HTTPException(status_code=400, detail="Role must be user, content, or admin")
    db = await get_db()
    result = await db.execute("UPDATE users SET role = $1 WHERE id = $2", role, user_id)
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": f"Role updated to '{role}'"}


class ResetPasswordRequest(BaseModel):
    new_password: str


def _validate_password_strength(password: str) -> None:
    """Raise HTTPException if password does not meet complexity requirements."""
    errors = []
    if len(password) < 12:
        errors.append("at least 12 characters")
    if not any(c.isupper() for c in password):
        errors.append("one uppercase letter")
    if not any(c.islower() for c in password):
        errors.append("one lowercase letter")
    if not any(c.isdigit() for c in password):
        errors.append("one digit")
    if not any(c in "!@#$%^&*()-_=+[]{}|;:',.<>?/`~" for c in password):
        errors.append("one special character")
    if errors:
        raise HTTPException(
            status_code=400,
            detail=f"Password must contain: {', '.join(errors)}",
        )


@router.put("/admin/users/{user_id}/password")
async def reset_user_password(user_id: str, body: ResetPasswordRequest, admin: dict = Depends(require_admin)):
    _validate_password_strength(body.new_password)
    from auth.service import hash_password
    pw_hash = hash_password(body.new_password)
    db = await get_db()
    result = await db.execute(
        "UPDATE users SET password_hash = $1 WHERE id = $2", pw_hash, user_id
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "Password updated"}


@router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    if str(admin["id"]) == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    db = await get_db()
    result = await db.execute("DELETE FROM users WHERE id = $1", user_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted"}


# ── Guest interest signup (no auth required) ──────────────────────────────────

class GuestInterestRequest(BaseModel):
    email: str
    source: str = "contribute"


@router.post("/auth/guest-interest")
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
