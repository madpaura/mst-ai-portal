"""Progress engine for course curricula (issue #239).

Resolves per-item completion for a user by merging manual check-offs
(user_item_progress) with video watch history (user_video_progress),
computes course progress, and owns the auto-subscribe side effect on
the write path.

Completion rule: an explicit manual record always wins (so a user can
untick an auto-completed video); otherwise video items fall back to
watch-history completion and everything else defaults to not done.
"""
from datetime import datetime, timezone
from typing import Optional


def compute_pct(completed: int, total: int) -> float:
    return round((completed / total * 100) if total > 0 else 0, 1)


def suggested_week(enrolled_at: Optional[datetime], num_weeks: int) -> Optional[int]:
    """Soft pacing nudge: weeks elapsed since enrollment, clamped to the plan."""
    if enrolled_at is None or num_weeks <= 0:
        return None
    now = datetime.now(timezone.utc)
    elapsed_days = max(0, (now - enrolled_at).days)
    return min(num_weeks, elapsed_days // 7 + 1)


async def resolve_completion(db, user_id: str, course_id: str) -> dict[str, bool]:
    """Map of item_id -> completed for every item in the course."""
    rows = await db.fetch(
        """
        SELECT i.id, i.item_type,
               uip.completed AS manual_completed,
               COALESCE(uvp.completed, false) AS video_completed
        FROM course_items i
        JOIN course_modules m ON m.id = i.module_id
        LEFT JOIN user_item_progress uip ON uip.item_id = i.id AND uip.user_id = $2
        LEFT JOIN user_video_progress uvp ON uvp.video_id = i.video_id AND uvp.user_id = $2
        WHERE m.course_id = $1
        """,
        course_id, user_id,
    )
    result: dict[str, bool] = {}
    for r in rows:
        manual = r["manual_completed"]
        if manual is not None:
            done = bool(manual)
        elif r["item_type"] == "video":
            done = bool(r["video_completed"])
        else:
            done = False
        result[str(r["id"])] = done
    return result


async def course_progress(db, user_id: str, course_id: str) -> dict:
    completion = await resolve_completion(db, user_id, course_id)
    total = len(completion)
    completed = sum(1 for done in completion.values() if done)
    return {
        "completed": completed,
        "total": total,
        "pct": compute_pct(completed, total),
        "completed_item_ids": [iid for iid, done in completion.items() if done],
    }


async def set_item_progress(db, user_id: str, item_id: str, completed: bool) -> dict:
    """Upsert a manual check-off. Auto-subscribes the user to the course
    on their first interaction (agreed UX for issue #239).

    Returns {course_id, auto_enrolled}.
    """
    row = await db.fetchrow(
        """
        SELECT i.id, m.course_id
        FROM course_items i
        JOIN course_modules m ON m.id = i.module_id
        WHERE i.id = $1
        """,
        item_id,
    )
    if not row:
        return {"course_id": None, "auto_enrolled": False}
    course_id = str(row["course_id"])

    enroll_result = await db.execute(
        """
        INSERT INTO user_course_enrollments (user_id, course_id)
        VALUES ($1, $2) ON CONFLICT DO NOTHING
        """,
        user_id, course_id,
    )
    auto_enrolled = enroll_result == "INSERT 0 1"
    if auto_enrolled:
        await db.execute(
            "INSERT INTO course_analytics (user_id, course_id, event_type) VALUES ($1, $2, 'enroll')",
            user_id, course_id,
        )

    await db.execute(
        """
        INSERT INTO user_item_progress (user_id, item_id, completed, completed_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (user_id, item_id) DO UPDATE SET completed = $3, completed_at = now()
        """,
        user_id, item_id, completed,
    )
    await db.execute(
        "INSERT INTO course_analytics (user_id, course_id, event_type) VALUES ($1, $2, $3)",
        user_id, course_id, "item_complete" if completed else "item_uncomplete",
    )
    return {"course_id": course_id, "auto_enrolled": auto_enrolled}
