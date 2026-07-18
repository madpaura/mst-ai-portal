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


@router.get("/memes/daily")
async def analytics_memes_daily(
    days: int = Query(30, ge=1, le=365),
    admin: dict = Depends(require_admin),
):
    """Daily meme click counts, zero-filled for days with no clicks."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT gs.day::date AS day, COALESCE(COUNT(mc.id), 0) AS clicks
        FROM generate_series(
            now() - ($1 || ' days')::interval,
            now(),
            '1 day'::interval
        ) AS gs(day)
        LEFT JOIN meme_clicks mc ON date_trunc('day', mc.clicked_at) = gs.day::date
        GROUP BY gs.day ORDER BY gs.day
        """,
        str(days),
    )
    return [{"day": str(r["day"]), "clicks": r["clicks"]} for r in rows]


@router.get("/memes/by-meme")
async def analytics_memes_by_meme(
    days: int = Query(30, ge=1, le=365),
    admin: dict = Depends(require_admin),
):
    """Groups with nested memes and click counts, sorted by total_clicks DESC."""
    from collections import OrderedDict
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT
            g.id           AS group_id,
            g.title        AS group_title,
            g.category     AS group_category,
            m.id           AS meme_id,
            COALESCE(m.title, 'Untitled') AS meme_title,
            m.image_url,
            m.sort_order,
            COUNT(mc.id)   AS clicks
        FROM meme_groups g
        JOIN memes m ON m.group_id = g.id
        LEFT JOIN meme_clicks mc ON mc.meme_id = m.id
            AND mc.clicked_at >= now() - ($1 || ' days')::interval
        GROUP BY g.id, g.title, g.category, m.id, m.title, m.image_url, m.sort_order
        ORDER BY g.id, clicks DESC, m.sort_order ASC
        """,
        str(days),
    )

    group_map: dict = OrderedDict()
    for r in rows:
        gid = str(r["group_id"])
        if gid not in group_map:
            group_map[gid] = {
                "group_id": gid,
                "group_title": r["group_title"],
                "group_category": r["group_category"],
                "total_clicks": 0,
                "memes": [],
            }
        clicks = r["clicks"]
        group_map[gid]["total_clicks"] += clicks
        group_map[gid]["memes"].append({
            "meme_id": str(r["meme_id"]),
            "meme_title": r["meme_title"],
            "image_url": r["image_url"],
            "clicks": clicks,
        })

    empty_groups = await db.fetch(
        "SELECT g.id, g.title, g.category FROM meme_groups g WHERE NOT EXISTS (SELECT 1 FROM memes m WHERE m.group_id = g.id)",
    )
    for eg in empty_groups:
        gid = str(eg["id"])
        if gid not in group_map:
            group_map[gid] = {
                "group_id": gid,
                "group_title": eg["title"],
                "group_category": eg["category"],
                "total_clicks": 0,
                "memes": [],
            }

    return sorted(group_map.values(), key=lambda g: g["total_clicks"], reverse=True)


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


# ── Course Metrics (issue #246) ───────────────────────────
#
# Everything here is computed on demand from the curriculum source tables
# (user_course_enrollments, user_item_progress, course_feedback,
# course_modules/course_items). The legacy course_analytics event table is
# intentionally not used.
#
# "Active learner" signal: user_course_enrollments.last_accessed_at is set
# by the table's DEFAULT now() on insert but is never updated anywhere in
# the codebase (grep confirms no UPDATE touches it), so it's frozen at
# enrollment time and useless for recency. user_item_progress.completed_at
# IS actively maintained — progress_engine.set_item_progress() upserts it
# to now() on every check-off/uncheck-off — so it's the only real recency
# signal the data maintains. "Active" therefore means "checked off (or
# unchecked) at least one curriculum item in the window", not "viewed the
# course page".

@router.get("/courses")
async def analytics_courses_overview(admin: dict = Depends(require_admin)):
    """Per-course cross-course overview: enrollment, recent activity,
    completion rate, and feedback — for every curriculum course
    (published and draft)."""
    db = await get_db()
    rows = await db.fetch(
        """
        WITH item_counts AS (
            SELECT m.course_id, COUNT(i.id) AS total_items
            FROM course_modules m
            LEFT JOIN course_items i ON i.module_id = m.id
            GROUP BY m.course_id
        ),
        enrollment_counts AS (
            SELECT course_id, COUNT(*) AS enrolled_count
            FROM user_course_enrollments
            GROUP BY course_id
        ),
        active_learners AS (
            SELECT m.course_id,
                   COUNT(DISTINCT uip.user_id)
                       FILTER (WHERE uip.completed_at >= now() - interval '7 days') AS active_7d,
                   COUNT(DISTINCT uip.user_id)
                       FILTER (WHERE uip.completed_at >= now() - interval '30 days') AS active_30d
            FROM course_modules m
            JOIN course_items i ON i.module_id = m.id
            JOIN user_item_progress uip ON uip.item_id = i.id
            GROUP BY m.course_id
        ),
        user_progress AS (
            -- Per enrolled user: how many of the course's items they have
            -- marked complete in user_item_progress.
            SELECT e.course_id, e.user_id,
                   COUNT(uip.item_id) FILTER (WHERE uip.completed = true) AS completed_items
            FROM user_course_enrollments e
            LEFT JOIN course_modules m ON m.course_id = e.course_id
            LEFT JOIN course_items i ON i.module_id = m.id
            LEFT JOIN user_item_progress uip ON uip.item_id = i.id AND uip.user_id = e.user_id
            GROUP BY e.course_id, e.user_id
        ),
        completion AS (
            SELECT up.course_id,
                   COUNT(*) FILTER (
                       WHERE ic.total_items > 0 AND up.completed_items >= ic.total_items
                   ) AS fully_completed
            FROM user_progress up
            LEFT JOIN item_counts ic ON ic.course_id = up.course_id
            GROUP BY up.course_id
        ),
        feedback AS (
            SELECT course_id,
                   ROUND(AVG(rating)::numeric, 2) AS avg_rating,
                   COUNT(*) AS rating_count
            FROM course_feedback
            GROUP BY course_id
        )
        SELECT c.id, c.slug, c.title, c.curriculum_published, c.is_active,
               COALESCE(ic.total_items, 0) AS total_items,
               COALESCE(ec.enrolled_count, 0) AS enrolled_count,
               COALESCE(al.active_7d, 0) AS active_7d,
               COALESCE(al.active_30d, 0) AS active_30d,
               COALESCE(comp.fully_completed, 0) AS fully_completed,
               f.avg_rating, COALESCE(f.rating_count, 0) AS rating_count
        FROM courses c
        LEFT JOIN item_counts ic ON ic.course_id = c.id
        LEFT JOIN enrollment_counts ec ON ec.course_id = c.id
        LEFT JOIN active_learners al ON al.course_id = c.id
        LEFT JOIN completion comp ON comp.course_id = c.id
        LEFT JOIN feedback f ON f.course_id = c.id
        ORDER BY c.sort_order, c.title
        """
    )

    result = []
    for r in rows:
        enrolled = r["enrolled_count"]
        completion_rate = (
            round(r["fully_completed"] / enrolled * 100, 1) if enrolled > 0 else 0.0
        )
        result.append({
            "id": str(r["id"]),
            "slug": r["slug"],
            "title": r["title"],
            "curriculum_published": bool(r["curriculum_published"]),
            "is_active": bool(r["is_active"]),
            "total_items": r["total_items"],
            "enrolled_count": enrolled,
            "active_7d": r["active_7d"],
            "active_30d": r["active_30d"],
            "completion_rate": completion_rate,
            "avg_rating": float(r["avg_rating"]) if r["avg_rating"] is not None else None,
            "rating_count": r["rating_count"],
        })
    return result


@router.get("/courses/enrollment-trend")
async def analytics_courses_enrollment_trend(
    days: int = Query(30, ge=1, le=365),
    admin: dict = Depends(require_admin),
):
    """Daily enrollment counts across all curriculum courses, zero-filled
    for days with no enrollments."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT gs.day::date AS day, COALESCE(COUNT(e.user_id), 0) AS enrollments
        FROM generate_series(
            now() - ($1 || ' days')::interval,
            now(),
            '1 day'::interval
        ) AS gs(day)
        LEFT JOIN user_course_enrollments e ON date_trunc('day', e.enrolled_at) = gs.day::date
        GROUP BY gs.day ORDER BY gs.day
        """,
        str(days),
    )
    return [{"day": str(r["day"]), "enrollments": r["enrollments"]} for r in rows]
