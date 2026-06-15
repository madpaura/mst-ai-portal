import re
from typing import Optional

from database import get_db
from articles.llm import call_llm
from email_utils.utils import generate_item_email_html
from config import settings


def _strip_html(html: str) -> str:
    """Collapse an HTML article body to plain text for LLM context / plain-text part."""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html or "", flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _initials(name: str) -> str:
    parts = [p for p in (name or "").split() if p]
    if not parts:
        return "AI"
    return (parts[0][0] + (parts[-1][0] if len(parts) > 1 else "")).upper()


async def generate_email_preview(article_id: str, custom_content: Optional[str] = None) -> dict:
    """Generate an email preview for a knowledge article using LLM formatting."""
    db = await get_db()

    article = await db.fetchrow(
        "SELECT * FROM articles WHERE id = $1 AND is_active = true", article_id
    )
    if not article:
        raise ValueError("Article not found")

    body = _strip_html(article["content"])
    summary = article.get("summary") or ""
    author = article.get("author_name") or "MST AI Portal"

    context = (
        f"Article Title: {article['title']}\n"
        f"Category: {article['category']}\n"
        f"Summary: {summary or '(none)'}\n"
        f"Content: {body[:500]}"
    )

    prompt = f"""Write a very brief summary (maximum 3 lines / 3 sentences) for the following knowledge article.
The summary should be professional, engaging, and highlight the key takeaway for the reader.
Do NOT use any HTML tags. Plain text only. Do NOT exceed 3 lines.

{context}

Return ONLY the summary text, nothing else."""
    if custom_content:
        prompt += f"\n\nAlso incorporate this note: {custom_content}"

    try:
        brief = await call_llm(prompt)
    except Exception:
        brief = (summary or body)[:200]

    link = f"{settings.PORTAL_URL}/articles/{article['slug']}"

    item = {
        "title": article["title"],
        "description": brief or summary or body[:200],
        "category": article["category"],
        "duration": "Read",
        "author": author,
        "author_initials": _initials(author),
        "tag": "Article",
        "link": link,
    }

    stats = {
        "category": article["category"],
        "author": author,
        "status": "Published" if article["is_published"] else "Draft",
        "read": "Open",
    }

    html_email = generate_item_email_html(
        item=item,
        related_items=[],
        stats=stats,
        issue_title="Knowledge<br><em>Update</em>",
        cta_text="Read the full article",
        cta_link=link,
        issue_label=f"Knowledge Update · {article['title']}",
    )

    return {
        "subject": f"New Article: {article['title']} - {article['category']}",
        "html_content": html_email,
        "plain_text": f"{article['title']}\n\n{brief or summary or body[:200]}\n\nRead now: {link}",
    }
