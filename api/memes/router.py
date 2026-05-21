import asyncio
import uuid as _uuid_mod
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.responses import RedirectResponse

from memes.schemas import MemeGroupResponse, MemeGroupWithMemes, MemeResponse
from database import get_db
from auth.service import decode_access_token
import cache

router = APIRouter()
redirect_router = APIRouter()

_COOKIE_NAME = "mst_token"

NS = cache.NS_MEMES


def _row_to_group(r, meme_count: int = 0, thumbnail: Optional[str] = None) -> MemeGroupResponse:
    return MemeGroupResponse(
        id=str(r["id"]), title=r["title"], slug=r["slug"],
        category=r["category"], sort_order=r["sort_order"],
        meme_count=meme_count, thumbnail=thumbnail,
    )


def _row_to_meme(r) -> MemeResponse:
    return MemeResponse(
        id=str(r["id"]), group_id=str(r["group_id"]),
        title=r.get("title"), image_url=r["image_url"],
        link_url=r.get("link_url"), sort_order=r["sort_order"],
    )


@router.get("/categories", response_model=list[str])
async def list_categories():
    async def _fetch():
        db = await get_db()
        rows = await db.fetch("SELECT DISTINCT category FROM meme_groups ORDER BY category")
        return [r["category"] for r in rows]
    return await cache.get_or_set(NS, "list", "categories", None, 300, _fetch)


@router.get("/groups", response_model=list[MemeGroupResponse])
async def list_groups(category: Optional[str] = Query(None)):
    params = {"c": category} if category else None

    async def _fetch():
        db = await get_db()
        q = """
            SELECT g.*, COUNT(m.id) AS meme_count,
                   (SELECT image_url FROM memes WHERE group_id = g.id ORDER BY sort_order LIMIT 1) AS thumbnail
            FROM meme_groups g
            LEFT JOIN memes m ON m.group_id = g.id
        """
        args = []
        if category:
            q += " WHERE g.category = $1"
            args.append(category)
        q += " GROUP BY g.id ORDER BY g.sort_order, g.created_at"
        rows = await db.fetch(q, *args)
        return [_row_to_group(r, r["meme_count"], r.get("thumbnail")).model_dump(mode="json") for r in rows]

    return await cache.get_or_set(NS, "list", "groups", params, 300, _fetch)


@router.get("/groups/{slug}", response_model=MemeGroupWithMemes)
async def get_group(slug: str):
    async def _fetch():
        db = await get_db()
        row = await db.fetchrow(
            """
            SELECT g.*, COUNT(m.id) AS meme_count,
                   (SELECT image_url FROM memes WHERE group_id = g.id ORDER BY sort_order LIMIT 1) AS thumbnail
            FROM meme_groups g
            LEFT JOIN memes m ON m.group_id = g.id
            WHERE g.slug = $1
            GROUP BY g.id
            """,
            slug,
        )
        if not row:
            return None
        meme_rows = await db.fetch(
            "SELECT * FROM memes WHERE group_id = $1 ORDER BY sort_order", row["id"]
        )
        group = MemeGroupWithMemes(
            **_row_to_group(row, row["meme_count"], row.get("thumbnail")).model_dump(),
            memes=[_row_to_meme(m) for m in meme_rows],
        )
        return group.model_dump(mode="json")

    result = await cache.get_or_set(NS, "group", slug, None, 300, _fetch)
    if result is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return result


# ── Click-tracking redirect ───────────────────────────────────────────────────

def _client_ip(request: Request) -> Optional[str]:
    """Return real client IP from proxy headers, falling back to TCP peer."""
    if ip := request.headers.get("x-real-ip", "").strip():
        return ip
    if fwd := request.headers.get("x-forwarded-for", "").strip():
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


async def _log_click(
    db,
    meme_id: str,
    user_id: Optional[str],
    ip_address: Optional[str],
    user_agent: str,
    referrer: Optional[str],
) -> None:
    """Fire-and-forget coroutine — insert one row into meme_clicks."""
    await db.execute(
        """INSERT INTO meme_clicks (meme_id, user_id, ip_address, user_agent, referrer)
           VALUES ($1, $2, $3, $4, $5)""",
        meme_id, user_id, ip_address, user_agent, referrer,
    )


@redirect_router.get("/r/{meme_id}")
async def redirect_meme(meme_id: str, request: Request):
    """
    Transparent redirect with click tracking for email campaigns.
    No auth required — works for all visitors including unauthenticated.
    """
    db = await get_db()
    row = await db.fetchrow("SELECT id, link_url FROM memes WHERE id = $1", meme_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Meme not found")

    # Resolve destination
    destination = row["link_url"] or "/"

    # Extract user_id from JWT cookie if present — any error → None
    user_id: Optional[str] = None
    token = request.cookies.get(_COOKIE_NAME)
    if token:
        try:
            payload = decode_access_token(token)
            if payload:
                user_id = payload.get("sub")
        except Exception:
            pass

    # Collect request metadata
    ip = _client_ip(request)
    ua = request.headers.get("user-agent", "")[:500]
    referrer = request.headers.get("referer", "")[:500] or None

    # Fire-and-forget: do not block the redirect on the DB write
    asyncio.create_task(_log_click(db, meme_id, user_id, ip, ua, referrer))

    return RedirectResponse(url=destination, status_code=302)
