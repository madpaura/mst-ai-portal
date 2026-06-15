import time

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional

from config import settings
from auth.service import decode_access_token
from database import get_db

security = HTTPBearer(auto_error=False)

_COOKIE_NAME = "mst_token"

# In-process TTL cache for the per-request user lookup. The JWT is already
# validated by the time we read this; the DB row only supplies role/profile,
# so brief staleness is acceptable. Per-uvicorn-worker; mutations in this
# worker invalidate immediately, other workers converge within the TTL.
_USER_CACHE_TTL = 30.0
_USER_CACHE_MAX = 5000
_user_cache: dict[str, tuple[float, dict]] = {}


def invalidate_user_cache(user_id: str | None = None) -> None:
    """Drop one user (or all) from the auth lookup cache after a mutation."""
    if user_id is None:
        _user_cache.clear()
    else:
        _user_cache.pop(str(user_id), None)


async def _fetch_user(user_id: str) -> Optional[dict]:
    key = str(user_id)
    now = time.monotonic()
    hit = _user_cache.get(key)
    if hit and hit[0] > now:
        return hit[1]

    db = await get_db()
    row = await db.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
    user = dict(row) if row else None
    if user is not None:
        if len(_user_cache) >= _USER_CACHE_MAX:
            _user_cache.clear()
        _user_cache[key] = (now + _USER_CACHE_TTL, user)
    return user


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

    user = await _fetch_user(payload["sub"])
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

    user = await _fetch_user(payload["sub"])
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
