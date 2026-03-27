from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional

from video.schemas import (
    CourseResponse, VideoResponse, ChapterResponse, ProgressResponse,
    ProgressUpdate, OverallProgressResponse, NoteResponse, NoteCreate,
    NoteUpdate, HowtoResponse, VideoLikeResponse, AttachmentResponse,
)
from auth.dependencies import get_current_user, get_optional_user
from database import get_db

router = APIRouter()


@router.get("/courses", response_model=list[CourseResponse])
async def list_courses():
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT c.*, COUNT(v.id) FILTER (WHERE v.is_published = true AND v.is_active = true) as video_count
        FROM courses c
        LEFT JOIN videos v ON v.course_id = c.id
        WHERE c.is_active = true
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


@router.get("/courses/{slug}")
async def get_course(slug: str):
    db = await get_db()
    course = await db.fetchrow("SELECT * FROM courses WHERE slug = $1 AND is_active = true", slug)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    videos = await db.fetch(
        "SELECT * FROM videos WHERE course_id = $1 AND is_published = true AND is_active = true ORDER BY sort_order",
        course["id"],
    )
    return {
        "course": CourseResponse(
            id=str(course["id"]), title=course["title"], slug=course["slug"],
            description=course.get("description"), sort_order=course["sort_order"],
            video_count=len(videos),
        ),
        "videos": [
            VideoResponse(
                id=str(v["id"]), course_id=str(v["course_id"]) if v["course_id"] else None,
                title=v["title"], slug=v["slug"], description=v.get("description"),
                category=v["category"], duration_s=v.get("duration_s"),
                status=v["status"], hls_path=v.get("hls_path"),
                thumbnail=v.get("thumbnail"), is_published=v["is_published"],
                sort_order=v["sort_order"], created_at=v["created_at"],
            )
            for v in videos
        ],
    }


@router.get("/videos/{slug}", response_model=VideoResponse)
async def get_video(slug: str):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM videos WHERE slug = $1 AND is_published = true AND is_active = true",
        slug,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Video not found")
    return VideoResponse(
        id=str(row["id"]), course_id=str(row["course_id"]) if row["course_id"] else None,
        title=row["title"], slug=row["slug"], description=row.get("description"),
        category=row["category"], duration_s=row.get("duration_s"),
        status=row["status"], hls_path=row.get("hls_path"),
        thumbnail=row.get("thumbnail"), is_published=row["is_published"],
        sort_order=row["sort_order"], created_at=row["created_at"],
    )


