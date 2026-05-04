from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional

from config import settings
from auth.service import decode_access_token
from database import get_db

security = HTTPBearer(auto_error=False)

_COOKIE_NAME = "mst_token"


def _extract_token(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials],
) -> Optional[str]:
    """Return JWT from httpOnly cookie first, then Bearer header."""
    cookie = request.cookies.get(_COOKIE_NAME)
    if cookie:
        return cookie
    if credentials:
        return credentials.credentials
    return None


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    token = _extract_token(request, credentials)

    if token is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    db = await get_db()
    user = await db.fetchrow("SELECT * FROM users WHERE id = $1", payload["sub"])
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    return dict(user)


async def get_optional_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[dict]:
    token = _extract_token(request, credentials)

    if token is None:
        return None

    payload = decode_access_token(token)
    if payload is None:
        return None

    db = await get_db()
    user = await db.fetchrow("SELECT * FROM users WHERE id = $1", payload["sub"])
    return dict(user) if user else None


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_content(user: dict = Depends(get_current_user)) -> dict:
    """Allow admin and content roles."""
    if user["role"] not in ("admin", "content"):
        raise HTTPException(status_code=403, detail="Content creator access required")
    return user
