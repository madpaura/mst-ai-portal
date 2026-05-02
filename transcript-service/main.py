"""
Transcript Service — GPU-hosted speech-to-text via faster-whisper.

Architecture:
  - A single asyncio.Queue serialises jobs (GPU handles one at a time).
  - The whisper generator runs in a ThreadPoolExecutor so the event loop is
    never blocked — /health and other endpoints stay responsive.
  - /transcribe streams Server-Sent Events (one per segment) so callers get
    partial output as each chunk is decoded.
  - /transcribe/json buffers all events and returns the legacy JSON shape for
    clients that don't speak SSE.

Environment:
  TRANSCRIPT_API_KEY   — shared secret (X-API-Key header); empty = no auth
  TRANSCRIPT_MODEL     — faster-whisper model size (default: large-v3)
  TRANSCRIPT_DEVICE    — cuda | cpu (default: cuda)
  TRANSCRIPT_COMPUTE   — float16 | int8 | float32 (default: float16)
"""

import asyncio
import concurrent.futures
import json
import logging
import os
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import AsyncIterator, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

# ── Configuration ─────────────────────────────────────────────────────────────
API_KEY = os.environ.get("TRANSCRIPT_API_KEY", "")
MODEL_SIZE = os.environ.get("TRANSCRIPT_MODEL", "large-v3")
DEVICE = os.environ.get("TRANSCRIPT_DEVICE", "cuda")
COMPUTE_TYPE = os.environ.get("TRANSCRIPT_COMPUTE", "float16")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("transcript-service")

# ── Model state ───────────────────────────────────────────────────────────────
_model = None
_model_loading = False
_model_error: Optional[str] = None

# ── Job queue & executor ──────────────────────────────────────────────────────
# One thread only: GPU can handle exactly one inference at a time.
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="whisper")
_job_queue: asyncio.Queue  # created in lifespan
_worker_task: Optional[asyncio.Task] = None

_stats = {
    "jobs_completed": 0,
    "jobs_failed": 0,
    "active_job_id": None,
    "uptime_start": None,
}


@dataclass
class _Job:
    request_id: str
    tmp_path: str
    language: Optional[str]
    # Each item: dict event or None (final sentinel)
    out: asyncio.Queue = field(default_factory=asyncio.Queue)


# ── Model loading ─────────────────────────────────────────────────────────────

def _load_model_sync():
    global _model, _model_loading, _model_error
    try:
        from faster_whisper import WhisperModel
        log.info("Loading faster-whisper model=%s device=%s compute=%s", MODEL_SIZE, DEVICE, COMPUTE_TYPE)
        t0 = time.time()
        _model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
        log.info("Model ready in %.1fs", time.time() - t0)
    except Exception as exc:
        _model_error = str(exc)
        log.error("Model load failed: %s", exc)
    finally:
        _model_loading = False


# ── Worker ────────────────────────────────────────────────────────────────────

def _transcribe_sync(model, tmp_path: str, language: Optional[str], loop: asyncio.AbstractEventLoop, out: asyncio.Queue):
    """
    Runs inside the ThreadPoolExecutor.
    Pushes SSE-style event dicts to `out` via loop.call_soon_threadsafe so the
    asyncio side can stream them without blocking.
    """
    def put(event: Optional[dict]):
        loop.call_soon_threadsafe(out.put_nowait, event)

    try:
        log.info("[thread] Starting whisper inference | language=%s", language or "auto-detect")
        t0 = time.time()
        segments_iter, info = model.transcribe(
            tmp_path,
            language=language or None,
            beam_size=5,
            word_timestamps=False,
        )
        log.info("[thread] Got stream header | language=%s duration=%.1fs", info.language, info.duration)
        put({"type": "info", "language": info.language, "duration": round(info.duration, 2)})

        seg_count = 0
        for seg in segments_iter:
            put({
                "type": "segment",
                "index": seg_count,
                "start": round(seg.start, 2),
                "end": round(seg.end, 2),
                "text": seg.text.strip(),
            })
            seg_count += 1
            if seg_count % 20 == 0:
                elapsed = time.time() - t0
                log.info("[thread] Progress: %d segments | %.1fs elapsed | last end=%.1fs", seg_count, elapsed, seg.end)

        elapsed = time.time() - t0
        log.info("[thread] Inference complete | %d segments | %.1fs total", seg_count, elapsed)

    except Exception as exc:
        log.error("[thread] Inference error: %s", exc)
        put({"type": "error", "message": str(exc)[:500]})
    finally:
        put(None)  # always terminate the stream


