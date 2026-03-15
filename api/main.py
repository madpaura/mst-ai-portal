import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
from contextlib import asynccontextmanager

from config import settings
from database import init_db, close_db
from auth.router import router as auth_router
from auth.seed import seed_admin_user
from solutions.router import router as solutions_router
from forge.router import router as forge_router
from forge.admin_router import router as forge_admin_router
from video.router import router as video_router
from video.admin_router import router as video_admin_router
from video.course_admin_router import router as course_admin_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    if settings.AUTH_MODE == "open":
        await seed_admin_user()
    yield
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
app.include_router(forge_router, prefix="/forge", tags=["forge"])
app.include_router(forge_admin_router, prefix="/admin/forge", tags=["admin-forge"])
app.include_router(video_router, prefix="/video", tags=["video"])
app.include_router(video_admin_router, prefix="/admin", tags=["admin-video"])
app.include_router(course_admin_router, prefix="/admin", tags=["admin-courses"])


# Middleware to prevent caching of HLS manifests and segments
class NoCacheHLSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        path = request.url.path
        if path.startswith("/streams/") and (path.endswith(".m3u8") or path.endswith(".ts")):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheHLSMiddleware)

# Serve transcoded video streams (HLS segments, manifests, thumbnails)
os.makedirs(settings.VIDEO_STORAGE_PATH, exist_ok=True)
app.mount("/streams", StaticFiles(directory=settings.VIDEO_STORAGE_PATH), name="streams")


@app.get("/health")
async def health():
    return {"status": "ok"}
