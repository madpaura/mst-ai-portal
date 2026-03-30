from database import get_db
from articles.llm import call_llm
from email_utils.utils import generate_email_html
from config import settings
from typing import Optional


async def generate_email_preview(video_id: str, custom_content: Optional[str] = None) -> dict:
    """
    Generate email preview for a video using LLM formatting.
    Extracts video metadata, description, how-to guide, and chapters.
    """
    db = await get_db()

    # Fetch video details
    video = await db.fetchrow("SELECT * FROM videos WHERE id = $1", video_id)
    if not video:
        raise ValueError("Video not found")

    # Fetch how-to guide
    howto = await db.fetchrow(
        "SELECT * FROM howto_guides WHERE video_id = $1 ORDER BY created_at DESC LIMIT 1",
        video_id,
    )

    # Fetch chapters (first 5)
    chapters = await db.fetch(
        "SELECT title, start_time FROM video_chapters WHERE video_id = $1 ORDER BY sort_order LIMIT 5",
        video_id,
    )

    # Build context for LLM brief summary
    context = f"Video Title: {video['title']}\nCategory: {video['category']}\nDescription: {video.get('description', 'No description')}"
    if howto:
        context += f"\nHow-to Guide: {howto['content'][:300]}"
    if chapters:
        context += "\nKey Sections: " + ", ".join(ch['title'] for ch in chapters)

    # Use LLM to generate a brief summary (max 3 lines)
    prompt = f"""Write a very brief summary (maximum 3 lines / 3 sentences) for the following video.
The summary should be professional, engaging, and highlight the key value of watching this video.
Do NOT use any HTML tags. Plain text only. Do NOT exceed 3 lines.

{context}

Return ONLY the summary text, nothing else."""

    if custom_content:
        prompt += f"\n\nAlso incorporate this note: {custom_content}"

    try:
        brief_summary = await call_llm(prompt)
    except Exception:
        brief_summary = video.get('description', '')[:200]

    # Build featured item data (use LLM brief summary as description)
    video_data = {
        "title": video["title"],
        "description": brief_summary or video.get("description", ""),
        "category": video["category"],
        "duration": f"{video.get('duration_s', 0) // 60}:{video.get('duration_s', 0) % 60:02d}" if video.get('duration_s') else "45:30",
        "tag": "Featured",
        "author": "AI Ignite",
        "author_initials": "AI",
        "link": f"{settings.PORTAL_URL}/ignite/{video['slug']}",
    }

    # Build related items (chapters or similar content)
    related_items = []
    for ch in chapters[:3]:
        related_items.append({
            "title": ch['title'][:40],
            "category": video["category"],
            "tag": "Chapter",
            "duration": f"{ch.get('start_time', 0) // 60}:{ch.get('start_time', 0) % 60:02d}",
            "level": "Intermediate",
        })

    # Build stats
    stats = {
        "duration": f"{video.get('duration_s', 0) // 3600}h",
        "category": video["category"],
        "chapters": str(len(chapters)),
        "attachments": "View now",
    }

    html_email = generate_email_html(
        video_data=video_data,
        featured_items=related_items if related_items else None,
        stats=stats,
        issue_label=f"AI Ignite Update · {video['title']}",
    )

    return {
        "subject": f"New Video: {video['title']} - {video['category']}",
        "html_content": html_email,
        "plain_text": f"{video['title']}\n\n{brief_summary or video.get('description', '')}\n\nWatch now: {settings.PORTAL_URL}/ignite/{video['slug']}",
    }
