import os
import uuid
import shutil
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File

from video.schemas import (
    VideoAdminResponse, VideoCreate, VideoUpdate, ChapterResponse,
    ChapterCreate, ChapterUpdate, ChapterReorder, HowtoResponse, HowtoUpdate,
    QualitySettingResponse, QualitySettingUpdate, SeedNoteCreate,
    SeedNoteResponse, JobStatusResponse,
)
from auth.dependencies import require_admin
from database import get_db
from config import settings

router = APIRouter()


def _video_row_to_admin(r, job=None) -> VideoAdminResponse:
    return VideoAdminResponse(
        id=str(r["id"]),
        course_id=str(r["course_id"]) if r.get("course_id") else None,
        title=r["title"], slug=r["slug"], description=r.get("description"),
        category=r["category"], duration_s=r.get("duration_s"),
        status=r["status"], hls_path=r.get("hls_path"),
        thumbnail=r.get("thumbnail"), is_published=r["is_published"],
        is_active=r["is_active"],
        custom_thumbnail=r.get("custom_thumbnail"),
        sort_order=r["sort_order"], created_at=r["created_at"],
        job_status=job["status"] if job else None,
        job_error=job.get("error") if job else None,
    )


# ── Video CRUD ──────────────────────────────────────────────

@router.get("/videos", response_model=list[VideoAdminResponse])
async def admin_list_videos(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch("SELECT * FROM videos ORDER BY sort_order, created_at DESC")
    result = []
    for r in rows:
        job = await db.fetchrow(
            "SELECT * FROM transcode_jobs WHERE video_id = $1 ORDER BY created_at DESC LIMIT 1",
            r["id"],
        )
        result.append(_video_row_to_admin(r, job))
    return result


@router.post("/videos", response_model=VideoAdminResponse)
async def admin_create_video(req: VideoCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await db.fetchrow("SELECT id FROM videos WHERE slug = $1", req.slug)
    if existing:
        raise HTTPException(status_code=409, detail="Slug already exists")

    course_id = None
    if req.course_id:
        course_id = req.course_id

    row = await db.fetchrow(
        """
        INSERT INTO videos (title, slug, description, category, course_id, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
        """,
        req.title, req.slug, req.description, req.category, course_id, req.sort_order,
    )

    # Create default quality settings
    for quality in ["360p", "720p", "1080p"]:
        crf = {"360p": 28, "720p": 23, "1080p": 22}[quality]
        await db.execute(
            "INSERT INTO video_quality_settings (video_id, quality, enabled, crf) VALUES ($1, $2, true, $3)",
            row["id"], quality, crf,
        )

    # Create storage directories
    video_dir = os.path.join(settings.VIDEO_STORAGE_PATH, str(row["id"]))
    os.makedirs(os.path.join(video_dir, "raw"), exist_ok=True)
    os.makedirs(os.path.join(video_dir, "hls"), exist_ok=True)

    return _video_row_to_admin(row)


@router.get("/videos/{video_id}", response_model=VideoAdminResponse)
async def admin_get_video(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM videos WHERE id = $1", video_id)
    if not row:
        raise HTTPException(status_code=404, detail="Video not found")
    job = await db.fetchrow(
        "SELECT * FROM transcode_jobs WHERE video_id = $1 ORDER BY created_at DESC LIMIT 1",
        row["id"],
    )
    return _video_row_to_admin(row, job)


@router.put("/videos/{video_id}", response_model=VideoAdminResponse)
async def admin_update_video(
    video_id: str, req: VideoUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM videos WHERE id = $1", video_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Video not found")

    fields = {}
    for field in ["title", "description", "category", "course_id", "sort_order"]:
        val = getattr(req, field, None)
        if val is not None:
            fields[field] = val

    if fields:
        set_parts = []
        params = [video_id]
        idx = 2
        for k, v in fields.items():
            set_parts.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        set_clause = ", ".join(set_parts)
        await db.execute(f"UPDATE videos SET {set_clause} WHERE id = $1", *params)

    row = await db.fetchrow("SELECT * FROM videos WHERE id = $1", video_id)
    return _video_row_to_admin(row)


@router.delete("/videos/{video_id}")
async def admin_soft_delete_video(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute(
        "UPDATE videos SET is_active = false, is_published = false WHERE id = $1", video_id
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Video not found")
    return {"message": "Video deactivated"}


@router.delete("/videos/{video_id}/permanent")
async def admin_hard_delete_video(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT id FROM videos WHERE id = $1", video_id)
    if not row:
        raise HTTPException(status_code=404, detail="Video not found")

    # Delete files from disk
    video_dir = os.path.join(settings.VIDEO_STORAGE_PATH, video_id)
    if os.path.exists(video_dir):
        shutil.rmtree(video_dir)

    await db.execute("DELETE FROM videos WHERE id = $1", video_id)
    return {"message": "Video permanently deleted"}


# ── Publishing ──────────────────────────────────────────────

@router.post("/videos/{video_id}/publish")
async def admin_publish_video(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    video = await db.fetchrow("SELECT status FROM videos WHERE id = $1", video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if video["status"] != "ready":
        raise HTTPException(status_code=400, detail="Video must be transcoded (status=ready) before publishing")
    await db.execute("UPDATE videos SET is_published = true WHERE id = $1", video_id)
    return {"message": "Video published"}


@router.post("/videos/{video_id}/unpublish")
async def admin_unpublish_video(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    await db.execute("UPDATE videos SET is_published = false WHERE id = $1", video_id)
    return {"message": "Video unpublished"}


# ── Preview ─────────────────────────────────────────────────

@router.get("/videos/{video_id}/preview")
async def admin_preview_video(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT hls_path, status FROM videos WHERE id = $1", video_id)
    if not row:
        raise HTTPException(status_code=404, detail="Video not found")
    if not row["hls_path"]:
        raise HTTPException(status_code=400, detail="No HLS path available yet")
    return {"hls_path": row["hls_path"], "status": row["status"]}


# ── Upload & Transcoding ───────────────────────────────────

@router.post("/videos/{video_id}/upload")
async def admin_upload_video_file(
    video_id: str, file: UploadFile = File(...), admin: dict = Depends(require_admin)
):
    db = await get_db()
    video = await db.fetchrow("SELECT id FROM videos WHERE id = $1", video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # Save raw file
    video_dir = os.path.join(settings.VIDEO_STORAGE_PATH, video_id)
    raw_dir = os.path.join(video_dir, "raw")
    os.makedirs(raw_dir, exist_ok=True)

    file_path = os.path.join(raw_dir, "original.mp4")
    with open(file_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):  # 1MB chunks
            f.write(chunk)

    # Update video status
    await db.execute("UPDATE videos SET status = 'processing' WHERE id = $1", video_id)

    # Create transcode job
    await db.execute(
        "INSERT INTO transcode_jobs (video_id) VALUES ($1)", video_id
    )

    return {"message": "Video uploaded, transcoding queued"}


@router.post("/videos/{video_id}/retranscode")
async def admin_retranscode(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    video = await db.fetchrow("SELECT id FROM videos WHERE id = $1", video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    raw_path = os.path.join(settings.VIDEO_STORAGE_PATH, video_id, "raw", "original.mp4")
    if not os.path.exists(raw_path):
        raise HTTPException(status_code=400, detail="No raw video file found")

    await db.execute("UPDATE videos SET status = 'processing' WHERE id = $1", video_id)
    await db.execute("INSERT INTO transcode_jobs (video_id) VALUES ($1)", video_id)
    return {"message": "Re-transcode job queued"}


@router.get("/videos/{video_id}/job-status", response_model=list[JobStatusResponse])
async def admin_job_status(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM transcode_jobs WHERE video_id = $1 ORDER BY created_at DESC LIMIT 5",
        video_id,
    )
    return [
        JobStatusResponse(
            id=r["id"], video_id=str(r["video_id"]), status=r["status"],
            attempts=r["attempts"], max_attempts=r["max_attempts"],
            error=r.get("error"), started_at=r.get("started_at"),
            completed_at=r.get("completed_at"), created_at=r["created_at"],
        )
        for r in rows
    ]


# ── Chapters ────────────────────────────────────────────────

@router.get("/videos/{video_id}/chapters", response_model=list[ChapterResponse])
async def admin_list_chapters(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM video_chapters WHERE video_id = $1 ORDER BY sort_order, start_time",
        video_id,
    )
    return [
        ChapterResponse(
            id=str(r["id"]), video_id=str(r["video_id"]),
            title=r["title"], start_time=r["start_time"], sort_order=r["sort_order"],
        )
        for r in rows
    ]


@router.post("/videos/{video_id}/chapters", response_model=ChapterResponse)
async def admin_create_chapter(
    video_id: str, req: ChapterCreate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    video = await db.fetchrow("SELECT id FROM videos WHERE id = $1", video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    row = await db.fetchrow(
        "INSERT INTO video_chapters (video_id, title, start_time, sort_order) VALUES ($1,$2,$3,$4) RETURNING *",
        video_id, req.title, req.start_time, req.sort_order,
    )
    return ChapterResponse(
        id=str(row["id"]), video_id=str(row["video_id"]),
        title=row["title"], start_time=row["start_time"], sort_order=row["sort_order"],
    )


@router.put("/chapters/{chapter_id}", response_model=ChapterResponse)
async def admin_update_chapter(
    chapter_id: str, req: ChapterUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM video_chapters WHERE id = $1", chapter_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Chapter not found")

    if req.title is not None:
        await db.execute("UPDATE video_chapters SET title = $1 WHERE id = $2", req.title, chapter_id)
    if req.start_time is not None:
        await db.execute("UPDATE video_chapters SET start_time = $1 WHERE id = $2", req.start_time, chapter_id)
    if req.sort_order is not None:
        await db.execute("UPDATE video_chapters SET sort_order = $1 WHERE id = $2", req.sort_order, chapter_id)

    row = await db.fetchrow("SELECT * FROM video_chapters WHERE id = $1", chapter_id)
    return ChapterResponse(
        id=str(row["id"]), video_id=str(row["video_id"]),
        title=row["title"], start_time=row["start_time"], sort_order=row["sort_order"],
    )


@router.delete("/chapters/{chapter_id}")
async def admin_delete_chapter(chapter_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute("DELETE FROM video_chapters WHERE id = $1", chapter_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Chapter not found")
    return {"message": "Chapter deleted"}


@router.put("/videos/{video_id}/chapters/reorder")
async def admin_reorder_chapters(
    video_id: str, req: ChapterReorder, admin: dict = Depends(require_admin)
):
    db = await get_db()
    for idx, chapter_id in enumerate(req.chapter_ids):
        await db.execute(
            "UPDATE video_chapters SET sort_order = $1 WHERE id = $2 AND video_id = $3",
            idx, chapter_id, video_id,
        )
    return {"message": "Chapters reordered"}


# ── How-To Guide ────────────────────────────────────────────

@router.get("/videos/{video_id}/howto", response_model=HowtoResponse | None)
async def admin_get_howto(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM howto_guides WHERE video_id = $1", video_id)
    if not row:
        return None
    return HowtoResponse(
        id=str(row["id"]), video_id=str(row["video_id"]),
        title=row["title"], content=row["content"], version=row.get("version", "1.0"),
    )


@router.put("/videos/{video_id}/howto", response_model=HowtoResponse)
async def admin_upsert_howto(
    video_id: str, req: HowtoUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    existing = await db.fetchrow("SELECT id FROM howto_guides WHERE video_id = $1", video_id)
    if existing:
        await db.execute(
            "UPDATE howto_guides SET title = $1, content = $2, updated_at = now() WHERE video_id = $3",
            req.title, req.content, video_id,
        )
    else:
        await db.execute(
            "INSERT INTO howto_guides (video_id, title, content) VALUES ($1, $2, $3)",
            video_id, req.title, req.content,
        )

    row = await db.fetchrow("SELECT * FROM howto_guides WHERE video_id = $1", video_id)
    return HowtoResponse(
        id=str(row["id"]), video_id=str(row["video_id"]),
        title=row["title"], content=row["content"], version=row.get("version", "1.0"),
    )


# ── Quality Settings ────────────────────────────────────────

@router.get("/videos/{video_id}/quality", response_model=list[QualitySettingResponse])
async def admin_get_quality(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM video_quality_settings WHERE video_id = $1 ORDER BY quality",
        video_id,
    )
    return [
        QualitySettingResponse(quality=r["quality"], enabled=r["enabled"], crf=r["crf"])
        for r in rows
    ]


@router.put("/videos/{video_id}/quality")
async def admin_update_quality(
    video_id: str, req: QualitySettingUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    for q in req.qualities:
        await db.execute(
            """
            INSERT INTO video_quality_settings (video_id, quality, enabled, crf)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (video_id, quality) DO UPDATE SET enabled = $3, crf = $4
            """,
            video_id, q.quality, q.enabled, q.crf,
        )
    return {"message": "Quality settings updated"}


# ── Thumbnail ───────────────────────────────────────────────

@router.post("/videos/{video_id}/thumbnail")
async def admin_upload_thumbnail(
    video_id: str, file: UploadFile = File(...), admin: dict = Depends(require_admin)
):
    db = await get_db()
    video = await db.fetchrow("SELECT id FROM videos WHERE id = $1", video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    video_dir = os.path.join(settings.VIDEO_STORAGE_PATH, video_id)
    os.makedirs(video_dir, exist_ok=True)

    thumb_path = os.path.join(video_dir, "custom_thumb.jpg")
    with open(thumb_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    hls_thumb = f"/streams/{video_id}/custom_thumb.jpg"
    await db.execute(
        "UPDATE videos SET custom_thumbnail = $1 WHERE id = $2", hls_thumb, video_id
    )
    return {"message": "Thumbnail uploaded", "path": hls_thumb}


# ── Seed Notes ──────────────────────────────────────────────

@router.get("/videos/{video_id}/seed-notes", response_model=list[SeedNoteResponse])
async def admin_list_seed_notes(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM seed_notes WHERE video_id = $1 ORDER BY timestamp_s", video_id
    )
    return [
        SeedNoteResponse(
            id=str(r["id"]), video_id=str(r["video_id"]),
            timestamp_s=r["timestamp_s"], content=r["content"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.post("/videos/{video_id}/seed-notes", response_model=SeedNoteResponse)
async def admin_create_seed_note(
    video_id: str, req: SeedNoteCreate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    row = await db.fetchrow(
        "INSERT INTO seed_notes (video_id, timestamp_s, content, created_by) VALUES ($1,$2,$3,$4) RETURNING *",
        video_id, req.timestamp_s, req.content, admin["id"],
    )
    return SeedNoteResponse(
        id=str(row["id"]), video_id=str(row["video_id"]),
        timestamp_s=row["timestamp_s"], content=row["content"],
        created_at=row["created_at"],
    )


@router.put("/seed-notes/{note_id}", response_model=SeedNoteResponse)
async def admin_update_seed_note(
    note_id: str, req: SeedNoteCreate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    await db.execute(
        "UPDATE seed_notes SET timestamp_s = $1, content = $2 WHERE id = $3",
        req.timestamp_s, req.content, note_id,
    )
    row = await db.fetchrow("SELECT * FROM seed_notes WHERE id = $1", note_id)
    if not row:
        raise HTTPException(status_code=404, detail="Seed note not found")
    return SeedNoteResponse(
        id=str(row["id"]), video_id=str(row["video_id"]),
        timestamp_s=row["timestamp_s"], content=row["content"],
        created_at=row["created_at"],
    )


@router.delete("/seed-notes/{note_id}")
async def admin_delete_seed_note(note_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute("DELETE FROM seed_notes WHERE id = $1", note_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Seed note not found")
    return {"message": "Seed note deleted"}
