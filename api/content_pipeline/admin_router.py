"""
Admin endpoints for the content pipeline.

POST /admin/content-pipeline/videos/{id}/reprocess   — re-run full pipeline (+ transcript)
POST /admin/content-pipeline/articles/{id}/reprocess — re-run article summarisation
GET  /admin/content-pipeline/status                  — list pending/error items
"""
from __future__ import annotations

import asyncio
from fastapi import APIRouter, HTTPException, Depends

from auth.dependencies import require_admin
from database import get_read_db

router = APIRouter(tags=["admin-content-pipeline"])


@router.post("/content-pipeline/videos/{video_id}/reprocess")
async def reprocess_video(video_id: str, admin: dict = Depends(require_admin)):
    """Trigger full content pipeline (summarise + transcribe) for a video."""
    from .pipeline import transcribe_and_update

    db = await get_read_db()
    exists = await db.fetchval("SELECT id FROM videos WHERE id = $1", video_id)
    if not exists:
        raise HTTPException(status_code=404, detail="Video not found")

    asyncio.create_task(transcribe_and_update(video_id))
    return {"message": "Content pipeline started", "video_id": video_id}


@router.post("/content-pipeline/articles/{article_id}/reprocess")
async def reprocess_article(article_id: str, admin: dict = Depends(require_admin)):
    """Trigger content pipeline (summarise) for an article."""
    from .pipeline import process_article

    db = await get_read_db()
    exists = await db.fetchval("SELECT id FROM articles WHERE id = $1", article_id)
    if not exists:
        raise HTTPException(status_code=404, detail="Article not found")

    asyncio.create_task(process_article(article_id))
    return {"message": "Content pipeline started", "article_id": article_id}


@router.get("/content-pipeline/status")
async def pipeline_status(admin: dict = Depends(require_admin)):
    """Return counts and lists of items by AI processing status."""
    db = await get_read_db()

    video_rows = await db.fetch("""
        SELECT id, title, ai_status, ai_processed_at
        FROM videos
        WHERE ai_status IN ('pending', 'processing', 'error')
        ORDER BY ai_status, created_at DESC
        LIMIT 50
    """)

    article_rows = await db.fetch("""
        SELECT id, title, ai_status, ai_processed_at
        FROM articles
        WHERE ai_status IN ('pending', 'processing', 'error')
        ORDER BY ai_status, created_at DESC
        LIMIT 50
    """)

    counts_v = await db.fetchrow("""
        SELECT
            COUNT(*) FILTER (WHERE ai_status = 'done')       AS done,
            COUNT(*) FILTER (WHERE ai_status = 'pending')    AS pending,
            COUNT(*) FILTER (WHERE ai_status = 'processing') AS processing,
            COUNT(*) FILTER (WHERE ai_status = 'error')      AS error
        FROM videos
    """)
    counts_a = await db.fetchrow("""
        SELECT
            COUNT(*) FILTER (WHERE ai_status = 'done')       AS done,
            COUNT(*) FILTER (WHERE ai_status = 'pending')    AS pending,
            COUNT(*) FILTER (WHERE ai_status = 'processing') AS processing,
            COUNT(*) FILTER (WHERE ai_status = 'error')      AS error
        FROM articles
    """)

    transcript_count = await db.fetchval("SELECT COUNT(*) FROM video_transcripts")

    return {
        "videos": {
            "counts": dict(counts_v) if counts_v else {},
            "pending_or_error": [dict(r) for r in video_rows],
        },
        "articles": {
            "counts": dict(counts_a) if counts_a else {},
            "pending_or_error": [dict(r) for r in article_rows],
        },
        "transcripts_stored": transcript_count,
    }


@router.post("/content-pipeline/videos/{video_id}/regenerate-howto")
async def regenerate_howto(video_id: str, admin: dict = Depends(require_admin)):
    """Re-generate how-to guide and chapters from existing transcript."""
    from .pipeline import generate_howto, generate_chapters

    db = await get_read_db()
    row = await db.fetchrow(
        "SELECT v.id, v.title, v.duration_s, vt.transcript FROM videos v "
        "LEFT JOIN video_transcripts vt ON vt.video_id = v.id WHERE v.id = $1",
        video_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Video not found")
    if not row["transcript"]:
        raise HTTPException(status_code=422, detail="No transcript available — upload video file first")

    import asyncio
    asyncio.create_task(generate_howto(video_id, row["title"], row["transcript"]))
    asyncio.create_task(generate_chapters(video_id, row["title"], row["transcript"], row["duration_s"]))
    return {"message": "Howto + chapters regeneration started", "video_id": video_id}


@router.post("/content-pipeline/reprocess-all-pending")
async def reprocess_all_pending(admin: dict = Depends(require_admin)):
    """Enqueue pipeline for all videos and articles with ai_status='pending' or 'error'."""
    from .pipeline import process_video, process_article

    db = await get_read_db()
    video_ids = [r["id"] for r in await db.fetch(
        "SELECT id FROM videos WHERE ai_status IN ('pending','error')"
    )]
    article_ids = [r["id"] for r in await db.fetch(
        "SELECT id FROM articles WHERE ai_status IN ('pending','error')"
    )]

    for vid in video_ids:
        asyncio.create_task(process_video(str(vid)))
    for aid in article_ids:
        asyncio.create_task(process_article(str(aid)))

    return {
        "message": "Bulk reprocess started",
        "videos_queued": len(video_ids),
        "articles_queued": len(article_ids),
    }
