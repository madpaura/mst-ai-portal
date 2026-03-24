"""Admin-only analytics endpoints — comprehensive metrics for all sections."""

from fastapi import APIRouter, Depends, Query
from typing import Optional

from auth.dependencies import require_admin
from database import get_db

router = APIRouter()


@router.get("/overview")
async def analytics_overview(
    days: int = Query(30, ge=1, le=365),
    admin: dict = Depends(require_admin),
):
    """High-level summary cards: total views, unique visitors, likes, downloads."""
    db = await get_db()
    summary = await db.fetchrow(
        """
        SELECT
            (SELECT COUNT(*) FROM page_views WHERE created_at >= now() - ($1 || ' days')::interval) AS total_views,
            (SELECT COUNT(DISTINCT ip_address) FROM page_views WHERE created_at >= now() - ($1 || ' days')::interval) AS unique_visitors,
            (SELECT COUNT(*) FROM video_likes) AS total_likes,
            (SELECT COALESCE(SUM(downloads), 0) FROM forge_components) AS total_downloads,
            (SELECT COUNT(*) FROM users) AS total_users,
            (SELECT COUNT(*) FROM videos WHERE is_published = true AND is_active = true) AS published_videos,
            (SELECT COUNT(*) FROM news_feed WHERE is_active = true) AS total_news,
            (SELECT COUNT(*) FROM forge_components WHERE is_active = true) AS total_components
        """,
        str(days),
    )
    return dict(summary)


@router.get("/traffic")
async def analytics_traffic(
    days: int = Query(30, ge=1, le=365),
    admin: dict = Depends(require_admin),
):
    """Daily page-view counts, grouped by date, for charting."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT date_trunc('day', created_at)::date AS day,
               COUNT(*) AS views,
               COUNT(DISTINCT ip_address) AS unique_visitors
        FROM page_views
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY day ORDER BY day
        """,
        str(days),
    )
    return [{"day": str(r["day"]), "views": r["views"], "unique_visitors": r["unique_visitors"]} for r in rows]


@router.get("/traffic/by-section")
async def analytics_traffic_by_section(
    days: int = Query(30, ge=1, le=365),
    admin: dict = Depends(require_admin),
):
    """Page views broken down by section."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT section, COUNT(*) AS views, COUNT(DISTINCT ip_address) AS unique_visitors
        FROM page_views
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY section ORDER BY views DESC
        """,
        str(days),
    )
    return [dict(r) for r in rows]


@router.get("/traffic/top-pages")
async def analytics_top_pages(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(20, ge=1, le=100),
    admin: dict = Depends(require_admin),
):
    """Most visited paths."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT path, COUNT(*) AS views, COUNT(DISTINCT ip_address) AS unique_visitors
        FROM page_views
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY path ORDER BY views DESC LIMIT $2
        """,
        str(days), limit,
    )
    return [dict(r) for r in rows]


@router.get("/traffic/visitors")
async def analytics_visitors(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    admin: dict = Depends(require_admin),
):
    """Top visitor IPs with frequency and last-seen info."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT
            pv.ip_address,
            COUNT(*) AS visit_count,
            COUNT(DISTINCT date_trunc('day', pv.created_at)) AS active_days,
            MAX(pv.created_at) AS last_seen,
            MIN(pv.created_at) AS first_seen,
            u.display_name AS user_name,
            u.username
        FROM page_views pv
        LEFT JOIN users u ON u.id = pv.user_id
        WHERE pv.created_at >= now() - ($1 || ' days')::interval
        GROUP BY pv.ip_address, u.display_name, u.username
        ORDER BY visit_count DESC
        LIMIT $2
        """,
        str(days), limit,
    )
    return [
        {
            "ip_address": r["ip_address"],
            "visit_count": r["visit_count"],
            "active_days": r["active_days"],
            "last_seen": str(r["last_seen"]) if r["last_seen"] else None,
            "first_seen": str(r["first_seen"]) if r["first_seen"] else None,
            "user_name": r["user_name"],
            "username": r["username"],
        }
        for r in rows
    ]


# ── Marketplace Metrics ───────────────────────────────────