@router.get("/videos/{slug}/attachments", response_model=list[AttachmentResponse])
async def get_video_attachments(slug: str):
    db = await get_db()
    video = await db.fetchrow(
        "SELECT id FROM videos WHERE slug = $1 AND is_published = true AND is_active = true", slug
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    rows = await db.fetch(
        "SELECT * FROM video_attachments WHERE video_id = $1 ORDER BY sort_order, created_at",
        video["id"],
    )
    return [
        AttachmentResponse(
            id=str(r["id"]),
            video_id=str(r["video_id"]),
            filename=r["filename"],
            display_name=r.get("display_name"),
            file_size=r["file_size"],
            mime_type=r.get("mime_type"),
            sort_order=r["sort_order"],
            download_url=f"/media/attachments/{r['video_id']}/{r['filename']}",
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.get("/videos/{slug}/chapters", response_model=list[ChapterResponse])
async def get_chapters(slug: str):
    db = await get_db()
    video = await db.fetchrow(
        "SELECT id FROM videos WHERE slug = $1 AND is_published = true AND is_active = true", slug
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    rows = await db.fetch(
        "SELECT * FROM video_chapters WHERE video_id = $1 ORDER BY sort_order, start_time",
        video["id"],
    )
    return [
        ChapterResponse(
            id=str(r["id"]), video_id=str(r["video_id"]),
            title=r["title"], start_time=r["start_time"], sort_order=r["sort_order"],
        )
        for r in rows
    ]


@router.get("/progress", response_model=OverallProgressResponse)
async def get_overall_progress(user: dict = Depends(get_current_user)):
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT
            v.category,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE p.completed = true) as done
        FROM videos v
        LEFT JOIN user_video_progress p ON p.video_id = v.id AND p.user_id = $1
        WHERE v.is_published = true AND v.is_active = true
        GROUP BY v.category
        """,
        user["id"],
    )
    total = sum(r["total"] for r in rows)
    completed = sum(r["done"] for r in rows)
    categories = [
        {"category": r["category"], "total": r["total"], "completed": r["done"]}
        for r in rows
    ]
    return OverallProgressResponse(
        completed_count=completed, total_count=total, categories=categories,
    )


@router.get("/progress/{video_slug}", response_model=ProgressResponse)
async def get_video_progress(video_slug: str, user: dict = Depends(get_current_user)):
    db = await get_db()
    video = await db.fetchrow("SELECT id FROM videos WHERE slug = $1", video_slug)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    row = await db.fetchrow(
        "SELECT * FROM user_video_progress WHERE user_id = $1 AND video_id = $2",
        user["id"], video["id"],
    )
    if not row:
        return ProgressResponse(
            video_id=str(video["id"]), watched_seconds=0,
            completed=False, last_position=0,
        )
    return ProgressResponse(
        video_id=str(row["video_id"]), watched_seconds=row["watched_seconds"],
        completed=row["completed"], last_position=row["last_position"],
    )


@router.put("/progress/{video_slug}", response_model=ProgressResponse)
async def update_video_progress(
    video_slug: str, req: ProgressUpdate, user: dict = Depends(get_current_user)
):
    db = await get_db()
    video = await db.fetchrow("SELECT id, duration_s FROM videos WHERE slug = $1", video_slug)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    completed = False
    if video["duration_s"] and req.watched_seconds >= (video["duration_s"] * 0.9):
        completed = True

    await db.execute(
        """
        INSERT INTO user_video_progress (user_id, video_id, watched_seconds, last_position, completed, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (user_id, video_id) DO UPDATE SET
            watched_seconds = GREATEST(user_video_progress.watched_seconds, $3),
            last_position = $4,
            completed = $5 OR user_video_progress.completed,
            updated_at = now()
        """,
        user["id"], video["id"], req.watched_seconds, req.last_position, completed,
    )

    row = await db.fetchrow(
        "SELECT * FROM user_video_progress WHERE user_id = $1 AND video_id = $2",
        user["id"], video["id"],
    )
    return ProgressResponse(
        video_id=str(row["video_id"]), watched_seconds=row["watched_seconds"],
        completed=row["completed"], last_position=row["last_position"],
    )


@router.get("/videos/{slug}/notes", response_model=list[NoteResponse])
async def get_notes(slug: str, user: dict = Depends(get_current_user)):
    db = await get_db()
    video = await db.fetchrow("SELECT id FROM videos WHERE slug = $1", slug)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    user_notes = await db.fetch(
        "SELECT * FROM user_notes WHERE user_id = $1 AND video_id = $2 ORDER BY timestamp_s",
        user["id"], video["id"],
    )
    seed_notes = await db.fetch(
        "SELECT * FROM seed_notes WHERE video_id = $1 ORDER BY timestamp_s",
        video["id"],
    )

    results = []
    for n in seed_notes:
        results.append(NoteResponse(
            id=str(n["id"]), video_id=str(n["video_id"]),
            timestamp_s=n["timestamp_s"], content=n["content"],
            is_seed=True, created_at=n["created_at"],
        ))
    for n in user_notes:
        results.append(NoteResponse(
            id=str(n["id"]), video_id=str(n["video_id"]),
            timestamp_s=n["timestamp_s"], content=n["content"],
            is_seed=False, created_at=n["created_at"],
        ))
    results.sort(key=lambda x: x.timestamp_s)
    return results


@router.post("/videos/{slug}/notes", response_model=NoteResponse)
async def create_note(slug: str, req: NoteCreate, user: dict = Depends(get_current_user)):
    db = await get_db()
    video = await db.fetchrow("SELECT id FROM videos WHERE slug = $1", slug)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    row = await db.fetchrow(
        """
        INSERT INTO user_notes (user_id, video_id, timestamp_s, content)
        VALUES ($1, $2, $3, $4) RETURNING *
        """,
        user["id"], video["id"], req.timestamp_s, req.content,
    )
    return NoteResponse(
        id=str(row["id"]), video_id=str(row["video_id"]),
        timestamp_s=row["timestamp_s"], content=row["content"],
        is_seed=False, created_at=row["created_at"],
    )


@router.put("/notes/{note_id}", response_model=NoteResponse)
async def update_note(note_id: str, req: NoteUpdate, user: dict = Depends(get_current_user)):
    db = await get_db()
    note = await db.fetchrow(
        "SELECT * FROM user_notes WHERE id = $1 AND user_id = $2", note_id, user["id"]
    )
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    if req.content is not None:
        await db.execute("UPDATE user_notes SET content = $1, updated_at = now() WHERE id = $2", req.content, note_id)
    if req.timestamp_s is not None:
        await db.execute("UPDATE user_notes SET timestamp_s = $1, updated_at = now() WHERE id = $2", req.timestamp_s, note_id)

    row = await db.fetchrow("SELECT * FROM user_notes WHERE id = $1", note_id)
    return NoteResponse(
        id=str(row["id"]), video_id=str(row["video_id"]),
        timestamp_s=row["timestamp_s"], content=row["content"],
        is_seed=False, created_at=row["created_at"],
    )


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, user: dict = Depends(get_current_user)):
    db = await get_db()
    result = await db.execute(
        "DELETE FROM user_notes WHERE id = $1 AND user_id = $2", note_id, user["id"]
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted"}


@router.get("/videos/{slug}/howto", response_model=Optional[HowtoResponse])
async def get_howto(slug: str):
    db = await get_db()
    video = await db.fetchrow("SELECT id FROM videos WHERE slug = $1", slug)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    row = await db.fetchrow("SELECT * FROM howto_guides WHERE video_id = $1", video["id"])
    if not row:
        return None
    return HowtoResponse(
        id=str(row["id"]), video_id=str(row["video_id"]),
        title=row["title"], content=row["content"], version=row.get("version", "1.0"),
    )


# ── Video Likes ───────────────────────────────────────────

@router.get("/videos/{slug}/likes", response_model=VideoLikeResponse)
async def get_video_likes(slug: str, user: Optional[dict] = Depends(get_optional_user)):
    db = await get_db()
    video = await db.fetchrow(
        "SELECT id FROM videos WHERE slug = $1 AND is_published = true AND is_active = true", slug
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    count = await db.fetchval(
        "SELECT COUNT(*) FROM video_likes WHERE video_id = $1", video["id"]
    )
    user_liked = False
    if user:
        row = await db.fetchrow(
            "SELECT 1 FROM video_likes WHERE user_id = $1 AND video_id = $2",
            user["id"], video["id"],
        )
        user_liked = row is not None

    return VideoLikeResponse(video_id=str(video["id"]), like_count=count, user_liked=user_liked)


@router.post("/videos/{slug}/likes", response_model=VideoLikeResponse)
async def like_video(slug: str, user: dict = Depends(get_current_user)):
    db = await get_db()
    video = await db.fetchrow(
        "SELECT id FROM videos WHERE slug = $1 AND is_published = true AND is_active = true", slug
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    await db.execute(
        "INSERT INTO video_likes (user_id, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        user["id"], video["id"],
    )
    count = await db.fetchval(
        "SELECT COUNT(*) FROM video_likes WHERE video_id = $1", video["id"]
    )
    return VideoLikeResponse(video_id=str(video["id"]), like_count=count, user_liked=True)


@router.delete("/videos/{slug}/likes", response_model=VideoLikeResponse)
async def unlike_video(slug: str, user: dict = Depends(get_current_user)):
    db = await get_db()
    video = await db.fetchrow(
        "SELECT id FROM videos WHERE slug = $1 AND is_published = true AND is_active = true", slug
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    await db.execute(
        "DELETE FROM video_likes WHERE user_id = $1 AND video_id = $2",
        user["id"], video["id"],
    )
    count = await db.fetchval(
        "SELECT COUNT(*) FROM video_likes WHERE video_id = $1", video["id"]
    )
    return VideoLikeResponse(video_id=str(video["id"]), like_count=count, user_liked=False)
