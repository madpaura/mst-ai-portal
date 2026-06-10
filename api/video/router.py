import json
import os

import anyio
from fastapi import APIRouter, HTTPException, Depends, Query, Path
from fastapi.responses import FileResponse
from typing import Annotated, Optional
from pydantic import BaseModel

from config import settings
from video.schemas import (
    CourseResponse, VideoResponse, ChapterResponse, ProgressResponse,
    ProgressUpdate, OverallProgressResponse, NoteResponse, NoteCreate,
    NoteUpdate, HowtoResponse, VideoLikeResponse, AttachmentResponse,
    PlaylistResponse, PlaylistCreate, PlaylistUpdate, PlaylistVideoAdd,
)
from auth.dependencies import get_current_user, get_optional_user
from database import get_db
import cache

router = APIRouter()

_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
UUIDPath = Annotated[str, Path(pattern=_UUID_PATTERN)]


def _secs_to_vtt(s: float) -> str:
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    sec = s % 60
    return f"{h:02d}:{m:02d}:{sec:06.3f}"


def _ensure_vtt(src: str, out: str) -> bool:
    """Render transcript.json → captions.vtt once, reusing it until the
    transcript changes. Runs in a worker thread — file I/O and JSON parsing
    of large transcripts must not block the event loop."""
    if os.path.isfile(out) and os.path.getmtime(out) >= os.path.getmtime(src):
        return True
    with open(src) as f:
        data = json.load(f)
    segments = data.get("segments", [])
    if not segments:
        return False

    lines = ["WEBVTT", ""]
    for i, seg in enumerate(segments, 1):
        start = _secs_to_vtt(float(seg["start"]))
        end = _secs_to_vtt(float(seg["end"]))
        text = seg.get("text", "").strip()
        if text:
            lines += [str(i), f"{start} --> {end}", text, ""]

    tmp = f"{out}.tmp.{os.getpid()}"
    with open(tmp, "w") as f:
        f.write("\n".join(lines))
    os.replace(tmp, out)
    return True


@router.get("/videos/{video_id}/captions.vtt")
async def get_captions_vtt(video_id: UUIDPath):
    """Return WebVTT captions generated from the stored transcript segments."""
    base = os.path.join(settings.VIDEO_STORAGE_PATH, video_id)
    src = os.path.join(base, "transcript.json")
    out = os.path.join(base, "captions.vtt")
    if not os.path.isfile(src):
        raise HTTPException(status_code=404, detail="No transcript available")
    ok = await anyio.to_thread.run_sync(_ensure_vtt, src, out)
    if not ok:
        raise HTTPException(status_code=404, detail="Transcript has no segments")
    return FileResponse(out, media_type="text/vtt")


class CourseProgressResponse(BaseModel):
    course_id: str
    course_slug: str
    course_title: str
    total_videos: int
    completed_videos: int
    progress_pct: float
    is_enrolled: bool
    enrolled_at: Optional[str] = None


