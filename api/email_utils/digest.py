from database import get_db
from articles.llm import call_llm
from email_utils.template import generate_digest_email
from config import settings
from datetime import datetime, timedelta
from typing import Optional


async def _llm_brief_summary(section_name: str, items_context: str) -> str:
    """Use LLM to generate a very brief summary for a digest section."""
    prompt = f"""Write a very brief summary (2-3 sentences max) for the following {section_name} section of a weekly digest newsletter.
Keep it professional, concise, and engaging. Do NOT use any HTML tags. Plain text only.

Content:
{items_context}

Return ONLY the summary text, nothing else."""
    try:
        return await call_llm(prompt)
    except Exception:
        return ""


async def generate_learning_digest(days: int = 7, custom_content: Optional[str] = None) -> dict:
    """
    Generate a comprehensive multi-page learning digest email covering:
    - Page 1: Learning (recently published videos)
    - Page 2: Marketplace (new forge components + solutions)
    - Page 3: Articles

    Each section gets an LLM-generated brief summary.

    Args:
        days: Number of days to look back (default 7 for weekly digest)
        custom_content: Optional additional content to include
    """
    db = await get_db()

    cutoff_date = datetime.utcnow() - timedelta(days=days)

    # Fetch recent videos
    recent_videos = await db.fetch(
        """
        SELECT id, title, slug, category, description, created_at
        FROM videos
        WHERE is_published = true AND is_active = true AND created_at > $1
        ORDER BY created_at DESC
        LIMIT 10
        """,
        cutoff_date,
    )

    # Fetch recent articles
    recent_articles = await db.fetch(
        """
        SELECT id, title, slug, category, summary, published_at
        FROM articles
        WHERE is_published = true AND is_active = true AND published_at > $1
        ORDER BY published_at DESC
        LIMIT 10
        """,
        cutoff_date,
    )

    # Fetch recently added forge components (marketplace)
    forge_components = await db.fetch(
        """
        SELECT slug, name, component_type, description, badge, downloads, created_at
        FROM forge_components
        WHERE is_active = true AND created_at > $1
        ORDER BY created_at DESC
        LIMIT 10
        """,
        cutoff_date,
    )

    # Also fetch featured/badged marketplace items if we have few recent ones
    if len(forge_components) < 3:
        featured_forge = await db.fetch(
            """
            SELECT slug, name, component_type, description, badge, downloads, created_at
            FROM forge_components
            WHERE is_active = true AND badge IS NOT NULL
            ORDER BY downloads DESC, created_at DESC
            LIMIT 8
            """,
        )
        existing_slugs = {fc['slug'] for fc in forge_components}
        for ff in featured_forge:
            if ff['slug'] not in existing_slugs:
                forge_components.append(ff)
                if len(forge_components) >= 8:
                    break

    # Fetch new solutions
    solutions = await db.fetch(
        """
        SELECT id, title, subtitle, description, icon, created_at
        FROM solution_cards
        WHERE is_active = true
        ORDER BY created_at DESC
        LIMIT 6
        """,
    )

    # Fetch active announcements
    announcements = await db.fetch(
        """
        SELECT title, content, badge
        FROM announcements
        WHERE is_active = true
        ORDER BY created_at DESC
        LIMIT 3
        """,
    )

    # ── LLM Summaries for each section ──────────────────────────
    video_summary = ""
    if recent_videos:
        vid_ctx = "\n".join(f"- {v['title']} ({v['category']}): {v.get('description', '')[:100]}" for v in recent_videos)
        video_summary = await _llm_brief_summary("Learning Videos", vid_ctx)

    marketplace_summary = ""
    if forge_components or solutions:
        mkt_ctx = ""
        for fc in forge_components[:6]:
            comp_type = fc['component_type'].replace('_', ' ').title()
            mkt_ctx += f"- {fc['name']} ({comp_type}): {fc.get('description', '')[:100]}\n"
        for s in solutions[:4]:
            mkt_ctx += f"- {s['title']}: {s.get('description', '')[:100]}\n"
        marketplace_summary = await _llm_brief_summary("Marketplace & Solutions", mkt_ctx)

    articles_summary = ""
    if recent_articles:
        art_ctx = "\n".join(f"- {a['title']} ({a['category']}): {a.get('summary', '')[:100]}" for a in recent_articles)
        articles_summary = await _llm_brief_summary("Articles", art_ctx)

    # ── Build page data ─────────────────────────────────────────

    # Page 1: Learning (Videos)
    learning_items = []
    for v in recent_videos[:6]:
        learning_items.append({
            "title": v['title'][:50],
            "category": v['category'],
            "tag": "Video",
            "description": v.get('description', '')[:120],
            "link": f"{settings.PORTAL_URL}/ignite/{v['slug']}",
        })

    # Page 2: Marketplace (Forge Components + Solutions)
    marketplace_items = []
    for fc in forge_components[:4]:
        comp_type = fc['component_type'].replace('_', ' ').title()
        marketplace_items.append({
            "title": fc['name'][:50],
            "category": comp_type,
            "tag": fc.get('badge', 'New') or 'New',
            "description": fc.get('description', '')[:120],
            "link": f"{settings.PORTAL_URL}/marketplace/{fc['slug']}/howto",
        })
    for s in solutions[:4]:
        marketplace_items.append({
            "title": s['title'][:50],
            "category": "Solution",
            "tag": "Solution",
            "description": s.get('description', '')[:120],
            "link": f"{settings.PORTAL_URL}/solutions",
        })

    # Page 3: Articles
    article_items = []
    for a in recent_articles[:6]:
        article_items.append({
            "title": a['title'][:50],
            "category": a['category'],
            "tag": "Article",
            "description": a.get('summary', '')[:120],
            "link": f"{settings.PORTAL_URL}/articles/{a['slug']}",
        })

    # Build stats
    stats = {
        "videos": str(len(recent_videos)),
        "marketplace": str(len(forge_components)),
        "solutions": str(len(solutions)),
        "articles": str(len(recent_articles)),
    }

    # Determine subject based on content
    parts = []
    if recent_videos:
        parts.append(f"{len(recent_videos)} Videos")
    if forge_components or solutions:
        parts.append(f"{len(forge_components) + len(solutions)} Marketplace")
    if recent_articles:
        parts.append(f"{len(recent_articles)} Articles")
    content_summary = " + ".join(parts) if parts else "Weekly Update"
    subject = f"📚 Learning Digest: {content_summary}"

    # Generate multi-page HTML
    html_email = generate_digest_email(
        days=days,
        stats=stats,
        learning_items=learning_items,
        learning_summary=video_summary,
        marketplace_items=marketplace_items,
        marketplace_summary=marketplace_summary,
        article_items=article_items,
        articles_summary=articles_summary,
        announcements=[dict(a) for a in announcements],
        custom_content=custom_content,
        portal_url=settings.PORTAL_URL,
    )

    return {
        "subject": subject,
        "html_content": html_email,
        "plain_text": f"Learning Digest\n\nCheck out the latest videos, articles, marketplace items, and solutions on the MST AI Portal!",
        "summary": {
            "videos_count": len(recent_videos),
            "articles_count": len(recent_articles),
            "components_count": len(forge_components),
            "solutions_count": len(solutions),
        },
    }
