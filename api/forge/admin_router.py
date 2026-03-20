from fastapi import APIRouter, HTTPException, Depends

from forge.schemas import ForgeComponentResponse, ForgeComponentCreate, ForgeComponentUpdate
from auth.dependencies import require_admin
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
async def admin_list_components(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch("SELECT * FROM forge_components ORDER BY name ASC")
    return [_row_to_component(r) for r in rows]


@router.post("/components", response_model=ForgeComponentResponse)
async def admin_create_component(req: ForgeComponentCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await db.fetchrow("SELECT id FROM forge_components WHERE slug = $1", req.slug)
    if existing:
        raise HTTPException(status_code=409, detail="Slug already exists")

    row = await db.fetchrow(
        """
        INSERT INTO forge_components
            (slug, name, component_type, description, long_description, icon, icon_color,
             version, install_command, badge, author, tags)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *
        """,
        req.slug, req.name, req.component_type, req.description,
        req.long_description, req.icon, req.icon_color, req.version,
        req.install_command, req.badge, req.author, req.tags,
    )
    return _row_to_component(row)


@router.get("/components/{component_id}", response_model=ForgeComponentResponse)
async def admin_get_component(component_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM forge_components WHERE id = $1", component_id)
    if not row:
        raise HTTPException(status_code=404, detail="Component not found")
    return _row_to_component(row)


@router.put("/components/{component_id}", response_model=ForgeComponentResponse)
async def admin_update_component(
    component_id: str, req: ForgeComponentUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM forge_components WHERE id = $1", component_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Component not found")

    fields = {}
    for field in ["name", "description", "long_description", "icon", "icon_color",
                   "version", "install_command", "badge", "author", "tags"]:
        val = getattr(req, field, None)
        if val is not None:
            fields[field] = val

    if fields:
        fields["updated_at"] = "now()"
        set_parts = []
        params = [component_id]
        idx = 2
        for k, v in fields.items():
            if v == "now()":
                set_parts.append(f"{k} = now()")
            else:
                set_parts.append(f"{k} = ${idx}")
                params.append(v)
                idx += 1
        set_clause = ", ".join(set_parts)
        await db.execute(f"UPDATE forge_components SET {set_clause} WHERE id = $1", *params)

    row = await db.fetchrow("SELECT * FROM forge_components WHERE id = $1", component_id)
    return _row_to_component(row)


@router.delete("/components/{component_id}")
async def admin_delete_component(component_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute(
        "DELETE FROM forge_components WHERE id = $1",
        component_id,
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Component not found")
    return {"message": "Component deleted"}


@router.post("/components/{component_id}/activate")
async def admin_activate_component(component_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    await db.execute(
        "UPDATE forge_components SET is_active = true, updated_at = now() WHERE id = $1",
        component_id,
    )
    return {"message": "Component activated"}


@router.post("/components/{component_id}/deactivate")
async def admin_deactivate_component(component_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    await db.execute(
        "UPDATE forge_components SET is_active = false, updated_at = now() WHERE id = $1",
        component_id,
    )
    return {"message": "Component deactivated"}
