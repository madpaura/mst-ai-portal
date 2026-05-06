from fastapi import APIRouter, HTTPException, Depends

from memes.schemas import (
    MemeGroupResponse, MemeGroupCreate, MemeGroupUpdate,
    MemeResponse, MemeCreate, MemeUpdate, MemeGroupWithMemes,
)
from auth.dependencies import require_content as require_admin
from database import get_db
import cache

router = APIRouter()

NS = cache.NS_MEMES


def _row_to_group(r, meme_count: int = 0, thumbnail=None) -> MemeGroupResponse:
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


# ── Groups ────────────────────────────────────────────────────────────────────

@router.get("/memes/groups", response_model=list[MemeGroupResponse])
async def admin_list_groups(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT g.*, COUNT(m.id) AS meme_count,
               (SELECT image_url FROM memes WHERE group_id = g.id ORDER BY sort_order LIMIT 1) AS thumbnail
        FROM meme_groups g
        LEFT JOIN memes m ON m.group_id = g.id
        GROUP BY g.id ORDER BY g.sort_order, g.created_at
        """
    )
    return [_row_to_group(r, r["meme_count"], r.get("thumbnail")) for r in rows]


@router.post("/memes/groups", response_model=MemeGroupResponse)
async def admin_create_group(req: MemeGroupCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await db.fetchrow("SELECT id FROM meme_groups WHERE slug = $1", req.slug)
    if existing:
        raise HTTPException(status_code=409, detail="Slug already exists")
    row = await db.fetchrow(
        "INSERT INTO meme_groups (title, slug, category, sort_order) VALUES ($1,$2,$3,$4) RETURNING *",
        req.title, req.slug, req.category, req.sort_order,
    )
    await cache.bump_version(NS)
    return _row_to_group(row)


@router.put("/memes/groups/{group_id}", response_model=MemeGroupResponse)
async def admin_update_group(group_id: str, req: MemeGroupUpdate, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM meme_groups WHERE id = $1", group_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Group not found")

    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if fields:
        set_parts, params = [], [group_id]
        for i, (k, v) in enumerate(fields.items(), start=2):
            set_parts.append(f"{k} = ${i}")
            params.append(v)
        await db.execute(f"UPDATE meme_groups SET {', '.join(set_parts)} WHERE id = $1", *params)

    row = await db.fetchrow(
        """
        SELECT g.*, COUNT(m.id) AS meme_count,
               (SELECT image_url FROM memes WHERE group_id = g.id ORDER BY sort_order LIMIT 1) AS thumbnail
        FROM meme_groups g LEFT JOIN memes m ON m.group_id = g.id
        WHERE g.id = $1 GROUP BY g.id
        """,
        group_id,
    )
    await cache.bump_version(NS)
    return _row_to_group(row, row["meme_count"], row.get("thumbnail"))


@router.delete("/memes/groups/{group_id}")
async def admin_delete_group(group_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await db.fetchrow("SELECT id FROM meme_groups WHERE id = $1", group_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Group not found")
    await db.execute("DELETE FROM meme_groups WHERE id = $1", group_id)
    await cache.bump_version(NS)
    return {"message": "Group deleted"}


# ── Memes within a group ──────────────────────────────────────────────────────

@router.get("/memes/groups/{group_id}/memes", response_model=list[MemeResponse])
async def admin_list_memes(group_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM memes WHERE group_id = $1 ORDER BY sort_order", group_id
    )
    return [_row_to_meme(r) for r in rows]


@router.post("/memes/groups/{group_id}/memes", response_model=MemeResponse)
async def admin_add_meme(group_id: str, req: MemeCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    group = await db.fetchrow("SELECT id FROM meme_groups WHERE id = $1", group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    row = await db.fetchrow(
        "INSERT INTO memes (group_id, title, image_url, link_url, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        group_id, req.title, req.image_url, req.link_url, req.sort_order,
    )
    await cache.bump_version(NS)
    return _row_to_meme(row)


@router.put("/memes/memes/{meme_id}", response_model=MemeResponse)
async def admin_update_meme(meme_id: str, req: MemeUpdate, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM memes WHERE id = $1", meme_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Meme not found")

    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if fields:
        set_parts, params = [], [meme_id]
        for i, (k, v) in enumerate(fields.items(), start=2):
            set_parts.append(f"{k} = ${i}")
            params.append(v)
        await db.execute(f"UPDATE memes SET {', '.join(set_parts)} WHERE id = $1", *params)

    row = await db.fetchrow("SELECT * FROM memes WHERE id = $1", meme_id)
    await cache.bump_version(NS)
    return _row_to_meme(row)


@router.delete("/memes/memes/{meme_id}")
async def admin_delete_meme(meme_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await db.fetchrow("SELECT id FROM memes WHERE id = $1", meme_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Meme not found")
    await db.execute("DELETE FROM memes WHERE id = $1", meme_id)
    await cache.bump_version(NS)
    return {"message": "Meme deleted"}


@router.post("/memes/groups/{group_id}/reorder")
async def admin_reorder_memes(
    group_id: str, order: list[str], admin: dict = Depends(require_admin)
):
    db = await get_db()
    for i, meme_id in enumerate(order):
        await db.execute(
            "UPDATE memes SET sort_order = $1 WHERE id = $2 AND group_id = $3",
            i, meme_id, group_id,
        )
    await cache.bump_version(NS)
    return {"message": "Reordered"}
