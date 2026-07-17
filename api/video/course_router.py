"""Public Courses section (issue #239, PR 2).

Browse and detail endpoints for courses with a published curriculum,
per-item progress writes (with auto-subscribe), and course feedback.
Enroll/unenroll reuses the existing /video/courses/{slug}/enroll routes.
"""
from fastapi import APIRouter, HTTPException, Depends

from video.schemas import (
    CourseCardResponse, CourseDetailResponse, CourseUserState,
    ItemProgressRequest, ItemProgressResponse,
    CourseFeedbackSubmit, CourseFeedbackResponse, CourseFeedbackAdminEntry,
)
from video.course_admin_router import _course_resp, _fetch_curriculum
from video import progress_engine
from auth.dependencies import get_current_user, get_optional_user, require_content
from database import get_db

router = APIRouter()


async def _published_course(db, slug: str):
    course = await db.fetchrow(
        "SELECT * FROM courses WHERE slug = $1 AND is_active = true AND curriculum_published = true",
        slug,
    )
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.get("", response_model=list[CourseCardResponse])
async def list_curriculum_courses(user: dict = Depends(get_optional_user)):
    """All courses with a published curriculum, as browse cards."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT c.id, c.slug, c.title, c.description, c.level, c.tags, c.cover_image,
               COUNT(DISTINCT m.id) AS week_count,
               COUNT(i.id) AS item_count,
               COALESCE(SUM(i.duration_min), 0) AS total_duration_min,
               fb.rating_avg, COALESCE(fb.rating_count, 0) AS rating_count
        FROM courses c
        LEFT JOIN course_modules m ON m.course_id = c.id
        LEFT JOIN course_items i ON i.module_id = m.id
        LEFT JOIN (
            SELECT course_id, ROUND(AVG(rating)::numeric, 1) AS rating_avg, COUNT(*) AS rating_count
            FROM course_feedback GROUP BY course_id
        ) fb ON fb.course_id = c.id
        WHERE c.is_active = true AND c.curriculum_published = true
        GROUP BY c.id, fb.rating_avg, fb.rating_count
        ORDER BY c.sort_order
        """
    )

    enrolled_ids: set[str] = set()
    if user:
        e_rows = await db.fetch(
            "SELECT course_id FROM user_course_enrollments WHERE user_id = $1", user["id"]
        )
        enrolled_ids = {str(r["course_id"]) for r in e_rows}

    cards = []
    for r in rows:
        cid = str(r["id"])
        card = CourseCardResponse(
            id=cid, slug=r["slug"], title=r["title"], description=r.get("description"),
            level=r.get("level"), tags=list(r.get("tags") or []),
            cover_image=r.get("cover_image"),
            week_count=r["week_count"], item_count=r["item_count"],
            total_duration_min=r["total_duration_min"],
            rating_avg=float(r["rating_avg"]) if r.get("rating_avg") is not None else None,
            rating_count=r["rating_count"],
            is_enrolled=cid in enrolled_ids,
        )
        if user and card.is_enrolled and card.item_count:
            progress = await progress_engine.course_progress(db, user["id"], cid)
            card.completed_items = progress["completed"]
            card.progress_pct = progress["pct"]
        cards.append(card)
    return cards


