import os
import sys
import uuid
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from contextlib import asynccontextmanager
from loguru import logger as log

from config import settings
from database import init_db, close_db, get_db

# ── Structured logging setup ──────────────────────────────────────────────────
# In production (ENV != development) emit JSON lines so log aggregators
# (Loki, CloudWatch, Datadog) can parse fields without regex.
_LOG_ENV = os.environ.get("ENV", "development").lower()

log.remove()  # remove default stderr handler
if _LOG_ENV not in ("development", "dev", "test"):
    log.add(
        sys.stdout,
        format="{message}",
        level="INFO",
        serialize=True,  # loguru JSON: {"text":"...", "record":{...}}
    )
else:
    log.add(
        sys.stderr,
        format="<green>{time:HH:mm:ss}</green> | <level>{level:<7}</level> | {message}",
        level="DEBUG",
        colorize=True,
    )
from auth.router import router as auth_router
from auth.saml_router import router as saml_router
from auth.seed import seed_admin_user
from solutions.router import router as solutions_router
from solutions.admin_router import router as solutions_admin_router
from forge.router import router as forge_router
from forge.admin_router import router as forge_admin_router
from forge.settings_router import router as forge_settings_router
from video.router import router as video_router
from video.admin_router import router as video_admin_router
from video.course_admin_router import router as course_admin_router
from analytics.router import router as analytics_router
from analytics.admin_router import router as analytics_admin_router
from settings.router import router as settings_router
from settings.digest_admin_router import router as digest_admin_router
from articles.router import router as articles_router
from articles.admin_router import router as articles_admin_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from forge.scheduler import run_scheduler

    await init_db()
    if settings.AUTH_MODE == "open" and settings.SEED_DEFAULT_ADMIN:
        await seed_admin_user()

    # Start the nightly forge sync scheduler
    scheduler_task = asyncio.create_task(run_scheduler(settings.DATABASE_URL))

    yield

    scheduler_task.cancel()
    try:
        await scheduler_task
    except asyncio.CancelledError:
        pass
    await close_db()


app = FastAPI(
    title="MST AI Portal API",
    version="1.0.0",
    lifespan=lifespan,
)

if settings.CORS_ALLOW_ORIGIN_REGEX:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=settings.CORS_ALLOW_ORIGIN_REGEX,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    wildcard = settings.CORS_ORIGINS == ["*"] or "*" in settings.CORS_ORIGINS
    if wildcard:
        # Wildcard origin cannot be combined with allow_credentials=True.
        # For single-origin dev setups this is fine (cookie is same-origin).
        # For cross-origin production, set CORS_ORIGINS or CORS_ALLOW_ORIGIN_REGEX.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    else:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.CORS_ORIGINS,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(saml_router, prefix="/saml", tags=["saml"])
app.include_router(solutions_router, prefix="/api", tags=["solutions"])
app.include_router(solutions_admin_router, prefix="/admin/solutions", tags=["admin-solutions"])
app.include_router(forge_router, prefix="/forge", tags=["forge"])
app.include_router(forge_admin_router, prefix="/admin/forge", tags=["admin-forge"])
app.include_router(forge_settings_router, prefix="/admin/forge", tags=["admin-forge-settings"])
app.include_router(video_router, prefix="/video", tags=["video"])
app.include_router(video_admin_router, prefix="/admin", tags=["admin-video"])
app.include_router(course_admin_router, prefix="/admin", tags=["admin-courses"])
app.include_router(analytics_router, prefix="/analytics", tags=["analytics"])
app.include_router(analytics_admin_router, prefix="/admin/analytics", tags=["admin-analytics"])
app.include_router(settings_router, prefix="/settings", tags=["settings"])
app.include_router(digest_admin_router, prefix="/admin", tags=["admin-digest"])
app.include_router(articles_router, prefix="/articles", tags=["articles"])
app.include_router(articles_admin_router, prefix="/admin", tags=["admin-articles"])


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Inject X-Request-ID into every request/response; bind to log context."""
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id
        with log.contextualize(request_id=request_id,
                               method=request.method,
                               path=request.url.path):
            response: Response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

app.add_middleware(RequestIDMiddleware)


# Middleware to prevent caching of HLS manifests and segments
class NoCacheHLSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            response: Response = await call_next(request)
        except Exception as exc:
            request_id = getattr(request.state, "request_id", "unknown")
            log.error(f"[{request_id}] Unhandled error in {request.method} {request.url.path}: {exc}")
            log.error(traceback.format_exc())
            return JSONResponse(
                status_code=500,
                content={"detail": "internal_error", "request_id": request_id},
                headers={"X-Request-ID": request_id},
            )
        path = request.url.path
        if path.startswith("/streams/") and (path.endswith(".m3u8") or path.endswith(".ts")):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheHLSMiddleware)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", "unknown")
    log.error(f"[{request_id}] Unhandled exception: {exc}")
    log.error(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "internal_error", "request_id": request_id},
        headers={"X-Request-ID": request_id},
    )

# Serve transcoded video streams (HLS segments, manifests, thumbnails)
os.makedirs(settings.VIDEO_STORAGE_PATH, exist_ok=True)
app.mount("/streams", StaticFiles(directory=settings.VIDEO_STORAGE_PATH), name="streams")

# Serve media files (attachments, etc.)
os.makedirs(settings.MEDIA_STORAGE_PATH, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.MEDIA_STORAGE_PATH), name="media")


@app.get("/health")
async def health():
    import shutil
    from worker.gpu_detect import get_gpu_info
    from database import pool

    # DB liveness check
    db_ok = False
    db_error = None
    db_pool_stats = {}
    try:
        db = await get_db()
        await db.fetchval("SELECT 1")
        db_ok = True
        if pool:
            db_pool_stats = {
                "min_size": pool.get_min_size(),
                "max_size": pool.get_max_size(),
                "size": pool.get_size(),
                "idle": pool.get_idle_size(),
            }
    except Exception as exc:
        db_error = str(exc)

    # Disk space for video storage
    disk = shutil.disk_usage(settings.VIDEO_STORAGE_PATH)
    disk_info = {
        "total_gb": round(disk.total / 1e9, 1),
        "used_gb": round(disk.used / 1e9, 1),
        "free_gb": round(disk.free / 1e9, 1),
        "used_pct": round(disk.used / disk.total * 100, 1),
    }

    gpu = get_gpu_info()
    overall = "ok" if db_ok else "degraded"
    return JSONResponse(
        status_code=200 if db_ok else 503,
        content={
            "status": overall,
            "db": {"ok": db_ok, "error": db_error, "pool": db_pool_stats},
            "disk": disk_info,
            "gpu": {
                "available": gpu["gpu_available"],
                "name": gpu["gpu_name"],
                "encoder": gpu["encoder"],
            },
        },
    )
