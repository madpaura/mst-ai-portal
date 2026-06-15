import re
from typing import Optional

from database import get_db
from articles.llm import call_llm
from email_utils.utils import generate_item_email_html
from config import settings

# Human labels for the component_type column.
_TYPE_LABELS = {
    "skill": "Skill",
    "agent": "Agent",
    "mcp": "MCP Server",
    "mcp_server": "MCP Server",
    "solution": "Solution",
}


def _strip_md(text: str) -> str:
    """Reduce markdown/HTML to plain text for LLM context / plain-text part."""
    text = re.sub(r"```.*?```", " ", text or "", flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[#*`>_\-]{1,}", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


async def generate_email_preview(component_id: str, custom_content: Optional[str] = None) -> dict:
    """Generate an email preview for a marketplace component (skill / MCP / …)."""
    db = await get_db()

    comp = await db.fetchrow("SELECT * FROM forge_components WHERE id = $1", component_id)
    if not comp:
        raise ValueError("Component not found")

    type_label = _TYPE_LABELS.get(comp["component_type"], comp["component_type"].title())
    about = comp.get("long_description") or comp.get("description") or ""
    howto = _strip_md(comp.get("howto_guide") or "")
    author = comp.get("author") or "MST AI Portal"

    context = (
        f"Component Name: {comp['name']}\n"
        f"Type: {type_label}\n"
        f"Description: {comp.get('description') or '(none)'}\n"
        f"About: {_strip_md(about)[:400]}\n"
        f"Install: {comp.get('install_command') or '(none)'}"
    )
    if howto:
        context += f"\nHow-to: {howto[:300]}"

    prompt = f"""Write a very brief summary (maximum 3 lines / 3 sentences) for the following AI marketplace {type_label}.
The summary should be professional, engaging, and highlight what it does and why it is useful.
Do NOT use any HTML tags. Plain text only. Do NOT exceed 3 lines.

{context}

Return ONLY the summary text, nothing else."""
    if custom_content:
        prompt += f"\n\nAlso incorporate this note: {custom_content}"

    try:
        brief = await call_llm(prompt)
    except Exception:
        brief = _strip_md(about)[:200]

    link = f"{settings.PORTAL_URL}/marketplace/{comp['slug']}/howto"

    item = {
        "title": comp["name"],
        "description": brief or _strip_md(about)[:200],
        "category": type_label,
        "duration": f"v{comp['version']}" if comp.get("version") else "",
        "author": author,
        "author_initials": (author[:2] or "AI").upper(),
        "tag": type_label,
        "link": link,
    }

    stats = {
        "type": type_label,
        "version": comp.get("version") or "—",
        "install": "1 command",
        "guide": "View",
    }

    html_email = generate_item_email_html(
        item=item,
        related_items=[],
        stats=stats,
        issue_title="Marketplace<br><em>Spotlight</em>",
        cta_text=f"Get this {type_label}",
        cta_link=link,
        issue_label=f"Marketplace · {comp['name']}",
    )

    return {
        "subject": f"New {type_label}: {comp['name']}",
        "html_content": html_email,
        "plain_text": f"{comp['name']} ({type_label})\n\n{brief or _strip_md(about)[:200]}\n\nInstall: {comp.get('install_command') or ''}\n\nGuide: {link}",
    }
