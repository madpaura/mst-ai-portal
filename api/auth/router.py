from fastapi import APIRouter, HTTPException, Depends

from auth.schemas import LoginRequest, TokenResponse, UserResponse, UserUpdateRequest
from auth.service import verify_password, create_access_token
from auth.dependencies import get_current_user
from database import get_db

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


@router.put("/me", response_model=UserResponse)
async def update_me(req: UserUpdateRequest, user: dict = Depends(get_current_user)):
    db = await get_db()
    updates = {}
    if req.display_name is not None:
        updates["display_name"] = req.display_name
    if req.initials is not None:
        updates["initials"] = req.initials

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
