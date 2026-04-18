"""Safe read-only DB queries used by the Telegram admin bot."""
from __future__ import annotations

import os
from pathlib import Path


async def get_portal_stats(db) -> dict:
    """Return a comprehensive snapshot of portal stats."""
    stats = {}

    # User counts
    row = await db.fetchrow("""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')  AS new_week,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '30 days') AS new_month,
            COUNT(*) FILTER (WHERE role = 'admin')   AS admins,
            COUNT(*) FILTER (WHERE role = 'content') AS content_creators,
            COUNT(*) FILTER (WHERE is_active = false) AS disabled
        FROM users
    """)
    stats["users"] = dict(row) if row else {}

    # Active users (had a page view in last 7 days)
    row = await db.fetchrow("""
        SELECT COUNT(DISTINCT user_id) AS active_7d
        FROM page_views
        WHERE created_at >= now() - interval '7 days'
          AND user_id IS NOT NULL
    """)
    stats["active_users_7d"] = row["active_7d"] if row else 0

    # Content counts
    row = await db.fetchrow("""
        SELECT
            (SELECT COUNT(*) FROM videos)  AS videos,
            (SELECT COUNT(*) FROM courses) AS courses,
            (SELECT COUNT(*) FROM articles WHERE is_published = true) AS articles
    """)
    stats["content"] = dict(row) if row else {}

    # Enrollments
    row = await db.fetchrow("""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE enrolled_at >= now() - interval '7 days') AS new_week
        FROM user_course_enrollments
    """)
    stats["enrollments"] = dict(row) if row else {}

    # Video progress / completions this week
    row = await db.fetchrow("""
        SELECT
            COUNT(*) FILTER (WHERE completed = true AND updated_at >= now() - interval '7 days') AS completions_week,
            COUNT(DISTINCT user_id) AS users_with_progress
        FROM user_video_progress
    """)
    stats["video_progress"] = dict(row) if row else {}

    # Page views
    row = await db.fetchrow("""
        SELECT
            COUNT(*) FILTER (WHERE created_at >= now() - interval '1 day')  AS today,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days') AS week
        FROM page_views
    """)
    stats["page_views"] = dict(row) if row else {}

    # Forge/marketplace
    row = await db.fetchrow("""
        SELECT
            COUNT(*) AS total_components,
            COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days') AS new_week
        FROM forge_components
    """)
    stats["marketplace"] = dict(row) if row else {}

    # Pending contribute requests
    row = await db.fetchrow("""
        SELECT COUNT(*) AS pending FROM contribute_requests WHERE status = 'pending'
    """)
    stats["pending_contribute_requests"] = row["pending"] if row else 0

    # DB size
    row = await db.fetchrow("""
        SELECT pg_size_pretty(pg_database_size(current_database())) AS size
    """)
    stats["db_size"] = row["size"] if row else "unknown"

    # Top 5 popular videos this week (by progress records)
    rows = await db.fetch("""
        SELECT v.title, COUNT(*) AS views
        FROM user_video_progress uvp
        JOIN videos v ON v.id = uvp.video_id
        WHERE uvp.updated_at >= now() - interval '7 days'
        GROUP BY v.id, v.title
        ORDER BY views DESC
        LIMIT 5
    """)
    stats["popular_videos_week"] = [dict(r) for r in rows]

    return stats


async def get_recent_errors(n: int = 30) -> list[str]:
    """Return last N error/warning lines from the backend log."""
    log_path = Path(__file__).parent.parent / "backend.log"
    if not log_path.exists():
        return ["No log file found at backend.log"]

    lines = []
    try:
        with open(log_path, "r", errors="replace") as f:
            all_lines = f.readlines()
        # Filter for ERROR/WARNING/CRITICAL lines, then take last n
        error_lines = [l.rstrip() for l in all_lines if any(
            kw in l for kw in ("ERROR", "WARNING", "CRITICAL", "Exception", "Traceback")
        )]
        lines = error_lines[-n:] if len(error_lines) > n else error_lines
        if not lines:
            lines = all_lines[-n:] if len(all_lines) > n else all_lines
            lines = [l.rstrip() for l in lines]
    except Exception as e:
        lines = [f"Could not read log: {e}"]
    return lines


async def get_storage_usage() -> dict:
    """Return storage directory sizes."""
    import shutil
    base = Path(__file__).parent.parent.parent / "volumes" / "storage"
    result = {}
    for name in ("videos", "media"):
        d = base / name
        if d.exists():
            total, used, free = shutil.disk_usage(str(d))
            # Walk dir to get actual used bytes
            dir_bytes = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
            result[name] = {
                "files_bytes": dir_bytes,
                "disk_free_gb": round(free / 1024**3, 1),
                "disk_total_gb": round(total / 1024**3, 1),
            }
        else:
            result[name] = {"error": "directory not found"}
    return result


async def disable_user(db, email: str) -> dict:
    """Deactivate a user account by email. Returns user info or error."""
    row = await db.fetchrow(
        "SELECT id, username, email, role, is_active FROM users WHERE email = $1",
        email,
    )
    if not row:
        return {"error": f"No user found with email: {email}"}
    if not row["is_active"]:
        return {"error": f"User {email} is already disabled"}
    if row["role"] == "admin":
        return {"error": "Cannot disable an admin account via bot"}
    await db.execute("UPDATE users SET is_active = false WHERE email = $1", email)
    return {"ok": True, "username": row["username"], "email": email}


async def enable_user(db, email: str) -> dict:
    """Re-activate a user account by email."""
    row = await db.fetchrow(
        "SELECT id, username, is_active FROM users WHERE email = $1", email
    )
    if not row:
        return {"error": f"No user found with email: {email}"}
    if row["is_active"]:
        return {"error": f"User {email} is already active"}
    await db.execute("UPDATE users SET is_active = true WHERE email = $1", email)
    return {"ok": True, "username": row["username"], "email": email}


async def get_user_info(db, email: str) -> dict:
    """Return public info about a user by email."""
    row = await db.fetchrow("""
        SELECT username, email, role, is_active, created_at,
               auth_provider
        FROM users WHERE email = $1
    """, email)
    if not row:
        return {"error": f"No user found with email: {email}"}
    return dict(row)


async def create_announcement(db, title: str, content: str, badge: str = "NEW") -> dict:
    """Insert a new announcement (visible to all users)."""
    row = await db.fetchrow("""
        INSERT INTO announcements (title, content, badge)
        VALUES ($1, $2, $3)
        RETURNING id, title, created_at
    """, title, content, badge)
    return dict(row) if row else {"error": "Insert failed"}
