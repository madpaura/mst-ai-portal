from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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


@app.get("/health")
async def health():
    return {"status": "ok"}
