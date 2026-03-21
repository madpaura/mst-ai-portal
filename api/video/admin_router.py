import os
import re
import uuid
import json
import shutil
import subprocess
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, BackgroundTasks

from video.schemas import (
    VideoAdminResponse, VideoCreate, VideoUpdate, ChapterResponse,
    ChapterCreate, ChapterUpdate, ChapterReorder, HowtoResponse, HowtoUpdate,
    QualitySettingResponse, QualitySettingUpdate, SeedNoteCreate,
    SeedNoteResponse, JobStatusResponse, BannerConfigResponse, BannerConfigUpdate,
    TrimRequest, CutRequest,
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
    # Auto-generate slug from title if not provided
    if not req.slug or not req.slug.strip():
        req.slug = re.sub(r'[^a-z0-9]+', '-', req.title.lower()).strip('-')
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
async def admin_delete_video(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT id FROM videos WHERE id = $1", video_id)
    if not row:
        raise HTTPException(status_code=404, detail="Video not found")

    # Delete all files from disk (raw, hls, banner, thumbnails)
    video_dir = os.path.join(settings.VIDEO_STORAGE_PATH, video_id)
    if os.path.exists(video_dir):
        shutil.rmtree(video_dir)

    # Delete from DB — cascades to chapters, quality_settings, progress,
    # user_notes, seed_notes, howto_guides, video_banners, transcode_jobs
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


# ── Trim / Cut ─────────────────────────────────────────────

@router.post("/videos/{video_id}/trim")
async def admin_trim_video(
    video_id: str, req: TrimRequest, background_tasks: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    """Cut/trim a video between start_seconds and end_seconds using ffmpeg."""
    db = await get_db()
    video = await db.fetchrow("SELECT id, status FROM videos WHERE id = $1", video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    raw_path = os.path.join(settings.VIDEO_STORAGE_PATH, video_id, "raw", "original.mp4")
    backup_path = os.path.join(settings.VIDEO_STORAGE_PATH, video_id, "raw", "original_pretrim.mp4")

    if not os.path.exists(raw_path):
        raise HTTPException(status_code=400, detail="No raw video file found")

    if req.start_seconds < 0:
        raise HTTPException(status_code=400, detail="start_seconds must be >= 0")
    if req.end_seconds <= req.start_seconds:
        raise HTTPException(status_code=400, detail="end_seconds must be > start_seconds")

    background_tasks.add_task(
        _trim_video_task, video_id, req.start_seconds, req.end_seconds,
        raw_path, backup_path, settings.DATABASE_URL,
    )

    await db.execute("UPDATE videos SET status = 'processing' WHERE id = $1", video_id)
    return {"message": "Trim job started", "start": req.start_seconds, "end": req.end_seconds}


async def _trim_video_task(
    video_id: str, start: float, end: float,
    raw_path: str, backup_path: str, db_url: str,
):
    """Background task to trim a video and queue re-transcoding."""
    import asyncpg as apg

    pool = await apg.create_pool(db_url, min_size=1, max_size=2)
    try:
        # Back up the original (only first time)
        if not os.path.exists(backup_path):
            shutil.copy2(raw_path, backup_path)

        source_path = backup_path if os.path.exists(backup_path) else raw_path
        trimmed_path = raw_path + ".trimmed.mp4"

        # Use ffmpeg to trim
        duration = end - start
        trim_cmd = [
            settings.FFMPEG_PATH, "-y",
            "-ss", str(start),
            "-i", source_path,
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-c:a", "aac", "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            trimmed_path,
        ]

        print(f"[trim] Trimming video {video_id}: {start}s - {end}s")
        result = subprocess.run(trim_cmd, capture_output=True, text=True, timeout=600)

        if result.returncode != 0:
            error = f"Trim failed: {result.stderr[-500:]}"
            print(f"[trim] ERROR: {error}")
            await pool.execute(
                "UPDATE videos SET status = 'error' WHERE id = $1", video_id,
            )
            return

        if not os.path.exists(trimmed_path) or os.path.getsize(trimmed_path) == 0:
            print("[trim] ERROR: Trimmed file is empty or missing")
            await pool.execute(
                "UPDATE videos SET status = 'error' WHERE id = $1", video_id,
            )
            return

        # Replace original with trimmed version
        shutil.move(trimmed_path, raw_path)

        # Probe new duration
        probe_cmd = [
            settings.FFMPEG_PATH.replace("ffmpeg", "ffprobe"),
            "-v", "quiet", "-print_format", "json", "-show_format", raw_path,
        ]
        probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
        new_duration = None
        if probe_result.returncode == 0:
            try:
                probe_data = json.loads(probe_result.stdout)
                new_duration = int(float(probe_data.get("format", {}).get("duration", 0)))
            except Exception:
                pass

        if new_duration:
            await pool.execute(
                "UPDATE videos SET duration_s = $1 WHERE id = $2", new_duration, video_id,
            )

        # Queue re-transcode
        await pool.execute("UPDATE videos SET status = 'processing' WHERE id = $1", video_id)
        await pool.execute("INSERT INTO transcode_jobs (video_id) VALUES ($1)", video_id)
        print(f"[trim] Video {video_id} trimmed successfully, re-transcode queued")

    except Exception as e:
        print(f"[trim] Unexpected error: {e}")
        try:
            await pool.execute(
                "UPDATE videos SET status = 'error' WHERE id = $1", video_id,
            )
        except Exception:
            pass
    finally:
        await pool.close()


@router.post("/videos/{video_id}/cut")
async def admin_cut_video(
    video_id: str, req: CutRequest, background_tasks: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    """Remove the segment between start_seconds and end_seconds, keeping everything else."""
    db = await get_db()
    video = await db.fetchrow("SELECT id, status FROM videos WHERE id = $1", video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    raw_path = os.path.join(settings.VIDEO_STORAGE_PATH, video_id, "raw", "original.mp4")
    backup_path = os.path.join(settings.VIDEO_STORAGE_PATH, video_id, "raw", "original_precut.mp4")

    if not os.path.exists(raw_path):
        raise HTTPException(status_code=400, detail="No raw video file found")

    if req.start_seconds < 0:
        raise HTTPException(status_code=400, detail="start_seconds must be >= 0")
    if req.end_seconds <= req.start_seconds:
        raise HTTPException(status_code=400, detail="end_seconds must be > start_seconds")

    background_tasks.add_task(
        _cut_video_task, video_id, req.start_seconds, req.end_seconds,
        raw_path, backup_path, settings.DATABASE_URL,
    )

    await db.execute("UPDATE videos SET status = 'processing' WHERE id = $1", video_id)
    return {"message": "Cut job started", "start": req.start_seconds, "end": req.end_seconds}


async def _cut_video_task(
    video_id: str, start: float, end: float,
    raw_path: str, backup_path: str, db_url: str,
):
    """Background task to cut (remove) a segment from a video and queue re-transcoding."""
    import asyncpg as apg

    pool = await apg.create_pool(db_url, min_size=1, max_size=2)
    try:
        # Back up the original (only first time)
        if not os.path.exists(backup_path):
            shutil.copy2(raw_path, backup_path)

        source_path = backup_path if os.path.exists(backup_path) else raw_path
        part_before = raw_path + ".cut_before.mp4"
        part_after = raw_path + ".cut_after.mp4"
        concat_list = raw_path + ".cut_concat.txt"
        cut_output = raw_path + ".cut_result.mp4"

        encode_opts = [
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-c:a", "aac", "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
        ]

        parts = []

        # Extract part before the cut (0 → start)
        if start > 0:
            cmd_before = [
                settings.FFMPEG_PATH, "-y",
                "-i", source_path,
                "-t", str(start),
                *encode_opts,
                part_before,
            ]
            print(f"[cut] Extracting before segment: 0s - {start}s")
            r = subprocess.run(cmd_before, capture_output=True, text=True, timeout=600)
            if r.returncode != 0:
                raise RuntimeError(f"Cut before-segment failed: {r.stderr[-500:]}")
            parts.append(part_before)

        # Extract part after the cut (end → EOF)
        cmd_after = [
            settings.FFMPEG_PATH, "-y",
            "-ss", str(end),
            "-i", source_path,
            *encode_opts,
            part_after,
        ]
        print(f"[cut] Extracting after segment: {end}s - EOF")
        r = subprocess.run(cmd_after, capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            raise RuntimeError(f"Cut after-segment failed: {r.stderr[-500:]}")
        if os.path.exists(part_after) and os.path.getsize(part_after) > 0:
            parts.append(part_after)

        if not parts:
            raise RuntimeError("Cut produced no output segments")

        if len(parts) == 1:
            # Only one segment, just use it directly
            shutil.move(parts[0], cut_output)
        else:
            # Concatenate the two parts
            with open(concat_list, "w") as f:
                for p in parts:
                    f.write(f"file '{p}'\n")

            concat_cmd = [
                settings.FFMPEG_PATH, "-y",
                "-f", "concat", "-safe", "0",
                "-i", concat_list,
                "-c", "copy",
                "-movflags", "+faststart",
                cut_output,
            ]
            print(f"[cut] Concatenating {len(parts)} segments")
            r = subprocess.run(concat_cmd, capture_output=True, text=True, timeout=600)
            if r.returncode != 0:
                raise RuntimeError(f"Cut concat failed: {r.stderr[-500:]}")

        if not os.path.exists(cut_output) or os.path.getsize(cut_output) == 0:
            raise RuntimeError("Cut output file is empty or missing")

        # Replace original with cut version
        shutil.move(cut_output, raw_path)

        # Cleanup temp files
        for tmp in [part_before, part_after, concat_list]:
            if os.path.exists(tmp):
                os.remove(tmp)

        # Probe new duration
        probe_cmd = [
            settings.FFMPEG_PATH.replace("ffmpeg", "ffprobe"),
            "-v", "quiet", "-print_format", "json", "-show_format", raw_path,
        ]
        probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
        new_duration = None
        if probe_result.returncode == 0:
            try:
                probe_data = json.loads(probe_result.stdout)
                new_duration = int(float(probe_data.get("format", {}).get("duration", 0)))
            except Exception:
                pass

        if new_duration:
            await pool.execute(
                "UPDATE videos SET duration_s = $1 WHERE id = $2", new_duration, video_id,
            )

        # Queue re-transcode
        await pool.execute("UPDATE videos SET status = 'processing' WHERE id = $1", video_id)
        await pool.execute("INSERT INTO transcode_jobs (video_id) VALUES ($1)", video_id)
        print(f"[cut] Video {video_id} cut successfully, re-transcode queued")

    except Exception as e:
        print(f"[cut] Unexpected error: {e}")
        # Cleanup temp files on error
        for tmp in [part_before, part_after, concat_list, cut_output]:
            if os.path.exists(tmp):
                os.remove(tmp)
        try:
            await pool.execute(
                "UPDATE videos SET status = 'error' WHERE id = $1", video_id,
            )
        except Exception:
            pass
    finally:
        await pool.close()


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


# ── Banner Config ──────────────────────────────────────────

def _banner_row_to_response(r) -> BannerConfigResponse:
    return BannerConfigResponse(
        id=str(r["id"]), video_id=str(r["video_id"]),
        variant=r["variant"], company_logo=r["company_logo"],
        series_tag=r["series_tag"], topic=r["topic"],
        subtopic=r["subtopic"], episode=r["episode"],
        duration=r["duration"], presenter=r["presenter"],
        presenter_initial=r["presenter_initial"],
        banner_duration_s=r.get("banner_duration_s", 3),
        status=r["status"],
        banner_video_path=r.get("banner_video_path"),
        error=r.get("error"),
    )


@router.get("/videos/{video_id}/banner", response_model=BannerConfigResponse | None)
async def admin_get_banner(video_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM video_banners WHERE video_id = $1", video_id)
    if not row:
        return None
    return _banner_row_to_response(row)


@router.put("/videos/{video_id}/banner", response_model=BannerConfigResponse)
async def admin_upsert_banner(
    video_id: str, req: BannerConfigUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    video = await db.fetchrow("SELECT id FROM videos WHERE id = $1", video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    existing = await db.fetchrow("SELECT id FROM video_banners WHERE video_id = $1", video_id)
    if existing:
        await db.execute(
            """UPDATE video_banners SET variant=$1, company_logo=$2, series_tag=$3,
               topic=$4, subtopic=$5, episode=$6, duration=$7, presenter=$8,
               presenter_initial=$9, banner_duration_s=$10, status='draft', updated_at=now()
               WHERE video_id=$11""",
            req.variant, req.company_logo, req.series_tag, req.topic,
            req.subtopic, req.episode, req.duration, req.presenter,
            req.presenter_initial, req.banner_duration_s, video_id,
        )
    else:
        await db.execute(
            """INSERT INTO video_banners
               (video_id, variant, company_logo, series_tag, topic, subtopic, episode, duration, presenter, presenter_initial, banner_duration_s)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
            video_id, req.variant, req.company_logo, req.series_tag, req.topic,
            req.subtopic, req.episode, req.duration, req.presenter,
            req.presenter_initial, req.banner_duration_s,
        )

    row = await db.fetchrow("SELECT * FROM video_banners WHERE video_id = $1", video_id)
    return _banner_row_to_response(row)


async def _generate_banner_video(video_id: str, db_url: str):
    """Background task: render banner with Remotion and prepend to video."""
    import asyncpg

    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)
    try:
        banner = await pool.fetchrow("SELECT * FROM video_banners WHERE video_id = $1", video_id)
        if not banner:
            return

        await pool.execute(
            "UPDATE video_banners SET status='generating', error=NULL WHERE video_id=$1", video_id
        )

        video_dir = os.path.join(settings.VIDEO_STORAGE_PATH, video_id)
        banner_dir = os.path.join(video_dir, "banner")
        os.makedirs(banner_dir, exist_ok=True)

        banner_duration_s = banner.get("banner_duration_s", 3)
        if banner_duration_s < 3:
            banner_duration_s = 3
        elif banner_duration_s > 10:
            banner_duration_s = 10

        # Write props JSON for Remotion
        props = {
            "variant": banner["variant"],
            "companyLogo": banner["company_logo"],
            "seriesTag": banner["series_tag"],
            "topic": banner["topic"],
            "subtopic": banner["subtopic"],
            "episode": banner["episode"],
            "duration": banner["duration"],
            "presenter": banner["presenter"],
            "presenterInitial": banner["presenter_initial"],
            "durationInSeconds": banner_duration_s,
        }
        props_path = os.path.join(banner_dir, "props.json")
        with open(props_path, "w") as f:
            json.dump(props, f)

        banner_output = os.path.join(banner_dir, "banner.mp4")
        remotion_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "remotion-banner")

        # Render with Remotion
        render_cmd = [
            "npx", "remotion", "render",
            "src/index.ts",
            "BannerVideo",
            "--output", banner_output,
            "--props", props_path,
            "--codec", "h264",
        ]
        print(f"[banner] Rendering banner for video {video_id}...")
        print(f"[banner] cmd: {' '.join(render_cmd)}")
        result = subprocess.run(render_cmd, cwd=remotion_dir, capture_output=True, text=True, timeout=180)

        print(f"[banner] Remotion stdout: {result.stdout[-500:]}")
        print(f"[banner] Remotion stderr: {result.stderr[-500:]}")

        if result.returncode != 0:
            error = f"Remotion render failed: {result.stderr[-500:]}"
            print(f"[banner] ERROR: {error}")
            await pool.execute(
                "UPDATE video_banners SET status='error', error=$1 WHERE video_id=$2",
                error, video_id,
            )
            return

        if not os.path.exists(banner_output):
            await pool.execute(
                "UPDATE video_banners SET status='error', error='Banner video file not created' WHERE video_id=$1",
                video_id,
            )
            return

        print(f"[banner] Banner rendered: {os.path.getsize(banner_output)} bytes")

        # Prepend banner to the original video using ffmpeg concat
        raw_path = os.path.join(video_dir, "raw", "original.mp4")
        # Use the backup if it exists (from a previous banner insert)
        backup_path = os.path.join(video_dir, "raw", "original_no_banner.mp4")
        source_path = backup_path if os.path.exists(backup_path) else raw_path

        if os.path.exists(source_path):
            # Probe original video to get resolution, fps, and whether it has audio
            probe_cmd = [
                settings.FFMPEG_PATH.replace("ffmpeg", "ffprobe"),
                "-v", "quiet",
                "-print_format", "json",
                "-show_streams",
                source_path,
            ]
            probe_result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)
            orig_w, orig_h, orig_fps = 1920, 1080, 30
            has_audio = False
            audio_sample_rate = 44100
            if probe_result.returncode == 0:
                try:
                    probe_data = json.loads(probe_result.stdout)
                    for stream in probe_data.get("streams", []):
                        if stream.get("codec_type") == "video":
                            orig_w = int(stream.get("width", 1920))
                            orig_h = int(stream.get("height", 1080))
                            fps_str = stream.get("r_frame_rate", "30/1")
                            if "/" in fps_str:
                                num, den = fps_str.split("/")
                                orig_fps = round(int(num) / int(den))
                            else:
                                orig_fps = int(float(fps_str))
                        if stream.get("codec_type") == "audio":
                            has_audio = True
                            audio_sample_rate = int(stream.get("sample_rate", 44100))
                except Exception as e:
                    print(f"[banner] Probe parse error: {e}, using defaults")

            # Ensure dimensions are even (required by libx264) and fps is sane
            orig_w = orig_w + (orig_w % 2)
            orig_h = orig_h + (orig_h % 2)
            if orig_fps > 60 or orig_fps < 1:
                orig_fps = 30

            print(f"[banner] Original video: {orig_w}x{orig_h} @ {orig_fps}fps, has_audio={has_audio}")

            # Use the larger dimensions between banner (1920x1080) and original
            target_w = max(orig_w, 1920)
            target_h = max(orig_h, 1080)
            target_w = target_w + (target_w % 2)
            target_h = target_h + (target_h % 2)

            # Re-encode banner to match target resolution and fps
            # Add silent audio ONLY if original has audio; otherwise video-only
            banner_reenc = os.path.join(banner_dir, "banner_reenc.mp4")
            reencode_cmd = [settings.FFMPEG_PATH, "-y", "-i", banner_output]
            if has_audio:
                reencode_cmd += ["-f", "lavfi", "-i", f"anullsrc=channel_layout=stereo:sample_rate={audio_sample_rate}"]
            reencode_cmd += [
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-vf", f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2",
                "-pix_fmt", "yuv420p",
                "-r", str(orig_fps),
            ]
            if has_audio:
                reencode_cmd += ["-c:a", "aac", "-b:a", "128k", "-shortest"]
            else:
                reencode_cmd += ["-an"]
            reencode_cmd.append(banner_reenc)

            print(f"[banner] Re-encoding banner to {target_w}x{target_h}...")
            reenc_result = subprocess.run(reencode_cmd, capture_output=True, text=True, timeout=60)
            if reenc_result.returncode != 0:
                err_msg = reenc_result.stderr[-500:]
                print(f"[banner] Banner re-encode FAILED: {err_msg}")
                await db.execute(
                    "UPDATE video_banners SET status='error', error=$1 WHERE video_id=$2",
                    f"Banner re-encode failed: {err_msg[-200:]}", video_id,
                )
                return

            if not os.path.exists(banner_reenc) or os.path.getsize(banner_reenc) == 0:
                print(f"[banner] Banner re-encode produced empty file")
                await db.execute(
                    "UPDATE video_banners SET status='error', error='Banner re-encode produced empty file' WHERE video_id=$1",
                    video_id,
                )
                return

            # Re-encode original to match target resolution and fps
            orig_reenc = os.path.join(banner_dir, "orig_reenc.mp4")
            orig_reencode_cmd = [
                settings.FFMPEG_PATH, "-y",
                "-i", source_path,
                "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                "-vf", f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2",
                "-pix_fmt", "yuv420p",
                "-r", str(orig_fps),
            ]
            if has_audio:
                orig_reencode_cmd += ["-c:a", "aac", "-b:a", "128k"]
            else:
                orig_reencode_cmd += ["-an"]
            orig_reencode_cmd.append(orig_reenc)

            print(f"[banner] Re-encoding original for concat compatibility...")
            orig_reenc_result = subprocess.run(orig_reencode_cmd, capture_output=True, text=True, timeout=600)

            if orig_reenc_result.returncode != 0 or not os.path.exists(orig_reenc) or os.path.getsize(orig_reenc) == 0:
                err_msg = orig_reenc_result.stderr[-500:] if orig_reenc_result.returncode != 0 else "empty output"
                print(f"[banner] Original re-encode FAILED: {err_msg}")
                await db.execute(
                    "UPDATE video_banners SET status='error', error=$1 WHERE video_id=$2",
                    f"Original re-encode failed: {str(err_msg)[-200:]}", video_id,
                )
                return

            # Create concat list
            concat_list = os.path.join(banner_dir, "concat.txt")
            with open(concat_list, "w") as f:
                f.write(f"file '{banner_reenc}'\n")
                f.write(f"file '{orig_reenc}'\n")

            # Concat with copy (both files now have matching stream layouts)
            combined_path = os.path.join(video_dir, "raw", "original_with_banner.mp4")
            concat_cmd = [
                settings.FFMPEG_PATH, "-y",
                "-f", "concat", "-safe", "0",
                "-i", concat_list,
                "-c", "copy",
                combined_path,
            ]
            print(f"[banner] Concatenating banner + video...")
            concat_result = subprocess.run(concat_cmd, capture_output=True, text=True, timeout=300)

            if concat_result.returncode != 0:
                print(f"[banner] Copy-concat failed, trying re-encode concat...")
                # Fallback: re-encode concat
                fallback_cmd = [
                    settings.FFMPEG_PATH, "-y",
                    "-f", "concat", "-safe", "0",
                    "-i", concat_list,
                    "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                    "-pix_fmt", "yuv420p",
                ]
                if has_audio:
                    fallback_cmd += ["-c:a", "aac", "-b:a", "128k"]
                else:
                    fallback_cmd += ["-an"]
                fallback_cmd.append(combined_path)
                concat_result = subprocess.run(fallback_cmd, capture_output=True, text=True, timeout=600)

            if concat_result.returncode == 0 and os.path.exists(combined_path):
                # Backup original (only first time)
                if not os.path.exists(backup_path):
                    shutil.copy2(raw_path, backup_path)
                shutil.move(combined_path, raw_path)

                # Clean up temp files
                for f in [banner_reenc, orig_reenc]:
                    if f != source_path and os.path.exists(f):
                        try:
                            os.remove(f)
                        except Exception:
                            pass

                # Trigger re-transcode
                await pool.execute("UPDATE videos SET status='processing' WHERE id=$1", video_id)
                await pool.execute("INSERT INTO transcode_jobs (video_id) VALUES ($1)", video_id)
                print(f"[banner] Banner prepended, re-transcode queued for {video_id}")
            else:
                error = f"FFmpeg concat failed: {concat_result.stderr[-300:]}"
                print(f"[banner] ERROR: {error}")
                await pool.execute(
                    "UPDATE video_banners SET status='error', error=$1 WHERE video_id=$2",
                    error, video_id,
                )
                return

        banner_hls_path = f"/streams/{video_id}/banner/banner.mp4"
        await pool.execute(
            "UPDATE video_banners SET status='ready', banner_video_path=$1 WHERE video_id=$2",
            banner_hls_path, video_id,
        )
        print(f"[banner] Banner generation complete for {video_id}")

    except Exception as e:
        print(f"[banner] Unexpected error: {e}")
        try:
            await pool.execute(
                "UPDATE video_banners SET status='error', error=$1 WHERE video_id=$2",
                str(e)[:500], video_id,
            )
        except Exception:
            pass
    finally:
        await pool.close()


@router.post("/videos/{video_id}/banner/generate")
async def admin_generate_banner(
    video_id: str, background_tasks: BackgroundTasks, admin: dict = Depends(require_admin)
):
    db = await get_db()
    banner = await db.fetchrow("SELECT * FROM video_banners WHERE video_id = $1", video_id)
    if not banner:
        raise HTTPException(status_code=404, detail="No banner config found. Save banner settings first.")

    if banner["status"] == "generating":
        raise HTTPException(status_code=409, detail="Banner is already being generated")

    await db.execute(
        "UPDATE video_banners SET status='generating', error=NULL WHERE video_id=$1", video_id
    )

    background_tasks.add_task(_generate_banner_video, video_id, settings.DATABASE_URL)
    return {"message": "Banner generation started"}