async def _worker():
    """Single coroutine — picks jobs from the queue and processes them one at a time."""
    loop = asyncio.get_running_loop()
    log.info("[worker] Job worker started")
    while True:
        job: _Job = await _job_queue.get()
        _stats["active_job_id"] = job.request_id
        queue_depth = _job_queue.qsize()
        log.info("[worker] Claiming job | request_id=%s | remaining_in_queue=%d", job.request_id, queue_depth)

        try:
            await loop.run_in_executor(
                _executor,
                _transcribe_sync,
                _model,
                job.tmp_path,
                job.language,
                loop,
                job.out,
            )
            _stats["jobs_completed"] += 1
            log.info("[worker] Job done | request_id=%s | total_completed=%d", job.request_id, _stats["jobs_completed"])
        except Exception as exc:
            _stats["jobs_failed"] += 1
            log.error("[worker] Job failed | request_id=%s | error=%s", job.request_id, exc)
            try:
                job.out.put_nowait({"type": "error", "message": str(exc)})
                job.out.put_nowait(None)
            except Exception:
                pass
        finally:
            _stats["active_job_id"] = None
            _job_queue.task_done()
            try:
                os.unlink(job.tmp_path)
                log.debug("[worker] Cleaned up tmp file | path=%s", job.tmp_path)
            except OSError:
                pass


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _job_queue, _worker_task, _model_loading
    _stats["uptime_start"] = time.time()
    _model_loading = True
    _job_queue = asyncio.Queue()

    # Load model in background thread (server stays up immediately)
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(_executor, _load_model_sync)

    # Start job worker
    _worker_task = asyncio.create_task(_worker(), name="job-worker")
    log.info("Service ready | model=%s device=%s", MODEL_SIZE, DEVICE)
    yield

    _worker_task.cancel()
    _executor.shutdown(wait=False)
    global _model
    _model = None


app = FastAPI(title="MST Transcript Service", lifespan=lifespan)


# ── Auth ──────────────────────────────────────────────────────────────────────

def _check_api_key(request: Request):
    if not API_KEY:
        return
    provided = request.headers.get("X-API-Key", "")
    if provided != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _enqueue_and_save(audio: UploadFile, language: Optional[str]) -> _Job:
    """Save the uploaded file to a temp path and add a job to the queue."""
    suffix = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    request_id = str(uuid.uuid4())[:8]
    job = _Job(request_id=request_id, tmp_path=tmp_path, language=language)
    queue_depth = _job_queue.qsize()
    await _job_queue.put(job)
    log.info("Job enqueued | request_id=%s | queue_depth=%d", request_id, queue_depth + 1)
    return job, queue_depth


