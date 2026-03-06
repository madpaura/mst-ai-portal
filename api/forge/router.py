from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional

from forge.schemas import ForgeComponentResponse, ForgeCategoryResponse
from auth.dependencies import get_optional_user
from database import get_db

router = APIRouter()


def _row_to_component(r) -> ForgeComponentResponse:
    return ForgeComponentResponse(
        id=str(r["id"]), slug=r["slug"], name=r["name"],
        component_type=r["component_type"], description=r.get("description"),
        long_description=r.get("long_description"), icon=r.get("icon"),
        icon_color=r.get("icon_color"), version=r["version"],
        install_command=r["install_command"], badge=r.get("badge"),
        author=r.get("author"), downloads=r["downloads"],
        tags=list(r["tags"]) if r["tags"] else [],
        is_active=r["is_active"], created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


@router.get("/components", response_model=list[ForgeComponentResponse])
async def list_components(
    type: Optional[str] = Query(None, alias="type"),
    badge: Optional[str] = None,
    q: Optional[str] = None,
):
    db = await get_db()
    conditions = ["is_active = true"]
    params = []
    idx = 1

    if type:
        conditions.append(f"component_type = ${idx}")
        params.append(type)
        idx += 1

    if badge:
        conditions.append(f"badge = ${idx}")
        params.append(badge)
        idx += 1

    if q:
        conditions.append(
            f"to_tsvector('english', name || ' ' || COALESCE(description, '')) @@ plainto_tsquery('english', ${idx})"
        )
        params.append(q)
        idx += 1

    where = " AND ".join(conditions)
    rows = await db.fetch(
        f"SELECT * FROM forge_components WHERE {where} ORDER BY downloads DESC, name ASC",
        *params,
    )
    return [_row_to_component(r) for r in rows]


@router.get("/components/{slug}", response_model=ForgeComponentResponse)
async def get_component(slug: str):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM forge_components WHERE slug = $1 AND is_active = true", slug
    )
    if not row:
        raise HTTPException(status_code=404, detail="Component not found")
    return _row_to_component(row)


@router.post("/components/{slug}/install")
async def install_component(slug: str, user: Optional[dict] = Depends(get_optional_user)):
    db = await get_db()
    comp = await db.fetchrow(
        "SELECT id FROM forge_components WHERE slug = $1 AND is_active = true", slug
    )
    if not comp:
        raise HTTPException(status_code=404, detail="Component not found")

    user_id = user["id"] if user else None
    await db.execute(
        "INSERT INTO forge_install_events (component_id, user_id) VALUES ($1, $2)",
        comp["id"], user_id,
    )
    await db.execute(
        "UPDATE forge_components SET downloads = downloads + 1 WHERE id = $1",
        comp["id"],
    )
    return {"message": "Install event recorded"}


@router.get("/categories", response_model=list[ForgeCategoryResponse])
async def list_categories():
    db = await get_db()
    rows = await db.fetch(
        "SELECT component_type, COUNT(*) as count FROM forge_components WHERE is_active = true GROUP BY component_type ORDER BY component_type"
    )
    return [ForgeCategoryResponse(component_type=r["component_type"], count=r["count"]) for r in rows]
