from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from memes.schemas import MemeGroupResponse, MemeGroupWithMemes, MemeResponse
from database import get_db
import cache

router = APIRouter()

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