@router.get("/courses", response_model=list[CourseResponse])
async def list_courses():
    async def _fetch():
        db = await get_db()
        rows = await db.fetch(
            """
            SELECT c.*,
                COUNT(v.id) FILTER (WHERE v.is_published = true AND v.is_active = true) as video_count,
                (
                    SELECT COALESCE(v2.custom_thumbnail, v2.thumbnail)
                    FROM videos v2
                    WHERE v2.course_id = c.id AND v2.is_published = true AND v2.is_active = true
                    ORDER BY v2.sort_order
                    LIMIT 1
                ) as thumbnail
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
                video_count=r["video_count"], thumbnail=r.get("thumbnail"),
                is_featured=r.get("is_featured", False),
            ).model_dump(mode="json")
            for r in rows
        ]
    return await cache.get_or_set(cache.NS_VIDEO, "list", "courses", None, settings.REDIS_DEFAULT_TTL, _fetch)


@router.get("/courses/{slug}")
async def get_course(slug: str):
    async def _fetch():
        db = await get_db()
        course = await db.fetchrow("SELECT * FROM courses WHERE slug = $1 AND is_active = true", slug)
        if not course:
            return None
        videos = await db.fetch(
            "SELECT * FROM videos WHERE course_id = $1 AND is_published = true AND is_active = true ORDER BY sort_order",
            course["id"],
        )
        return {
            "course": CourseResponse(
                id=str(course["id"]), title=course["title"], slug=course["slug"],
                description=course.get("description"), sort_order=course["sort_order"],
                video_count=len(videos), is_featured=course.get("is_featured", False),
            ).model_dump(mode="json"),
            "videos": [
                VideoResponse(
                    id=str(v["id"]), course_id=str(v["course_id"]) if v["course_id"] else None,
                    title=v["title"], slug=v["slug"], description=v.get("description"),
                    category=v["category"], duration_s=v.get("duration_s"),
                    status=v["status"], hls_path=v.get("hls_path"),
                    thumbnail=v.get("thumbnail"), is_published=v["is_published"],
                    sort_order=v["sort_order"], created_at=v["created_at"],
                    transcript_status=v.get("transcript_status"),
                ).model_dump(mode="json")
                for v in videos
            ],
        }
    result = await cache.get_or_set(cache.NS_VIDEO, "course", slug, None, settings.REDIS_DEFAULT_TTL, _fetch)
    if result is None:
        raise HTTPException(status_code=404, detail="Course not found")
    return result


@router.get("/videos", response_model=list[VideoResponse])
async def list_all_videos():
    """Return all published videos in sort order — used by the Ignite sidebar."""
    async def _fetch():
        db = await get_db()
        rows = await db.fetch(
            """
            SELECT v.*, u.display_name AS author_name
            FROM videos v
            LEFT JOIN users u ON u.id = v.created_by
            WHERE v.is_published = true AND v.is_active = true
            ORDER BY v.sort_order
            """,
        )
        return [
            VideoResponse(
                id=str(r["id"]), course_id=str(r["course_id"]) if r["course_id"] else None,
                title=r["title"], slug=r["slug"], description=r.get("description"),
                category=r["category"], duration_s=r.get("duration_s"),
                status=r["status"], hls_path=r.get("hls_path"),
                thumbnail=r.get("thumbnail"), is_published=r["is_published"],
                sort_order=r["sort_order"], created_at=r["created_at"],
                transcript_status=r.get("transcript_status"),
                author_name=r.get("author_name"),
            ).model_dump(mode="json")
            for r in rows
        ]
    return await cache.get_or_set(cache.NS_VIDEO, "list", "videos", None, settings.REDIS_DEFAULT_TTL, _fetch)


@router.get("/videos/stats")
async def video_view_stats() -> dict[str, int]:
    """Public per-video view counts keyed by slug, derived from page_views.

    The player records a pageview at `/ignite/<slug>`; we aggregate those.
    Lightly cached (short TTL) since exact real-time counts aren't required.
    """
    async def _fetch():
        db = await get_db()
        rows = await db.fetch(
            """
            SELECT path, COUNT(*) AS views
            FROM page_views
            WHERE section = 'ignite' AND path LIKE '/ignite/%'
            GROUP BY path
            """,
        )
        prefix = "/ignite/"
        out: dict[str, int] = {}
        for r in rows:
            slug = r["path"][len(prefix):]
            if slug:
                out[slug] = out.get(slug, 0) + r["views"]
        return out
    return await cache.get_or_set(cache.NS_VIDEO, "stats", "views", None, 120, _fetch)


@router.get("/videos/like-counts")
async def video_like_counts() -> dict[str, int]:
    """Public per-video like counts keyed by slug — powers the Top Rated view
    (likes proxy until dedicated ratings land). Short-TTL cached."""
    async def _fetch():
        db = await get_db()
        rows = await db.fetch(
            """
            SELECT v.slug, COUNT(l.user_id) AS likes
            FROM videos v
            JOIN video_likes l ON l.video_id = v.id
            WHERE v.is_published = true AND v.is_active = true
            GROUP BY v.slug
            """,
        )
        return {r["slug"]: r["likes"] for r in rows}
    return await cache.get_or_set(cache.NS_VIDEO, "stats", "likes", None, 120, _fetch)


@router.get("/videos/{slug}", response_model=VideoResponse)
async def get_video(slug: str):
    db = await get_db()
    row = await db.fetchrow(
        """
        SELECT v.*, u.display_name AS author_name
        FROM videos v
        LEFT JOIN users u ON u.id = v.created_by
        WHERE v.slug = $1 AND v.is_published = true AND v.is_active = true
        """,
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
        transcript_status=row.get("transcript_status"),
        author_name=row.get("author_name"),
    )


@router.get("/videos/{slug}/attachments", response_model=list[AttachmentResponse])
async def get_video_attachments(slug: str):
    async def _fetch():
        db = await get_db()
        video = await db.fetchrow(
            "SELECT id FROM videos WHERE slug = $1 AND is_published = true AND is_active = true", slug
        )
        if not video:
            return None
        rows = await db.fetch(
            "SELECT * FROM video_attachments WHERE video_id = $1 ORDER BY sort_order, created_at",
            video["id"],
        )
        return [
            AttachmentResponse(
                id=str(r["id"]), video_id=str(r["video_id"]), filename=r["filename"],
                display_name=r.get("display_name"), file_size=r["file_size"],
                mime_type=r.get("mime_type"), sort_order=r["sort_order"],
                download_url=f"/media/attachments/{r['video_id']}/{r['filename']}",
                created_at=r["created_at"],
            ).model_dump(mode="json")
            for r in rows
        ]
    result = await cache.get_or_set(cache.NS_VIDEO, "attachments", slug, None, settings.REDIS_DEFAULT_TTL, _fetch)
    if result is None:
        raise HTTPException(status_code=404, detail="Video not found")
    return result


@router.get("/videos/{slug}/chapters", response_model=list[ChapterResponse])
async def get_chapters(slug: str):
    async def _fetch():
        db = await get_db()
        video = await db.fetchrow(
            "SELECT id FROM videos WHERE slug = $1 AND is_published = true AND is_active = true", slug
        )
        if not video:
            return None
        rows = await db.fetch(
            "SELECT * FROM video_chapters WHERE video_id = $1 ORDER BY sort_order, start_time",
            video["id"],
        )
        return [
            ChapterResponse(
                id=str(r["id"]), video_id=str(r["video_id"]),
                title=r["title"], start_time=r["start_time"], sort_order=r["sort_order"],
            ).model_dump(mode="json")
            for r in rows
        ]
    result = await cache.get_or_set(cache.NS_VIDEO, "chapters", slug, None, settings.REDIS_DEFAULT_TTL, _fetch)
    if result is None:
        raise HTTPException(status_code=404, detail="Video not found")
    return result


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

    row = await db.fetchrow(
        """
        INSERT INTO user_video_progress (user_id, video_id, watched_seconds, last_position, completed, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (user_id, video_id) DO UPDATE SET
            watched_seconds = GREATEST(user_video_progress.watched_seconds, $3),
            last_position = $4,
            completed = $5 OR user_video_progress.completed,
            updated_at = now()
        RETURNING *
        """,
        user["id"], video["id"], req.watched_seconds, req.last_position, completed,
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
async def update_note(note_id: UUIDPath, req: NoteUpdate, user: dict = Depends(get_current_user)):
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
async def delete_note(note_id: UUIDPath, user: dict = Depends(get_current_user)):
    db = await get_db()
    result = await db.execute(
        "DELETE FROM user_notes WHERE id = $1 AND user_id = $2", note_id, user["id"]
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Note not found")
    return {"message": "Note deleted"}


@router.get("/videos/{slug}/howto", response_model=Optional[HowtoResponse])
async def get_howto(slug: str):
    _MISS = "__notfound__"

    async def _fetch():
        db = await get_db()
        video = await db.fetchrow("SELECT id FROM videos WHERE slug = $1", slug)
        if not video:
            return _MISS
        row = await db.fetchrow("SELECT * FROM howto_guides WHERE video_id = $1", video["id"])
        if not row:
            return None
        return HowtoResponse(
            id=str(row["id"]), video_id=str(row["video_id"]),
            title=row["title"], content=row["content"], version=row.get("version", "1.0"),
        ).model_dump(mode="json")

    result = await cache.get_or_set(cache.NS_VIDEO, "howto", slug, None, settings.REDIS_DEFAULT_TTL, _fetch)
    if result == _MISS:
        raise HTTPException(status_code=404, detail="Video not found")
    return result


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


# ── Video Bookmarks (Saved) ───────────────────────────────

@router.get("/bookmarks")
async def list_bookmarks(user: dict = Depends(get_current_user)) -> list[str]:
    """Return slugs of the current user's saved (published) videos."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT v.slug
        FROM video_bookmarks b
        JOIN videos v ON v.id = b.video_id
        WHERE b.user_id = $1 AND v.is_published = true AND v.is_active = true
        ORDER BY b.created_at DESC
        """,
        user["id"],
    )
    return [r["slug"] for r in rows]


@router.post("/videos/{slug}/bookmark")
async def add_bookmark(slug: str, user: dict = Depends(get_current_user)) -> dict:
    db = await get_db()
    video = await db.fetchrow(
        "SELECT id FROM videos WHERE slug = $1 AND is_published = true AND is_active = true", slug
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await db.execute(
        "INSERT INTO video_bookmarks (user_id, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        user["id"], video["id"],
    )
    return {"video_id": str(video["id"]), "bookmarked": True}


@router.delete("/videos/{slug}/bookmark")
async def remove_bookmark(slug: str, user: dict = Depends(get_current_user)) -> dict:
    db = await get_db()
    video = await db.fetchrow(
        "SELECT id FROM videos WHERE slug = $1 AND is_published = true AND is_active = true", slug
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await db.execute(
        "DELETE FROM video_bookmarks WHERE user_id = $1 AND video_id = $2",
        user["id"], video["id"],
    )
    return {"video_id": str(video["id"]), "bookmarked": False}


# ── Playlists (My Playlists) ──────────────────────────────

async def _playlist_with_slugs(db, row) -> PlaylistResponse:
    slugs = await db.fetch(
        """
        SELECT v.slug
        FROM playlist_videos pv
        JOIN videos v ON v.id = pv.video_id
        WHERE pv.playlist_id = $1 AND v.is_published = true AND v.is_active = true
        ORDER BY pv.added_at
        """,
        row["id"],
    )
    slug_list = [s["slug"] for s in slugs]
    return PlaylistResponse(
        id=str(row["id"]), name=row["name"], video_count=len(slug_list),
        video_slugs=slug_list, created_at=row["created_at"],
    )


async def _owned_playlist(db, playlist_id: str, user_id):
    row = await db.fetchrow(
        "SELECT * FROM playlists WHERE id = $1 AND user_id = $2", playlist_id, user_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return row


@router.get("/playlists", response_model=list[PlaylistResponse])
async def list_playlists(user: dict = Depends(get_current_user)):
    """Return the current user's custom playlists with their video slugs."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT p.id, p.name, p.created_at,
            COALESCE(
                array_agg(v.slug ORDER BY pv.added_at) FILTER (WHERE v.slug IS NOT NULL),
                '{}'
            ) AS slugs
        FROM playlists p
        LEFT JOIN playlist_videos pv ON pv.playlist_id = p.id
        LEFT JOIN videos v ON v.id = pv.video_id AND v.is_published = true AND v.is_active = true
        WHERE p.user_id = $1
        GROUP BY p.id, p.name, p.created_at
        ORDER BY p.created_at
        """,
        user["id"],
    )
    return [
        PlaylistResponse(
            id=str(r["id"]), name=r["name"], video_count=len(r["slugs"]),
            video_slugs=list(r["slugs"]), created_at=r["created_at"],
        )
        for r in rows
    ]


@router.post("/playlists", response_model=PlaylistResponse)
async def create_playlist(req: PlaylistCreate, user: dict = Depends(get_current_user)):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    db = await get_db()
    row = await db.fetchrow(
        "INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING *",
        user["id"], name,
    )
    return await _playlist_with_slugs(db, row)


@router.put("/playlists/{playlist_id}", response_model=PlaylistResponse)
async def rename_playlist(
    playlist_id: UUIDPath, req: PlaylistUpdate, user: dict = Depends(get_current_user)
):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    db = await get_db()
    await _owned_playlist(db, playlist_id, user["id"])
    row = await db.fetchrow(
        "UPDATE playlists SET name = $2 WHERE id = $1 RETURNING *", playlist_id, name
    )
    return await _playlist_with_slugs(db, row)


@router.delete("/playlists/{playlist_id}")
async def delete_playlist(playlist_id: UUIDPath, user: dict = Depends(get_current_user)) -> dict:
    db = await get_db()
    await _owned_playlist(db, playlist_id, user["id"])
    await db.execute("DELETE FROM playlists WHERE id = $1", playlist_id)
    return {"deleted": True}


@router.post("/playlists/{playlist_id}/videos", response_model=PlaylistResponse)
async def add_to_playlist(
    playlist_id: UUIDPath, req: PlaylistVideoAdd, user: dict = Depends(get_current_user)
):
    db = await get_db()
    row = await _owned_playlist(db, playlist_id, user["id"])
    video = await db.fetchrow(
        "SELECT id FROM videos WHERE slug = $1 AND is_published = true AND is_active = true",
        req.slug,
    )
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await db.execute(
        "INSERT INTO playlist_videos (playlist_id, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        playlist_id, video["id"],
    )
    return await _playlist_with_slugs(db, row)


@router.delete("/playlists/{playlist_id}/videos/{slug}", response_model=PlaylistResponse)
async def remove_from_playlist(
    playlist_id: UUIDPath, slug: str, user: dict = Depends(get_current_user)
):
    db = await get_db()
    row = await _owned_playlist(db, playlist_id, user["id"])
    video = await db.fetchrow("SELECT id FROM videos WHERE slug = $1", slug)
    if video:
        await db.execute(
            "DELETE FROM playlist_videos WHERE playlist_id = $1 AND video_id = $2",
            playlist_id, video["id"],
        )
    return await _playlist_with_slugs(db, row)


# ── Course Enrollment & Progress ──────────────────────────

@router.get("/my-courses", response_model=list[CourseProgressResponse])
async def get_my_courses(user: dict = Depends(get_current_user)):
    """Return all courses with enrollment status and progress for the current user."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT
            c.id, c.slug, c.title,
            COUNT(v.id) FILTER (WHERE v.is_published = true AND v.is_active = true) as total_videos,
            COUNT(p.video_id) FILTER (WHERE p.completed = true) as completed_videos,
            e.enrolled_at
        FROM courses c
        LEFT JOIN videos v ON v.course_id = c.id
        LEFT JOIN user_video_progress p ON p.video_id = v.id AND p.user_id = $1
        LEFT JOIN user_course_enrollments e ON e.course_id = c.id AND e.user_id = $1
        WHERE c.is_active = true
        GROUP BY c.id, c.slug, c.title, e.enrolled_at
        ORDER BY c.sort_order
        """,
        user["id"],
    )
    result = []
    for r in rows:
        total = r["total_videos"] or 0
        completed = r["completed_videos"] or 0
        pct = round((completed / total * 100) if total > 0 else 0, 1)
        result.append(CourseProgressResponse(
            course_id=str(r["id"]),
            course_slug=r["slug"],
            course_title=r["title"],
            total_videos=total,
            completed_videos=completed,
            progress_pct=pct,
            is_enrolled=r["enrolled_at"] is not None,
            enrolled_at=r["enrolled_at"].isoformat() if r["enrolled_at"] else None,
        ))
    return result


@router.get("/courses/{slug}/progress", response_model=CourseProgressResponse)
async def get_course_progress(slug: str, user: dict = Depends(get_current_user)):
    """Return enrollment status and video progress for a specific course."""
    db = await get_db()
    row = await db.fetchrow(
        """
        SELECT
            c.id, c.slug, c.title,
            COUNT(v.id) FILTER (WHERE v.is_published = true AND v.is_active = true) as total_videos,
            COUNT(p.video_id) FILTER (WHERE p.completed = true) as completed_videos,
            e.enrolled_at
        FROM courses c
        LEFT JOIN videos v ON v.course_id = c.id
        LEFT JOIN user_video_progress p ON p.video_id = v.id AND p.user_id = $1
        LEFT JOIN user_course_enrollments e ON e.course_id = c.id AND e.user_id = $1
        WHERE c.slug = $2 AND c.is_active = true
        GROUP BY c.id, c.slug, c.title, e.enrolled_at
        """,
        user["id"], slug,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Course not found")
    total = row["total_videos"] or 0
    completed = row["completed_videos"] or 0
    pct = round((completed / total * 100) if total > 0 else 0, 1)
    return CourseProgressResponse(
        course_id=str(row["id"]),
        course_slug=row["slug"],
        course_title=row["title"],
        total_videos=total,
        completed_videos=completed,
        progress_pct=pct,
        is_enrolled=row["enrolled_at"] is not None,
        enrolled_at=row["enrolled_at"].isoformat() if row["enrolled_at"] else None,
    )


@router.post("/courses/{slug}/enroll", response_model=CourseProgressResponse)
async def enroll_course(slug: str, user: dict = Depends(get_current_user)):
    """Subscribe (enroll) the current user to a course."""
    db = await get_db()
    course = await db.fetchrow("SELECT id FROM courses WHERE slug = $1 AND is_active = true", slug)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    await db.execute(
        """
        INSERT INTO user_course_enrollments (user_id, course_id)
        VALUES ($1, $2) ON CONFLICT DO NOTHING
        """,
        user["id"], course["id"],
    )
    # Log analytics event
    await db.execute(
        "INSERT INTO course_analytics (user_id, course_id, event_type) VALUES ($1, $2, 'enroll')",
        user["id"], course["id"],
    )
    # Return progress
    from fastapi import Request
    return await get_course_progress(slug, user)


@router.delete("/courses/{slug}/enroll", response_model=CourseProgressResponse)
async def unenroll_course(slug: str, user: dict = Depends(get_current_user)):
    """Unsubscribe the current user from a course."""
    db = await get_db()
    course = await db.fetchrow("SELECT id FROM courses WHERE slug = $1 AND is_active = true", slug)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    await db.execute(
        "DELETE FROM user_course_enrollments WHERE user_id = $1 AND course_id = $2",
        user["id"], course["id"],
    )
    await db.execute(
        "INSERT INTO course_analytics (user_id, course_id, event_type) VALUES ($1, $2, 'unenroll')",
        user["id"], course["id"],
    )
    return await get_course_progress(slug, user)


@router.post("/courses/enroll-all", response_model=list[CourseProgressResponse])
async def enroll_all_courses(user: dict = Depends(get_current_user)):
    """Subscribe the current user to all active courses at once."""
    db = await get_db()
    await db.execute(
        """
        INSERT INTO user_course_enrollments (user_id, course_id)
        SELECT $1, id FROM courses WHERE is_active = true
        ON CONFLICT DO NOTHING
        """,
        user["id"],
    )
    await db.execute(
        """
        INSERT INTO course_analytics (user_id, course_id, event_type)
        SELECT $1, id, 'enroll' FROM courses WHERE is_active = true
        """,
        user["id"],
    )
    return await get_my_courses(user)
