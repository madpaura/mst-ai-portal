"""Admin CRUD for Ignite video series (issue #243).

Series are pure Ignite browsing buckets — organization only, no enrollment
or progress tracking (that belongs exclusively to Courses/curriculum, see
course_admin_router.py). Mirrors the old bucket-course admin CRUD.
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional

from video.schemas import SeriesResponse, SeriesCreate, SeriesUpdate
from auth.dependencies import require_content as require_admin
from database import get_db
import cache

router = APIRouter()


def _series_resp(row, video_count: int = 0, thumbnail: Optional[str] = None) -> SeriesResponse:
    return SeriesResponse(
        id=str(row["id"]), title=row["title"], slug=row["slug"],
        description=row.get("description"), sort_order=row["sort_order"],
        video_count=video_count, thumbnail=thumbnail,
        is_featured=row.get("is_featured", False),
    )


_SERIES_WITH_COUNT = """
    SELECT s.*, COUNT(v.id) as video_count
    FROM video_series s
    LEFT JOIN videos v ON v.series_id = s.id
"""


@router.get("/series", response_model=list[SeriesResponse])
async def admin_list_series(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(_SERIES_WITH_COUNT + " GROUP BY s.id ORDER BY s.sort_order")
    return [_series_resp(r, video_count=r["video_count"]) for r in rows]


@router.get("/series/{series_id}", response_model=SeriesResponse)
async def admin_get_series(series_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow(_SERIES_WITH_COUNT + " WHERE s.id = $1 GROUP BY s.id", series_id)
    if not row:
        raise HTTPException(status_code=404, detail="Series not found")
    return _series_resp(row, video_count=row["video_count"])


@router.post("/series", response_model=SeriesResponse)
async def admin_create_series(req: SeriesCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await db.fetchrow("SELECT id FROM video_series WHERE slug = $1", req.slug)
    if existing:
        raise HTTPException(status_code=409, detail="Slug already exists")

    # Only one series can be featured at a time — clear others first.
    if req.is_featured:
        await db.execute("UPDATE video_series SET is_featured = FALSE WHERE is_featured = TRUE")

    row = await db.fetchrow(
        """
        INSERT INTO video_series (title, slug, description, sort_order, is_featured)
        VALUES ($1,$2,$3,$4,$5) RETURNING *
        """,
        req.title, req.slug, req.description, req.sort_order, req.is_featured,
    )
    await cache.bump_version(cache.NS_VIDEO)
    return _series_resp(row)


@router.put("/series/{series_id}", response_model=SeriesResponse)
async def admin_update_series(
    series_id: str, req: SeriesUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM video_series WHERE id = $1", series_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Series not found")

    fields = req.model_dump(exclude_unset=True)

    if fields.get("is_featured") is True:
        await db.execute(
            "UPDATE video_series SET is_featured = FALSE WHERE is_featured = TRUE AND id <> $1",
            series_id,
        )

    if fields:
        set_parts = []
        params = [series_id]
        idx = 2
        for k, v in fields.items():
            set_parts.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        set_clause = ", ".join(set_parts)
        await db.execute(f"UPDATE video_series SET {set_clause} WHERE id = $1", *params)

    row = await db.fetchrow(_SERIES_WITH_COUNT + " WHERE s.id = $1 GROUP BY s.id", series_id)
    await cache.bump_version(cache.NS_VIDEO)
    return _series_resp(row, video_count=row["video_count"])


@router.delete("/series/{series_id}")
async def admin_delete_series(
    series_id: str,
    migrate_to_id: Optional[str] = Query(None, description="Move videos to this series before deleting"),
    delete_videos: bool = Query(False, description="Delete all videos in this series"),
    admin: dict = Depends(require_admin),
):
    db = await get_db()
    series = await db.fetchrow("SELECT * FROM video_series WHERE id = $1", series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    video_count = await db.fetchval(
        "SELECT COUNT(*) FROM videos WHERE series_id = $1", series_id
    )

    if video_count and video_count > 0:
        if migrate_to_id:
            target = await db.fetchrow("SELECT id FROM video_series WHERE id = $1", migrate_to_id)
            if not target:
                raise HTTPException(status_code=404, detail="Target series not found")
            await db.execute(
                "UPDATE videos SET series_id = $1 WHERE series_id = $2",
                migrate_to_id, series_id,
            )
        elif delete_videos:
            await db.execute("DELETE FROM videos WHERE series_id = $1", series_id)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Series has {video_count} video(s). Provide migrate_to_id or delete_videos=true.",
            )

    await db.execute("DELETE FROM video_series WHERE id = $1", series_id)
    await cache.bump_version(cache.NS_VIDEO)
    return {"message": "Series deleted"}
