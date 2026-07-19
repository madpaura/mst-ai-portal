import json
import math
import os

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from typing import Optional

from video.schemas import (
    CourseResponse, CourseCreate, CourseUpdate,
    CourseModuleResponse, CourseModuleCreate, CourseModuleUpdate,
    CourseItemResponse, CourseItemCreate, CourseItemUpdate,
    CurriculumResponse, ReorderRequest, CurriculumPublishRequest,
    ItemLink, ITEM_TYPES,
)
from auth.dependencies import require_content as require_admin
from config import settings
from database import get_db
from video.course_email import generate_email_preview
from email_utils.utils import send_email_multi
import cache

router = APIRouter()


def _course_resp(
    row, video_count: int = 0, thumbnail: Optional[str] = None,
    module_count: int = 0, item_count: int = 0,
) -> CourseResponse:
    return CourseResponse(
        id=str(row["id"]), title=row["title"], slug=row["slug"],
        description=row.get("description"), sort_order=row["sort_order"],
        video_count=video_count, thumbnail=thumbnail,
        is_featured=row.get("is_featured", False),
        level=row.get("level"), tags=list(row.get("tags") or []),
        cover_image=row.get("cover_image"),
        objectives=list(row.get("objectives") or []),
        prerequisites=row.get("prerequisites"),
        curriculum_published=row.get("curriculum_published", False),
        module_count=module_count, item_count=item_count,
    )


def _parse_links(raw) -> list[ItemLink]:
    data = raw if isinstance(raw, list) else json.loads(raw or "[]")
    return [ItemLink(**l) for l in data]


def _item_resp(row) -> CourseItemResponse:
    return CourseItemResponse(
        id=str(row["id"]), module_id=str(row["module_id"]),
        item_type=row["item_type"], title=row["title"],
        description=row.get("description"), duration_min=row.get("duration_min") or 0,
        video_id=str(row["video_id"]) if row.get("video_id") else None,
        video_slug=row.get("video_slug"), video_title=row.get("video_title"),
        external_url=row.get("external_url"), links=_parse_links(row.get("links")),
        sort_order=row.get("sort_order") or 0,
    )


async def _video_duration_min(db, video_id: str) -> Optional[int]:
    dur_s = await db.fetchval(
        "SELECT duration_s FROM videos WHERE id = $1", video_id
    )
    if dur_s is None:
        return None
    return max(1, math.ceil(dur_s / 60))