async def _sse_stream(job: _Job, queue_depth: int) -> AsyncIterator[str]:
    """Yield SSE lines from the job's output queue until the sentinel."""
    def _ev(data: dict) -> str:
        return f"data: {json.dumps(data)}\n\n"

    if queue_depth > 0:
        log.info("[sse] request_id=%s is queued at position %d", job.request_id, queue_depth)
        yield _ev({"type": "queued", "position": queue_depth, "request_id": job.request_id})

    segments: list[dict] = []
    language = None
    duration = None

    while True:
        try:
            event = await asyncio.wait_for(job.out.get(), timeout=900.0)
        except asyncio.TimeoutError:
            log.error("[sse] Timeout waiting for job | request_id=%s", job.request_id)
            yield _ev({"type": "error", "message": "Transcription timed out (900s)"})
            return

        if event is None:
            # Sentinel — send the final summary
            full_text = " ".join(s["text"] for s in segments)
            log.info("[sse] Stream complete | request_id=%s | segments=%d", job.request_id, len(segments))
            yield _ev({
                "type": "complete",
                "language": language,
                "duration": duration,
                "segment_count": len(segments),
                "full_text": full_text,
            })
            return

        yield _ev(event)

        if event["type"] == "info":
            language = event.get("language")
            duration = event.get("duration")
        elif event["type"] == "segment":
            segments.append({"start": event["start"], "end": event["end"], "text": event["text"]})
        elif event["type"] == "error":
            # Wait for the None sentinel then return so the stream closes cleanly
            log.error("[sse] Error event received | request_id=%s | msg=%s", job.request_id, event.get("message"))


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Public — no API key required. Always fast (never blocked by inference)."""
    if _model_loading:
        return JSONResponse(status_code=503, content={
            "status": "loading",
            "model": MODEL_SIZE,
            "device": DEVICE,
            "compute": COMPUTE_TYPE,
        })
    if _model_error:
        return JSONResponse(status_code=503, content={
            "status": "error",
            "error": _model_error,
            "model": MODEL_SIZE,
            "device": DEVICE,
        })
    uptime = round(time.time() - _stats["uptime_start"], 0) if _stats["uptime_start"] else None
    return {
        "status": "ok",
        "model": MODEL_SIZE,
        "device": DEVICE,
        "compute": COMPUTE_TYPE,
        "queue_depth": _job_queue.qsize() if _job_queue else 0,
        "active_job": _stats["active_job_id"],
        "jobs_completed": _stats["jobs_completed"],
        "jobs_failed": _stats["jobs_failed"],
        "uptime_s": uptime,
    }


@app.post("/transcribe")
async def transcribe_stream(
    request: Request,
    audio: UploadFile = File(...),
    language: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
):
    """
    Stream transcription as Server-Sent Events.

    Event types (each line: `data: <json>\\n\\n`):
      queued    — {"type":"queued","position":<n>,"request_id":"..."}
      info      — {"type":"info","language":"en","duration":120.5}
      segment   — {"type":"segment","index":0,"start":0.0,"end":3.5,"text":"..."}
      complete  — {"type":"complete","language":"en","duration":120.5,"segment_count":42,"full_text":"..."}
      error     — {"type":"error","message":"..."}
    """
    _check_api_key(request)

    if _model_loading:
        raise HTTPException(status_code=503, detail="Model is still loading — try again shortly")
    if _model is None:
        raise HTTPException(status_code=503, detail=f"Model not available: {_model_error or 'unknown'}")

    log.info("POST /transcribe | filename=%s language=%s model=%s", audio.filename, language, model)
    job, queue_depth = await _enqueue_and_save(audio, language)

    return StreamingResponse(
        _sse_stream(job, queue_depth),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


@app.post("/transcribe/json")
async def transcribe_json(
    request: Request,
    audio: UploadFile = File(...),
    language: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
):
    """
    Same as /transcribe but buffers all segments and returns the legacy JSON shape.
    Use this for clients that don't speak SSE.

    Response: {"language":"en","duration":120.5,"full_text":"...","segments":[...]}
    """
    _check_api_key(request)

    if _model_loading:
        raise HTTPException(status_code=503, detail="Model is still loading — try again shortly")
    if _model is None:
        raise HTTPException(status_code=503, detail=f"Model not available: {_model_error or 'unknown'}")

    log.info("POST /transcribe/json | filename=%s language=%s", audio.filename, language)
    job, queue_depth = await _enqueue_and_save(audio, language)

    if queue_depth > 0:
        log.info("Buffered job queued at position %d | request_id=%s", queue_depth, job.request_id)

    segments: list[dict] = []
    language_out = None
    duration_out = None

    while True:
        try:
            event = await asyncio.wait_for(job.out.get(), timeout=900.0)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Transcription timed out")

        if event is None:
            break
        if event["type"] == "info":
            language_out = event["language"]
            duration_out = event["duration"]
        elif event["type"] == "segment":
            segments.append({"start": event["start"], "end": event["end"], "text": event["text"]})
        elif event["type"] == "error":
            raise HTTPException(status_code=500, detail=f"Transcription error: {event.get('message')}")

    full_text = " ".join(s["text"] for s in segments)
    log.info("Buffered transcription done | request_id=%s | segments=%d", job.request_id, len(segments))
    return {
        "language": language_out,
        "duration": duration_out,
        "full_text": full_text,
        "segments": segments,
    }


@app.get("/queue")
async def queue_status(request: Request):
    """Return current queue depth and active job. Requires API key."""
    _check_api_key(request)
    return {
        "queue_depth": _job_queue.qsize() if _job_queue else 0,
        "active_job_id": _stats["active_job_id"],
        "jobs_completed": _stats["jobs_completed"],
        "jobs_failed": _stats["jobs_failed"],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=9100, workers=1)
