"""
Auto-mode video processing endpoints.

POST /admin/videos/{video_id}/auto-process        — kick off the full pipeline
GET  /admin/videos/{video_id}/auto-status         — per-kind job status
GET  /admin/videos/{video_id}/transcript          — fetch stored transcript JSON
PUT  /admin/videos/{video_id}/transcript          — save edited transcript
POST /admin/videos/{video_id}/auto-process/retry  — re-enqueue a single kind
POST /admin/transcript-service/test               — test transcript service connectivity
"""

import json
import os
from typing import Optional
from urllib.parse import urlparse, urlunparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from pydantic import BaseModel

from auth.dependencies import require_admin
from config import settings
from database import get_db

router = APIRouter()

_LOCAL_HOSTS = {"0.0.0.0", "localhost", "127.0.0.1"}

def _docker_url(url: str) -> str:
    """Replace loopback/unspecified hosts with host.docker.internal so the
    backend container can reach services bound on the Docker host."""
    parsed = urlparse(url)
    if parsed.hostname in _LOCAL_HOSTS:
        netloc = f"host.docker.internal:{parsed.port}" if parsed.port else "host.docker.internal"
        parsed = parsed._replace(netloc=netloc)
    return urlunparse(parsed)


# ── Schemas ──────────────────────────────────────────────────────────────────

class AutoProcessRequest(BaseModel):
    pass  # no body needed; video_id comes from path


class RetryRequest(BaseModel):
    kind: str  # transcript | metadata | chapters | howto


class TranscriptSaveRequest(BaseModel):
    full_text: str
    segments: list[dict]
    language: Optional[str] = None
    duration: Optional[float] = None


class TranscriptServiceTestRequest(BaseModel):
    url: str
    api_key: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_transcript_settings() -> dict:
    import json as _json
    db = await get_db()
    row = await db.fetchrow("SELECT value FROM app_settings WHERE key = 'transcript_config'")
    if not row:
        return {"url": None, "api_key": None, "model": "large-v3"}
    cfg = _json.loads(row["value"])
    return {
        "url": cfg.get("url"),
        "api_key": cfg.get("api_key"),
        "model": cfg.get("model") or "large-v3",
    }


async def _enqueue_auto_job(db, video_id: str, kind: str):
    """Insert a pending auto_job, replacing any prior pending/failed row for the same kind."""
    # Cancel old pending/failed job for this kind so no duplicates
    await db.execute(
        "UPDATE auto_jobs SET status = 'cancelled' WHERE video_id = $1 AND kind = $2 AND status IN ('pending', 'failed')",
        video_id, kind,
    )
    await db.fetchval(
        "INSERT INTO auto_jobs (video_id, kind) VALUES ($1, $2) RETURNING id",
        video_id, kind,
    )
    logger.info("Enqueued auto_job | video_id={} kind={}", video_id, kind)


def _transcript_path(video_id: str) -> str:
    return os.path.join(settings.VIDEO_STORAGE_PATH, video_id, "transcript.json")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/videos/{video_id}/auto-process")
async def trigger_auto_process(video_id: str, admin: dict = Depends(require_admin)):
    """Kick off the full transcript → LLM pipeline for a video."""
    logger.info("Auto-process triggered | video_id={} admin={}", video_id, admin.get("username"))
    db = await get_db()
    video = await db.fetchrow("SELECT id, status FROM videos WHERE id = $1", video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # Mark video as auto-mode and reset transcript status
    await db.execute(
        "UPDATE videos SET auto_mode = true, transcript_status = 'pending', transcript_error = NULL WHERE id = $1",
        video_id,
    )
    await _enqueue_auto_job(db, video_id, "transcript")
    return {"message": "Auto-processing queued", "video_id": video_id}


@router.get("/videos/{video_id}/auto-status")
async def get_auto_status(video_id: str, admin: dict = Depends(require_admin)):
    """Return the status of each auto-processing kind for a video."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT DISTINCT ON (kind) kind, status, error, created_at, completed_at
        FROM auto_jobs
        WHERE video_id = $1
        ORDER BY kind, created_at DESC
        """,
        video_id,
    )
    video = await db.fetchrow(
        "SELECT auto_mode, transcript_status, transcript_error FROM videos WHERE id = $1",
        video_id,
    )
    result = {r["kind"]: {"status": r["status"], "error": r["error"]} for r in rows}
    return {
        "auto_mode": video["auto_mode"] if video else False,
        "transcript_status": video["transcript_status"] if video else None,
        "transcript_error": video["transcript_error"] if video else None,
        "jobs": result,
    }


@router.get("/videos/{video_id}/transcript")
async def get_transcript(video_id: str, admin: dict = Depends(require_admin)):
    """Fetch the stored transcript JSON for a video."""
    path = _transcript_path(video_id)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Transcript not available yet")
    with open(path) as f:
        return json.load(f)


@router.put("/videos/{video_id}/transcript")
async def save_transcript(
    video_id: str, req: TranscriptSaveRequest, admin: dict = Depends(require_admin)
):
    """Save an edited transcript back to disk."""
    db = await get_db()
    video = await db.fetchrow("SELECT id FROM videos WHERE id = $1", video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    path = _transcript_path(video_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(req.dict(), f, ensure_ascii=False, indent=2)

    await db.execute(
        "UPDATE videos SET transcript_status = 'ready', transcript_path = $1 WHERE id = $2",
        path, video_id,
    )
    logger.info("Transcript saved manually | video_id={}", video_id)
    return {"message": "Transcript saved"}


@router.post("/videos/{video_id}/auto-process/retry")
async def retry_auto_job(
    video_id: str, req: RetryRequest, admin: dict = Depends(require_admin)
):
    """Re-enqueue a single failed auto-job kind."""
    valid_kinds = {"transcript", "metadata", "chapters", "howto"}
    if req.kind not in valid_kinds:
        raise HTTPException(status_code=422, detail=f"kind must be one of {sorted(valid_kinds)}")

    db = await get_db()
    video = await db.fetchrow("SELECT id FROM videos WHERE id = $1", video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    if req.kind == "transcript":
        await db.execute(
            "UPDATE videos SET transcript_status = 'pending', transcript_error = NULL WHERE id = $1",
            video_id,
        )
    await _enqueue_auto_job(db, video_id, req.kind)
    logger.info("Auto-job retry | video_id={} kind={}", video_id, req.kind)
    return {"message": f"Retry queued for kind={req.kind}"}


@router.post("/transcript-service/test")
async def test_transcript_service(
    req: TranscriptServiceTestRequest, admin: dict = Depends(require_admin)
):
    """Test connectivity to the configured transcript service."""
    url = _docker_url(req.url.rstrip("/"))
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{url}/health",
                headers={"X-API-Key": req.api_key},
            )
        if resp.status_code == 200:
            return {"ok": True, "detail": resp.json()}
        return {"ok": False, "detail": f"Service returned HTTP {resp.status_code}: {resp.text[:200]}"}
    except httpx.ConnectError:
        return {"ok": False, "detail": f"Cannot connect to {url}"}
    except Exception as e:
        return {"ok": False, "detail": str(e)[:200]}