@router.get("/courses", response_model=list[CourseResponse])
async def admin_list_courses(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT c.*,
               COUNT(DISTINCT m.id) AS module_count,
               COUNT(i.id) AS item_count
        FROM courses c
        LEFT JOIN course_modules m ON m.course_id = c.id
        LEFT JOIN course_items i ON i.module_id = m.id
        GROUP BY c.id
        ORDER BY c.sort_order
        """
    )
    return [_course_resp(r, module_count=r["module_count"], item_count=r["item_count"]) for r in rows]


@router.get("/courses/{course_id}", response_model=CourseResponse)
async def admin_get_course(course_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM courses WHERE id = $1", course_id)
    if not row:
        raise HTTPException(status_code=404, detail="Course not found")
    return _course_resp(row)


@router.post("/courses", response_model=CourseResponse)
async def admin_create_course(req: CourseCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await db.fetchrow("SELECT id FROM courses WHERE slug = $1", req.slug)
    if existing:
        raise HTTPException(status_code=409, detail="Slug already exists")

    # Only one course can be featured at a time — clear others first.
    if req.is_featured:
        await db.execute("UPDATE courses SET is_featured = FALSE WHERE is_featured = TRUE")

    row = await db.fetchrow(
        """
        INSERT INTO courses (title, slug, description, sort_order, is_featured,
                             level, tags, objectives, prerequisites)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
        """,
        req.title, req.slug, req.description, req.sort_order, req.is_featured,
        req.level, req.tags, req.objectives, req.prerequisites,
    )
    await cache.bump_version(cache.NS_VIDEO)
    return _course_resp(row)


@router.put("/courses/{course_id}", response_model=CourseResponse)
async def admin_update_course(
    course_id: str, req: CourseUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM courses WHERE id = $1", course_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Course not found")

    # Only fields explicitly sent are updated, so provided nulls can clear
    # optional metadata (level, prerequisites, …).
    fields = req.model_dump(exclude_unset=True)

    # Only one course can be featured at a time — clear others before setting.
    if fields.get("is_featured") is True:
        await db.execute(
            "UPDATE courses SET is_featured = FALSE WHERE is_featured = TRUE AND id <> $1",
            course_id,
        )

    if fields:
        set_parts = []
        params = [course_id]
        idx = 2
        for k, v in fields.items():
            set_parts.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        set_clause = ", ".join(set_parts)
        await db.execute(f"UPDATE courses SET {set_clause} WHERE id = $1", *params)

    row = await db.fetchrow("SELECT * FROM courses WHERE id = $1", course_id)
    await cache.bump_version(cache.NS_VIDEO)
    return _course_resp(row)


@router.delete("/courses/{course_id}")
async def admin_delete_course(course_id: str, admin: dict = Depends(require_admin)):
    """Delete a curriculum course. Videos are never owned by a course directly
    (issue #243: that's what video_series/series_id is for) — deleting a
    course only cascades its own modules/items/feedback/enrollments."""
    db = await get_db()
    course = await db.fetchrow("SELECT * FROM courses WHERE id = $1", course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    await db.execute("DELETE FROM courses WHERE id = $1", course_id)
    await cache.bump_version(cache.NS_VIDEO)
    return {"message": "Course deleted"}


# ── Cover image ─────────────────────────────────────────────

@router.post("/courses/{course_id}/cover")
async def admin_upload_course_cover(
    course_id: str, file: UploadFile = File(...), admin: dict = Depends(require_admin)
):
    db = await get_db()
    course = await db.fetchrow("SELECT id FROM courses WHERE id = $1", course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        raise HTTPException(status_code=400, detail="Cover must be a .jpg, .png or .webp image")

    dir_path = os.path.join(settings.MEDIA_STORAGE_PATH, "courses", course_id)
    os.makedirs(dir_path, exist_ok=True)
    # One cover per course — drop any previous file with a different extension.
    for old in os.listdir(dir_path):
        if old.startswith("cover"):
            os.remove(os.path.join(dir_path, old))

    file_path = os.path.join(dir_path, f"cover{ext}")
    with open(file_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    url = f"/media/courses/{course_id}/cover{ext}"
    await db.execute("UPDATE courses SET cover_image = $1 WHERE id = $2", url, course_id)
    await cache.bump_version(cache.NS_VIDEO)
    return {"message": "Cover uploaded", "path": url}


# ── Curriculum (issue #239): weekly modules + items ─────────

_ITEM_SELECT = """
    SELECT i.*, v.slug AS video_slug, v.title AS video_title
    FROM course_items i
    LEFT JOIN videos v ON v.id = i.video_id
"""


async def _fetch_curriculum(db, course_row) -> CurriculumResponse:
    course_id = str(course_row["id"])
    mod_rows = await db.fetch(
        "SELECT * FROM course_modules WHERE course_id = $1 ORDER BY sort_order, week_number",
        course_id,
    )
    item_rows = await db.fetch(
        _ITEM_SELECT + """
        WHERE i.module_id IN (SELECT id FROM course_modules WHERE course_id = $1)
        ORDER BY i.sort_order
        """,
        course_id,
    )
    items_by_module: dict[str, list[CourseItemResponse]] = {}
    for r in item_rows:
        items_by_module.setdefault(str(r["module_id"]), []).append(_item_resp(r))

    modules = []
    total = 0
    count = 0
    for m in mod_rows:
        items = items_by_module.get(str(m["id"]), [])
        week_total = sum(i.duration_min for i in items)
        total += week_total
        count += len(items)
        modules.append(CourseModuleResponse(
            id=str(m["id"]), course_id=course_id, week_number=m["week_number"],
            title=m["title"], summary=m.get("summary"),
            sort_order=m.get("sort_order") or 0,
            total_duration_min=week_total, items=items,
        ))
    return CurriculumResponse(
        course_id=course_id,
        curriculum_published=course_row.get("curriculum_published", False),
        total_duration_min=total, item_count=count, modules=modules,
    )


@router.get("/courses/{course_id}/curriculum", response_model=CurriculumResponse)
async def admin_get_curriculum(course_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    course = await db.fetchrow("SELECT * FROM courses WHERE id = $1", course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return await _fetch_curriculum(db, course)


@router.post("/courses/{course_id}/curriculum/modules", response_model=CourseModuleResponse)
async def admin_create_module(
    course_id: str, req: CourseModuleCreate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    course = await db.fetchrow("SELECT id FROM courses WHERE id = $1", course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    next_pos = await db.fetchval(
        "SELECT COALESCE(MAX(week_number), 0) + 1 FROM course_modules WHERE course_id = $1",
        course_id,
    )
    row = await db.fetchrow(
        """
        INSERT INTO course_modules (course_id, week_number, title, summary, sort_order)
        VALUES ($1, $2, $3, $4, $2) RETURNING *
        """,
        course_id, next_pos, req.title, req.summary,
    )
    await cache.bump_version(cache.NS_VIDEO)
    return CourseModuleResponse(
        id=str(row["id"]), course_id=course_id, week_number=row["week_number"],
        title=row["title"], summary=row.get("summary"),
        sort_order=row.get("sort_order") or 0,
    )


@router.put("/curriculum/modules/{module_id}", response_model=CourseModuleResponse)
async def admin_update_module(
    module_id: str, req: CourseModuleUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM course_modules WHERE id = $1", module_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Module not found")

    fields = req.model_dump(exclude_unset=True)
    if "title" in fields and not (fields["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Module title cannot be empty")
    if fields:
        set_parts = []
        params = [module_id]
        idx = 2
        for k, v in fields.items():
            set_parts.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        await db.execute(
            f"UPDATE course_modules SET {', '.join(set_parts)} WHERE id = $1", *params
        )

    row = await db.fetchrow("SELECT * FROM course_modules WHERE id = $1", module_id)
    await cache.bump_version(cache.NS_VIDEO)
    return CourseModuleResponse(
        id=str(row["id"]), course_id=str(row["course_id"]), week_number=row["week_number"],
        title=row["title"], summary=row.get("summary"),
        sort_order=row.get("sort_order") or 0,
    )


@router.delete("/curriculum/modules/{module_id}")
async def admin_delete_module(module_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT course_id FROM course_modules WHERE id = $1", module_id)
    if not row:
        raise HTTPException(status_code=404, detail="Module not found")
    await db.execute("DELETE FROM course_modules WHERE id = $1", module_id)
    await _renumber_modules(db, str(row["course_id"]))
    await cache.bump_version(cache.NS_VIDEO)
    return {"message": "Module deleted"}


async def _renumber_modules(db, course_id: str, ordered_ids: Optional[list[str]] = None):
    """Renumber weeks 1..N (optionally in the given order)."""
    if ordered_ids is None:
        rows = await db.fetch(
            "SELECT id FROM course_modules WHERE course_id = $1 ORDER BY sort_order, week_number",
            course_id,
        )
        ordered_ids = [str(r["id"]) for r in rows]
    for pos, mid in enumerate(ordered_ids, start=1):
        await db.execute(
            "UPDATE course_modules SET week_number = $2, sort_order = $2 WHERE id = $1 AND course_id = $3",
            mid, pos, course_id,
        )


@router.put("/courses/{course_id}/curriculum/modules/reorder")
async def admin_reorder_modules(
    course_id: str, req: ReorderRequest, admin: dict = Depends(require_admin)
):
    db = await get_db()
    rows = await db.fetch("SELECT id FROM course_modules WHERE course_id = $1", course_id)
    existing_ids = {str(r["id"]) for r in rows}
    if set(req.ids) != existing_ids:
        raise HTTPException(status_code=400, detail="ids must be exactly the course's module ids")
    await _renumber_modules(db, course_id, req.ids)
    await cache.bump_version(cache.NS_VIDEO)
    return {"message": "Modules reordered"}


# ── Items ──

async def _resolve_item_fields(db, req_fields: dict) -> dict:
    """Validate video linkage and inherit duration from the linked video
    when the author didn't set one explicitly."""
    video_id = req_fields.get("video_id")
    if video_id:
        dur = await _video_duration_min(db, video_id)
        if dur is None:
            exists = await db.fetchval("SELECT 1 FROM videos WHERE id = $1", video_id)
            if not exists:
                raise HTTPException(status_code=404, detail="Linked video not found")
        if not req_fields.get("duration_min") and dur:
            req_fields["duration_min"] = dur
    if "links" in req_fields and req_fields["links"] is not None:
        req_fields["links"] = json.dumps([
            l if isinstance(l, dict) else l.model_dump() for l in req_fields["links"]
        ])
    return req_fields


@router.post("/curriculum/modules/{module_id}/items", response_model=CourseItemResponse)
async def admin_create_item(
    module_id: str, req: CourseItemCreate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    module = await db.fetchrow("SELECT id FROM course_modules WHERE id = $1", module_id)
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")
    if req.item_type not in ITEM_TYPES:
        raise HTTPException(status_code=400, detail=f"item_type must be one of {ITEM_TYPES}")
    if req.item_type == "video" and not req.video_id:
        raise HTTPException(status_code=400, detail="Video items need a linked video")

    fields = await _resolve_item_fields(db, req.model_dump())
    next_sort = await db.fetchval(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM course_items WHERE module_id = $1",
        module_id,
    )
    row = await db.fetchrow(
        """
        INSERT INTO course_items (module_id, item_type, title, description,
                                  duration_min, video_id, external_url, links, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
        RETURNING id
        """,
        module_id, fields["item_type"], fields["title"], fields.get("description"),
        fields.get("duration_min") or 0, fields.get("video_id"),
        fields.get("external_url"), fields.get("links") or "[]", next_sort,
    )
    full = await db.fetchrow(_ITEM_SELECT + "WHERE i.id = $1", row["id"])
    await cache.bump_version(cache.NS_VIDEO)
    return _item_resp(full)


@router.put("/curriculum/items/{item_id}", response_model=CourseItemResponse)
async def admin_update_item(
    item_id: str, req: CourseItemUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM course_items WHERE id = $1", item_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Item not found")

    fields = req.model_dump(exclude_unset=True)
    if "title" in fields and not (fields["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Item title cannot be empty")
    if existing["item_type"] == "video" and fields.get("video_id", "keep") is None:
        raise HTTPException(status_code=400, detail="Video items need a linked video")
    fields = await _resolve_item_fields(db, fields)

    if fields:
        set_parts = []
        params = [item_id]
        idx = 2
        for k, v in fields.items():
            cast = "::jsonb" if k == "links" else ""
            set_parts.append(f"{k} = ${idx}{cast}")
            params.append(v)
            idx += 1
        await db.execute(
            f"UPDATE course_items SET {', '.join(set_parts)} WHERE id = $1", *params
        )

    full = await db.fetchrow(_ITEM_SELECT + "WHERE i.id = $1", item_id)
    await cache.bump_version(cache.NS_VIDEO)
    return _item_resp(full)


@router.delete("/curriculum/items/{item_id}")
async def admin_delete_item(item_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT id FROM course_items WHERE id = $1", item_id)
    if not row:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.execute("DELETE FROM course_items WHERE id = $1", item_id)
    await cache.bump_version(cache.NS_VIDEO)
    return {"message": "Item deleted"}


@router.put("/curriculum/modules/{module_id}/items/reorder")
async def admin_reorder_items(
    module_id: str, req: ReorderRequest, admin: dict = Depends(require_admin)
):
    db = await get_db()
    rows = await db.fetch("SELECT id FROM course_items WHERE module_id = $1", module_id)
    existing_ids = {str(r["id"]) for r in rows}
    if set(req.ids) != existing_ids:
        raise HTTPException(status_code=400, detail="ids must be exactly the module's item ids")
    for pos, iid in enumerate(req.ids):
        await db.execute(
            "UPDATE course_items SET sort_order = $2 WHERE id = $1 AND module_id = $3",
            iid, pos, module_id,
        )
    await cache.bump_version(cache.NS_VIDEO)
    return {"message": "Items reordered"}


# ── Publish gate ──

@router.post("/courses/{course_id}/curriculum/publish", response_model=CourseResponse)
async def admin_publish_curriculum(
    course_id: str, req: CurriculumPublishRequest, admin: dict = Depends(require_admin)
):
    db = await get_db()
    course = await db.fetchrow("SELECT * FROM courses WHERE id = $1", course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    if req.published:
        item_count = await db.fetchval(
            """
            SELECT COUNT(*) FROM course_items i
            JOIN course_modules m ON m.id = i.module_id
            WHERE m.course_id = $1
            """,
            course_id,
        )
        if not item_count:
            raise HTTPException(
                status_code=400,
                detail="Add at least one week with one item before publishing the curriculum",
            )

    await db.execute(
        "UPDATE courses SET curriculum_published = $2 WHERE id = $1",
        course_id, req.published,
    )
    row = await db.fetchrow("SELECT * FROM courses WHERE id = $1", course_id)
    await cache.bump_version(cache.NS_VIDEO)
    return _course_resp(row)


# ── Email (send a course's full curriculum as a newsletter-style email) ─────

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


@router.post("/courses/{course_id}/email-preview", response_model=EmailPreviewResponse)
async def admin_course_email_preview(
    course_id: str, req: EmailPreviewRequest, admin: dict = Depends(require_admin)
):
    try:
        preview = await generate_email_preview(course_id, req.custom_content or None)
        return EmailPreviewResponse(**preview)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate preview: {str(e)}")


@router.post("/courses/{course_id}/send-email", response_model=SendEmailResponse)
async def admin_course_send_email(
    course_id: str, req: SendEmailRequest, admin: dict = Depends(require_admin)
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
