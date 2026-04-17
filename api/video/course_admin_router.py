from fastapi import APIRouter, HTTPException, Depends

from video.schemas import CourseResponse, CourseCreate, CourseUpdate
from auth.dependencies import require_content as require_admin
from database import get_db, get_read_db

router = APIRouter()


@router.get("/courses", response_model=list[CourseResponse])
async def admin_list_courses(admin: dict = Depends(require_admin)):
    db = await get_read_db()
    rows = await db.fetch(
        """
        SELECT c.*, COUNT(v.id) as video_count
        FROM courses c
        LEFT JOIN videos v ON v.course_id = c.id
        GROUP BY c.id
        ORDER BY c.sort_order
        """
    )
    return [
        CourseResponse(
            id=str(r["id"]), title=r["title"], slug=r["slug"],
            description=r.get("description"), sort_order=r["sort_order"],
            video_count=r["video_count"],
        )
        for r in rows
    ]


@router.post("/courses", response_model=CourseResponse)
async def admin_create_course(req: CourseCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await db.fetchrow("SELECT id FROM courses WHERE slug = $1", req.slug)
    if existing:
        raise HTTPException(status_code=409, detail="Slug already exists")

    row = await db.fetchrow(
        "INSERT INTO courses (title, slug, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING *",
        req.title, req.slug, req.description, req.sort_order,
    )
    return CourseResponse(
        id=str(row["id"]), title=row["title"], slug=row["slug"],
        description=row.get("description"), sort_order=row["sort_order"],
        video_count=0,
    )


@router.put("/courses/{course_id}", response_model=CourseResponse)
async def admin_update_course(
    course_id: str, req: CourseUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM courses WHERE id = $1", course_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Course not found")

    fields = {}
    for field in ["title", "slug", "description", "sort_order"]:
        val = getattr(req, field, None)
        if val is not None:
            fields[field] = val

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

    row = await db.fetchrow(
        """
        SELECT c.*, COUNT(v.id) as video_count
        FROM courses c
        LEFT JOIN videos v ON v.course_id = c.id
        WHERE c.id = $1
        GROUP BY c.id
        """,
        course_id,
    )
    return CourseResponse(
        id=str(row["id"]), title=row["title"], slug=row["slug"],
        description=row.get("description"), sort_order=row["sort_order"],
        video_count=row["video_count"],
    )


@router.delete("/courses/{course_id}")
async def admin_delete_course(course_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    videos = await db.fetchval(
        "SELECT COUNT(*) FROM videos WHERE course_id = $1 AND is_active = true", course_id
    )
    if videos and videos > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete course with {videos} active video(s). Reassign or delete them first.",
        )
    await db.execute("UPDATE courses SET is_active = false WHERE id = $1", course_id)
    return {"message": "Course deactivated"}