@router.get("/marketplace")
async def analytics_marketplace(
    days: int = Query(30, ge=1, le=365),
    admin: dict = Depends(require_admin),
):
    """Marketplace component download stats."""
    db = await get_db()
    components = await db.fetch(
        """
        SELECT fc.name, fc.slug, fc.component_type, fc.downloads,
               COUNT(fie.id) FILTER (WHERE fie.installed_at >= now() - ($1 || ' days')::interval) AS recent_installs
        FROM forge_components fc
        LEFT JOIN forge_install_events fie ON fie.component_id = fc.id
        WHERE fc.is_active = true
        GROUP BY fc.id ORDER BY fc.downloads DESC
        """,
        str(days),
    )
    daily = await db.fetch(
        """
        SELECT date_trunc('day', installed_at)::date AS day, COUNT(*) AS installs
        FROM forge_install_events
        WHERE installed_at >= now() - ($1 || ' days')::interval
        GROUP BY day ORDER BY day
        """,
        str(days),
    )
    return {
        "components": [dict(r) for r in components],
        "daily_installs": [{"day": str(r["day"]), "installs": r["installs"]} for r in daily],
    }


# ── Video Metrics ─────────────────────────────────────────

@router.get("/videos")
async def analytics_videos(
    days: int = Query(30, ge=1, le=365),
    admin: dict = Depends(require_admin),
):
    """Video engagement: likes, watch hours, chapter navigations."""
    db = await get_db()

    videos = await db.fetch(
        """
        SELECT v.id, v.title, v.slug, v.category, v.duration_s,
               COUNT(DISTINCT vl.user_id) AS like_count,
               COALESCE(SUM(uvp.watched_seconds), 0) AS total_watched_seconds,
               COUNT(DISTINCT uvp.user_id) AS unique_viewers
        FROM videos v
        LEFT JOIN video_likes vl ON vl.video_id = v.id
        LEFT JOIN user_video_progress uvp ON uvp.video_id = v.id
        WHERE v.is_published = true AND v.is_active = true
        GROUP BY v.id ORDER BY like_count DESC
        """
    )

    daily_likes = await db.fetch(
        """
        SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS likes
        FROM video_likes
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY day ORDER BY day
        """,
        str(days),
    )

    chapter_nav_events = await db.fetch(
        """
        SELECT entity_name, COUNT(*) AS navigations
        FROM analytics_events
        WHERE event_type = 'chapter_navigate' AND section = 'ignite'
          AND created_at >= now() - ($1 || ' days')::interval
        GROUP BY entity_name ORDER BY navigations DESC LIMIT 20
        """,
        str(days),
    )

    return {
        "videos": [
            {
                "id": str(r["id"]),
                "title": r["title"],
                "slug": r["slug"],
                "category": r["category"],
                "duration_s": r["duration_s"],
                "like_count": r["like_count"],
                "total_watched_hours": round(r["total_watched_seconds"] / 3600, 2),
                "unique_viewers": r["unique_viewers"],
            }
            for r in videos
        ],
        "daily_likes": [{"day": str(r["day"]), "likes": r["likes"]} for r in daily_likes],
        "chapter_navigations": [dict(r) for r in chapter_nav_events],
    }


# ── News Metrics ──────────────────────────────────────────

@router.get("/news")
async def analytics_news(
    days: int = Query(30, ge=1, le=365),
    admin: dict = Depends(require_admin),
):
    """News article visit counts from analytics events."""
    db = await get_db()

    articles = await db.fetch(
        """
        SELECT nf.id, nf.title, nf.badge, nf.published_at,
               COUNT(ae.id) AS visit_count
        FROM news_feed nf
        LEFT JOIN analytics_events ae ON ae.entity_id = nf.id::text
            AND ae.event_type = 'news_view'
            AND ae.created_at >= now() - ($1 || ' days')::interval
        WHERE nf.is_active = true
        GROUP BY nf.id ORDER BY visit_count DESC
        """,
        str(days),
    )

    daily_visits = await db.fetch(
        """
        SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS visits
        FROM analytics_events
        WHERE event_type = 'news_view'
          AND created_at >= now() - ($1 || ' days')::interval
        GROUP BY day ORDER BY day
        """,
        str(days),
    )

    return {
        "articles": [
            {
                "id": str(r["id"]),
                "title": r["title"],
                "badge": r["badge"],
                "published_at": str(r["published_at"]) if r["published_at"] else None,
                "visit_count": r["visit_count"],
            }
            for r in articles
        ],
        "daily_visits": [{"day": str(r["day"]), "visits": r["visits"]} for r in daily_visits],
    }


@router.get("/hourly-heatmap")
async def analytics_hourly_heatmap(
    days: int = Query(14, ge=1, le=90),
    admin: dict = Depends(require_admin),
):
    """Hourly traffic heatmap data (day-of-week × hour-of-day)."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT EXTRACT(dow FROM created_at)::int AS dow,
               EXTRACT(hour FROM created_at)::int AS hour,
               COUNT(*) AS views
        FROM page_views
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY dow, hour ORDER BY dow, hour
        """,
        str(days),
    )
    return [{"dow": r["dow"], "hour": r["hour"], "views": r["views"]} for r in rows]
