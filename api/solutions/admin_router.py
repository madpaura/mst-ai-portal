from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks

from solutions.admin_schemas import (
    SolutionCardResponse, SolutionCardCreate, SolutionCardUpdate,
    NewsFeedResponse, NewsFeedCreate, NewsFeedUpdate,
    RssFeedResponse, RssFeedCreate, RssFeedUpdate,
)
from auth.dependencies import require_admin
from database import get_db

router = APIRouter()


# ── Solution Cards CRUD ───────────────────────────────────

def _row_to_card(r) -> SolutionCardResponse:
    return SolutionCardResponse(
        id=str(r["id"]), title=r["title"], subtitle=r.get("subtitle"),
        description=r["description"], long_description=r.get("long_description"),
        icon=r.get("icon", "smart_toy"), icon_color=r.get("icon_color", "text-primary"),
        badge=r.get("badge"), link_url=r.get("link_url"), launch_url=r.get("launch_url"),
        sort_order=r["sort_order"], is_active=r["is_active"],
        created_at=r["created_at"], updated_at=r["updated_at"],
    )


@router.get("/solution-cards", response_model=list[SolutionCardResponse])
async def list_solution_cards(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch("SELECT * FROM solution_cards ORDER BY sort_order, created_at")
    return [_row_to_card(r) for r in rows]


@router.post("/solution-cards", response_model=SolutionCardResponse)
async def create_solution_card(req: SolutionCardCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    # Enforce max 8 active cards
    count = await db.fetchval("SELECT COUNT(*) FROM solution_cards WHERE is_active = true")
    if count >= 8:
        raise HTTPException(status_code=400, detail="Maximum 8 active solution cards allowed")

    row = await db.fetchrow(
        """
        INSERT INTO solution_cards
            (title, subtitle, description, long_description, icon, icon_color, badge, link_url, launch_url, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
        """,
        req.title, req.subtitle, req.description, req.long_description,
        req.icon, req.icon_color, req.badge, req.link_url, req.launch_url, req.sort_order,
    )
    return _row_to_card(row)


@router.get("/solution-cards/{card_id}", response_model=SolutionCardResponse)
async def get_solution_card(card_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM solution_cards WHERE id = $1", card_id)
    if not row:
        raise HTTPException(status_code=404, detail="Solution card not found")
    return _row_to_card(row)


@router.put("/solution-cards/{card_id}", response_model=SolutionCardResponse)
async def update_solution_card(
    card_id: str, req: SolutionCardUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM solution_cards WHERE id = $1", card_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Solution card not found")

    fields = {}
    for field in [
        "title", "subtitle", "description", "long_description", "icon",
        "icon_color", "badge", "link_url", "launch_url", "sort_order", "is_active",
    ]:
        val = getattr(req, field, None)
        if val is not None:
            fields[field] = val

    if fields:
        set_parts = []
        params = [card_id]
        idx = 2
        for k, v in fields.items():
            set_parts.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        set_parts.append("updated_at = now()")
        set_clause = ", ".join(set_parts)
        await db.execute(f"UPDATE solution_cards SET {set_clause} WHERE id = $1", *params)

    row = await db.fetchrow("SELECT * FROM solution_cards WHERE id = $1", card_id)
    return _row_to_card(row)


@router.delete("/solution-cards/{card_id}")
async def delete_solution_card(card_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute("DELETE FROM solution_cards WHERE id = $1", card_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Solution card not found")
    return {"message": "Solution card deleted"}


# ── News Feed CRUD ────────────────────────────────────────

def _row_to_news(r) -> NewsFeedResponse:
    return NewsFeedResponse(
        id=str(r["id"]), title=r["title"], summary=r["summary"],
        content=r.get("content"), source=r["source"],
        source_url=r.get("source_url"), badge=r.get("badge"),
        is_active=r["is_active"], published_at=r["published_at"],
        created_at=r["created_at"],
    )


@router.get("/news", response_model=list[NewsFeedResponse])
async def list_news(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch("SELECT * FROM news_feed ORDER BY published_at DESC")
    return [_row_to_news(r) for r in rows]


@router.post("/news", response_model=NewsFeedResponse)
async def create_news(req: NewsFeedCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow(
        """
        INSERT INTO news_feed (title, summary, content, source, source_url, badge)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
        """,
        req.title, req.summary, req.content, req.source, req.source_url, req.badge,
    )
    return _row_to_news(row)


@router.put("/news/{news_id}", response_model=NewsFeedResponse)
async def update_news(
    news_id: str, req: NewsFeedUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM news_feed WHERE id = $1", news_id)
    if not existing:
        raise HTTPException(status_code=404, detail="News item not found")

    fields = {}
    for field in ["title", "summary", "content", "source", "source_url", "badge", "is_active"]:
        val = getattr(req, field, None)
        if val is not None:
            fields[field] = val

    if fields:
        set_parts = []
        params = [news_id]
        idx = 2
        for k, v in fields.items():
            set_parts.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        set_clause = ", ".join(set_parts)
        await db.execute(f"UPDATE news_feed SET {set_clause} WHERE id = $1", *params)

    row = await db.fetchrow("SELECT * FROM news_feed WHERE id = $1", news_id)
    return _row_to_news(row)


@router.delete("/news/{news_id}")
async def delete_news(news_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute("DELETE FROM news_feed WHERE id = $1", news_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="News item not found")
    return {"message": "News item deleted"}


# ── RSS Feed Settings CRUD ───────────────────────────────

def _row_to_rss(r) -> RssFeedResponse:
    return RssFeedResponse(
        id=str(r["id"]), name=r["name"], feed_url=r["feed_url"],
        badge=r.get("badge"), is_active=r["is_active"],
        last_fetched_at=r.get("last_fetched_at"),
        items_imported=r.get("items_imported", 0),
        error=r.get("error"),
        created_at=r["created_at"], updated_at=r["updated_at"],
    )


@router.get("/rss-feeds", response_model=list[RssFeedResponse])
async def list_rss_feeds(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch("SELECT * FROM news_rss_feeds ORDER BY created_at DESC")
    return [_row_to_rss(r) for r in rows]


@router.post("/rss-feeds", response_model=RssFeedResponse)
async def create_rss_feed(req: RssFeedCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await db.fetchrow("SELECT id FROM news_rss_feeds WHERE feed_url = $1", req.feed_url)
    if existing:
        raise HTTPException(status_code=409, detail="Feed URL already exists")
    row = await db.fetchrow(
        "INSERT INTO news_rss_feeds (name, feed_url, badge) VALUES ($1,$2,$3) RETURNING *",
        req.name, req.feed_url, req.badge,
    )
    return _row_to_rss(row)


@router.put("/rss-feeds/{feed_id}", response_model=RssFeedResponse)
async def update_rss_feed(feed_id: str, req: RssFeedUpdate, admin: dict = Depends(require_admin)):
    db = await get_db()
    existing = await db.fetchrow("SELECT * FROM news_rss_feeds WHERE id = $1", feed_id)
    if not existing:
        raise HTTPException(status_code=404, detail="RSS feed not found")

    fields = {}
    for field in ["name", "feed_url", "badge", "is_active"]:
        val = getattr(req, field, None)
        if val is not None:
            fields[field] = val

    if fields:
        set_parts = []
        params = [feed_id]
        idx = 2
        for k, v in fields.items():
            set_parts.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
        set_parts.append("updated_at = now()")
        set_clause = ", ".join(set_parts)
        await db.execute(f"UPDATE news_rss_feeds SET {set_clause} WHERE id = $1", *params)

    row = await db.fetchrow("SELECT * FROM news_rss_feeds WHERE id = $1", feed_id)
    return _row_to_rss(row)


@router.delete("/rss-feeds/{feed_id}")
async def delete_rss_feed(feed_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute("DELETE FROM news_rss_feeds WHERE id = $1", feed_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="RSS feed not found")
    return {"message": "RSS feed deleted"}


@router.post("/rss-feeds/{feed_id}/sync")
async def sync_single_rss_feed(
    feed_id: str, background_tasks: BackgroundTasks, admin: dict = Depends(require_admin)
):
    db = await get_db()
    feed = await db.fetchrow("SELECT * FROM news_rss_feeds WHERE id = $1", feed_id)
    if not feed:
        raise HTTPException(status_code=404, detail="RSS feed not found")

    from config import settings
    background_tasks.add_task(_sync_rss_feed, str(feed["id"]), feed["feed_url"], feed.get("badge", "RSS"), settings.DATABASE_URL)
    return {"message": "RSS feed sync started"}


@router.post("/rss-feeds/sync-all")
async def sync_all_rss_feeds(background_tasks: BackgroundTasks, admin: dict = Depends(require_admin)):
    db = await get_db()
    feeds = await db.fetch("SELECT * FROM news_rss_feeds WHERE is_active = true")
    from config import settings
    for feed in feeds:
        background_tasks.add_task(_sync_rss_feed, str(feed["id"]), feed["feed_url"], feed.get("badge", "RSS"), settings.DATABASE_URL)
    return {"message": f"Sync started for {len(feeds)} feed(s)"}


async def _sync_rss_feed(feed_id: str, feed_url: str, badge: str, db_url: str):
    """Background task: fetch RSS feed and import new articles as news items."""
    import asyncpg
    import feedparser
    import httpx
    from datetime import datetime, timezone
    import time

    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)
    try:
        # Fetch the RSS feed
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(feed_url, headers={"User-Agent": "MST-AI-Portal/1.0 RSS Reader"})
            resp.raise_for_status()
            feed_data = feedparser.parse(resp.text)

        if feed_data.bozo and not feed_data.entries:
            error = f"Feed parse error: {str(feed_data.bozo_exception)[:200]}"
            await pool.execute(
                "UPDATE news_rss_feeds SET error=$1, updated_at=now() WHERE id=$2",
                error, feed_id,
            )
            return

        imported = 0
        for entry in feed_data.entries[:20]:
            title = entry.get("title", "").strip()
            if not title:
                continue

            summary = entry.get("summary", entry.get("description", "")).strip()
            if len(summary) > 500:
                summary = summary[:497] + "..."

            link = entry.get("link", "")
            content = entry.get("content", [{}])[0].get("value", "") if entry.get("content") else ""

            # Parse published date
            published = None
            if entry.get("published_parsed"):
                published = datetime.fromtimestamp(time.mktime(entry.published_parsed), tz=timezone.utc)
            elif entry.get("updated_parsed"):
                published = datetime.fromtimestamp(time.mktime(entry.updated_parsed), tz=timezone.utc)

            # Skip if we already have this exact title+source_url combo
            existing = await pool.fetchrow(
                "SELECT id FROM news_feed WHERE title = $1 AND source_url = $2",
                title, link,
            )
            if existing:
                continue

            await pool.execute(
                """INSERT INTO news_feed (title, summary, content, source, source_url, badge, published_at)
                   VALUES ($1, $2, $3, 'rss', $4, $5, COALESCE($6, now()))""",
                title, summary or title, content or None, link or None, badge, published,
            )
            imported += 1

        await pool.execute(
            "UPDATE news_rss_feeds SET last_fetched_at=now(), items_imported=items_imported+$1, error=NULL, updated_at=now() WHERE id=$2",
            imported, feed_id,
        )

    except Exception as e:
        try:
            await pool.execute(
                "UPDATE news_rss_feeds SET error=$1, updated_at=now() WHERE id=$2",
                str(e)[:500], feed_id,
            )
        except Exception:
            pass
    finally:
        await pool.close()
