import os
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from contextlib import asynccontextmanager

from config import settings
from database import init_db, close_db
from auth.router import router as auth_router
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from forge.scheduler import run_scheduler

    await init_db()
    if settings.AUTH_MODE == "open":
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

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth", tags=["auth"])
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


# Middleware to prevent caching of HLS manifests and segments
class NoCacheHLSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            response: Response = await call_next(request)
        except Exception as exc:
            traceback.print_exc()
            return JSONResponse(
                status_code=500,
                content={"detail": str(exc)},
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
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
    )

# Serve transcoded video streams (HLS segments, manifests, thumbnails)
os.makedirs(settings.VIDEO_STORAGE_PATH, exist_ok=True)
app.mount("/streams", StaticFiles(directory=settings.VIDEO_STORAGE_PATH), name="streams")


@app.get("/health")
async def health():
    from worker.gpu_detect import get_gpu_info
    gpu = get_gpu_info()
    return {
        "status": "ok",
        "gpu": {
            "available": gpu["gpu_available"],
            "name": gpu["gpu_name"],
            "encoder": gpu["encoder"],
        },
    }
