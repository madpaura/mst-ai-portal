import re
from typing import Optional

from database import get_db
from articles.llm import call_llm
from email_utils.utils import generate_item_email_html
from config import settings


def _strip_md(text: str) -> str:
    """Reduce markdown to plain text for LLM context / plain-text part."""
    text = re.sub(r"```.*?```", " ", text or "", flags=re.S)
    text = re.sub(r"[#*`>_\-]{1,}", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _fmt_duration(minutes: int) -> str:
    if not minutes:
        return "—"
    h, m = divmod(minutes, 60)
    if h and m:
        return f"{h}h {m}m"
    if h:
        return f"{h}h"
    return f"{m}m"


async def generate_email_preview(course_id: str, custom_content: Optional[str] = None) -> dict:
    """Generate an email preview for a course's full curriculum using LLM formatting."""
    db = await get_db()

    course = await db.fetchrow("SELECT * FROM courses WHERE id = $1", course_id)
    if not course:
        raise ValueError("Course not found")

    mod_rows = await db.fetch(
        "SELECT * FROM course_modules WHERE course_id = $1 ORDER BY sort_order, week_number",
        course_id,
    )
    item_rows = await db.fetch(
        """
        SELECT i.*, m.id AS mod_id
        FROM course_items i
        JOIN course_modules m ON m.id = i.module_id
        WHERE m.course_id = $1
        ORDER BY i.sort_order
        """,
        course_id,
    )
    items_by_module: dict[str, list] = {}
    for r in item_rows:
        items_by_module.setdefault(str(r["mod_id"]), []).append(r)

    total_duration = 0
    total_items = 0
    week_summaries = []
    for m in mod_rows:
        items = items_by_module.get(str(m["id"]), [])
        week_total = sum(i.get("duration_min") or 0 for i in items)
        total_duration += week_total
        total_items += len(items)
        week_summaries.append(
            f"Week {m['week_number']}: {m['title']}" + (f" — {m['summary']}" if m.get("summary") else "")
        )

    level = course.get("level") or ""
    tags = list(course.get("tags") or [])
    objectives = list(course.get("objectives") or [])

    context = (
        f"Course Title: {course['title']}\n"
        f"Level: {level or '(none)'}\n"
        f"Description: {course.get('description') or '(none)'}\n"
        f"Objectives: {'; '.join(objectives) if objectives else '(none)'}\n"
        f"Curriculum: {' | '.join(week_summaries) if week_summaries else '(no weeks yet)'}"
    )

    prompt = f"""Write a very brief summary (maximum 3 lines / 3 sentences) for the following course.
The summary should be professional, engaging, and highlight what learners will gain by taking this course.
Do NOT use any HTML tags. Plain text only. Do NOT exceed 3 lines.

{context}

Return ONLY the summary text, nothing else."""
    if custom_content:
        prompt += f"\n\nAlso incorporate this note: {custom_content}"

    try:
        brief = await call_llm(prompt)
    except Exception:
        brief = (course.get("description") or "")[:200]

    link = f"{settings.PORTAL_URL}/courses/{course['slug']}"

    item = {
        "title": course["title"],
        "description": brief or course.get("description") or "",
        "category": level or "Course",
        "duration": _fmt_duration(total_duration),
        "author": "MST AI Portal",
        "author_initials": "AI",
        "tag": "Course",
        "link": link,
    }

    related_items = []
    for m in mod_rows[:3]:
        items = items_by_module.get(str(m["id"]), [])
        week_total = sum(i.get("duration_min") or 0 for i in items)
        related_items.append({
            "title": f"Week {m['week_number']}: {m['title']}"[:60],
            "description": (m.get("summary") or "")[:140],
            "category": level or "Course",
            "tag": f"Week {m['week_number']}",
            "duration": f"{len(items)} item{'s' if len(items) != 1 else ''} · {_fmt_duration(week_total)}",
            "link": link,
        })

    stats = {
        "weeks": str(len(mod_rows)),
        "items": str(total_items),
        "duration": _fmt_duration(total_duration),
        "level": level or "—",
    }

    html_email = generate_item_email_html(
        item=item,
        related_items=related_items,
        stats=stats,
        issue_title="New Course",
        cta_text="View the full curriculum",
        cta_link=link,
        issue_label=f"Course Update · {course['title']}",
    )

    return {
        "subject": f"New Course: {course['title']}" + (f" - {level}" if level else ""),
        "html_content": html_email,
        "plain_text": f"{course['title']}\n\n{brief or course.get('description') or ''}\n\nView the curriculum: {link}",
    }