@router.get("/{slug}", response_model=CourseDetailResponse)
async def get_course_detail(slug: str, user: dict = Depends(get_optional_user)):
    db = await get_db()
    course = await _published_course(db, slug)
    course_id = str(course["id"])

    curriculum = await _fetch_curriculum(db, course)
    video_count = await db.fetchval(
        "SELECT COUNT(*) FROM videos WHERE course_id = $1 AND is_published = true AND is_active = true",
        course_id,
    )

    fb = await db.fetchrow(
        "SELECT ROUND(AVG(rating)::numeric, 1) AS avg, COUNT(*) AS cnt FROM course_feedback WHERE course_id = $1",
        course_id,
    )

    user_state = None
    if user:
        enrollment = await db.fetchrow(
            "SELECT enrolled_at FROM user_course_enrollments WHERE user_id = $1 AND course_id = $2",
            user["id"], course_id,
        )
        progress = await progress_engine.course_progress(db, user["id"], course_id)
        my_fb = await db.fetchrow(
            "SELECT rating, comment FROM course_feedback WHERE user_id = $1 AND course_id = $2",
            user["id"], course_id,
        )
        enrolled_at = enrollment["enrolled_at"] if enrollment else None
        user_state = CourseUserState(
            is_enrolled=enrollment is not None,
            enrolled_at=enrolled_at.isoformat() if enrolled_at else None,
            suggested_week=progress_engine.suggested_week(enrolled_at, len(curriculum.modules)),
            completed_item_ids=progress["completed_item_ids"],
            completed=progress["completed"], total=progress["total"], pct=progress["pct"],
            feedback_rating=my_fb["rating"] if my_fb else None,
            feedback_comment=my_fb.get("comment") if my_fb else None,
        )

    return CourseDetailResponse(
        course=_course_resp(course, video_count=video_count or 0),
        curriculum=curriculum,
        rating_avg=float(fb["avg"]) if fb and fb["avg"] is not None else None,
        rating_count=fb["cnt"] if fb else 0,
        user=user_state,
    )


@router.post("/{slug}/items/{item_id}/progress", response_model=ItemProgressResponse)
async def set_item_progress(
    slug: str, item_id: str, req: ItemProgressRequest,
    user: dict = Depends(get_current_user),
):
    """Mark an item complete/incomplete. First interaction auto-subscribes."""
    db = await get_db()
    course = await _published_course(db, slug)
    course_id = str(course["id"])

    item = await db.fetchrow(
        """
        SELECT i.id FROM course_items i
        JOIN course_modules m ON m.id = i.module_id
        WHERE i.id = $1 AND m.course_id = $2
        """,
        item_id, course_id,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found in this course")

    result = await progress_engine.set_item_progress(db, user["id"], item_id, req.completed)
    progress = await progress_engine.course_progress(db, user["id"], course_id)
    return ItemProgressResponse(
        item_id=item_id, completed=req.completed,
        auto_enrolled=result["auto_enrolled"],
        completed_items=progress["completed"], total_items=progress["total"],
        progress_pct=progress["pct"],
    )


@router.post("/{slug}/feedback", response_model=CourseFeedbackResponse)
async def submit_feedback(
    slug: str, req: CourseFeedbackSubmit, user: dict = Depends(get_current_user)
):
    """Upsert the user's rating + comment. Requires subscription."""
    db = await get_db()
    course = await _published_course(db, slug)

    enrolled = await db.fetchval(
        "SELECT 1 FROM user_course_enrollments WHERE user_id = $1 AND course_id = $2",
        user["id"], str(course["id"]),
    )
    if not enrolled:
        raise HTTPException(status_code=403, detail="Subscribe to the course to leave feedback")

    row = await db.fetchrow(
        """
        INSERT INTO course_feedback (user_id, course_id, rating, comment)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, course_id)
        DO UPDATE SET rating = $3, comment = $4, updated_at = now()
        RETURNING rating, comment, updated_at
        """,
        user["id"], str(course["id"]), req.rating, req.comment,
    )
    return CourseFeedbackResponse(
        rating=row["rating"], comment=row.get("comment"), updated_at=row.get("updated_at"),
    )


# ── Admin: full feedback listing (mounted under /admin) ─────

admin_feedback_router = APIRouter()


@admin_feedback_router.get(
    "/courses/{course_id}/feedback", response_model=list[CourseFeedbackAdminEntry]
)
async def admin_list_feedback(course_id: str, admin: dict = Depends(require_content)):
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT u.display_name, f.rating, f.comment, f.updated_at
        FROM course_feedback f
        JOIN users u ON u.id = f.user_id
        WHERE f.course_id = $1
        ORDER BY f.updated_at DESC
        """,
        course_id,
    )
    return [
        CourseFeedbackAdminEntry(
            user_display_name=r["display_name"], rating=r["rating"],
            comment=r.get("comment"), updated_at=r.get("updated_at"),
        )
        for r in rows
    ]
