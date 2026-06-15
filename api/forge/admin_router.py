from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from pydantic import BaseModel

from forge.schemas import ForgeComponentResponse, ForgeComponentCreate, ForgeComponentUpdate
from forge.email import generate_email_preview
from email_utils.utils import send_email_multi
from auth.dependencies import require_content as require_admin
from database import get_db
import cache

router = APIRouter()


def _generate_howto_from_install_cmd(name: str, slug: str, install_command: str) -> str:
    """Return a minimal how-to guide when none was provided, based on the install command."""
    return (
        f"## How to Install {name}\n\n"
        f"```bash\n{install_command}\n```\n\n"
        f"### Verify\n\n"
        f"```bash\nnpx skills list --agent claude-code\n```\n\n"
        f"### Update\n\n"
        f"```bash\nnpx skills update {slug}\n```\n\n"
        f"### Remove\n\n"
        f"```bash\nnpx skills remove {slug}\n```\n"
    )


def _row_to_component(r) -> ForgeComponentResponse:
    return ForgeComponentResponse(
        id=str(r["id"]), slug=r["slug"], name=r["name"],
        component_type=r["component_type"], description=r.get("description"),
        long_description=r.get("long_description"), icon=r.get("icon"),
        icon_color=r.get("icon_color"), version=r["version"],
        install_command=r["install_command"], badge=r.get("badge"),
        author=r.get("author"), downloads=r["downloads"],
        tags=list(r["tags"]) if r["tags"] else [],
        is_active=r["is_active"],
        howto_guide=r.get("howto_guide"),
        howto_guide_url=r.get("howto_guide_url"),
        video_url=r.get("video_url"),
        manual_install=r.get("manual_install"),
        creator_user_id=str(r["creator_user_id"]) if r.get("creator_user_id") else None,
        created_at=r["created_at"],
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

    # Auto-generate howto_guide if not provided (Issue #167)
    howto_guide = req.howto_guide
    if not howto_guide:
        howto_guide = _generate_howto_from_install_cmd(req.name, req.slug, req.install_command)

    row = await db.fetchrow(
        """
        INSERT INTO forge_components
            (slug, name, component_type, description, long_description, icon, icon_color,
             version, install_command, badge, author, tags, howto_guide, howto_guide_url, video_url,
             manual_install, creator_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        RETURNING *
        """,
        req.slug, req.name, req.component_type, req.description,
        req.long_description, req.icon, req.icon_color, req.version,
        req.install_command, req.badge, req.author, req.tags,
        howto_guide, req.howto_guide_url, req.video_url,
        req.manual_install, admin["id"],
    )
    await cache.bump_version(cache.NS_FORGE)
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
    # Allow explicit null to clear these fields
    for field in ["howto_guide", "howto_guide_url", "video_url", "manual_install"]:
        if field in req.model_fields_set:
            fields[field] = getattr(req, field)

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
    await cache.bump_version(cache.NS_FORGE)
    return _row_to_component(row)


@router.delete("/components")
async def admin_delete_all_components(admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute("DELETE FROM forge_components")
    count = int(result.split()[-1]) if result else 0
    await cache.bump_version(cache.NS_FORGE)
    return {"message": f"Deleted {count} component(s)"}


@router.delete("/components/{component_id}")
async def admin_delete_component(component_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute(
        "DELETE FROM forge_components WHERE id = $1",
        component_id,
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Component not found")
    await cache.bump_version(cache.NS_FORGE)
    return {"message": "Component deleted"}


@router.post("/components/{component_id}/activate")
async def admin_activate_component(component_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    await db.execute(
        "UPDATE forge_components SET is_active = true, updated_at = now() WHERE id = $1",
        component_id,
    )
    await cache.bump_version(cache.NS_FORGE)
    return {"message": "Component activated"}


@router.post("/components/{component_id}/deactivate")
async def admin_deactivate_component(component_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    await db.execute(
        "UPDATE forge_components SET is_active = false, updated_at = now() WHERE id = $1",
        component_id,
    )
    await cache.bump_version(cache.NS_FORGE)
    return {"message": "Component deactivated"}


# ── Email (send an individual marketplace component as a newsletter email) ─────

class EmailPreviewRequest(BaseModel):
    custom_content: str = ""


class EmailPreviewResponse(BaseModel):
    subject: str
    html_content: str
    plain_text: str


class SendEmailRequest(BaseModel):
    recipient_emails: list[str]
    subject: str
    html_content: str
    plain_text: str = ""


class SendEmailResponse(BaseModel):
    success: bool
    message: str
    sent_count: int = 0


@router.post("/components/{component_id}/email-preview", response_model=EmailPreviewResponse)
async def admin_component_email_preview(
    component_id: str, req: EmailPreviewRequest, admin: dict = Depends(require_admin)
):
    try:
        preview = await generate_email_preview(component_id, req.custom_content or None)
        return EmailPreviewResponse(**preview)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate preview: {str(e)}")


@router.post("/components/{component_id}/send-email", response_model=SendEmailResponse)
async def admin_component_send_email(
    component_id: str, req: SendEmailRequest, admin: dict = Depends(require_admin)
):
    try:
        total = len(req.recipient_emails)
        success = await send_email_multi(
            subject=req.subject,
            html_content=req.html_content,
            plain_text=req.plain_text or None,
            bcc_emails=req.recipient_emails,
        )
        if success:
            return SendEmailResponse(success=True, message=f"Email sent to {total} recipient(s)", sent_count=total)
        return SendEmailResponse(success=False, message="Failed to send email — check SMTP settings", sent_count=0)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Email send error: {str(e)}")
