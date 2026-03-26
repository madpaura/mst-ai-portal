import json
from fastapi import APIRouter

from solutions.schemas import CapabilityResponse, AnnouncementResponse, ContactRequest
from solutions.admin_schemas import SolutionCardResponse, NewsFeedResponse
from video.schemas import VideoResponse
from database import get_db

router = APIRouter()


@router.get("/solutions/landing_page")
async def get_landing_page():
    db = await get_db()
    row = await db.fetchrow("SELECT value FROM app_settings WHERE key = 'landing_page'")
    config = json.loads(row["value"]) if row else {"video_id": None, "highlights": []}
    
    video = None
    if config.get("video_id"):
        try:
            v_row = await db.fetchrow("SELECT * FROM videos WHERE id = $1 AND is_active = true", config["video_id"])
            if v_row:
                video = VideoResponse(
                    id=str(v_row["id"]), course_id=str(v_row["course_id"]) if v_row["course_id"] else None,
                    title=v_row["title"], slug=v_row["slug"], description=v_row.get("description"),
                    category=v_row["category"], duration_s=v_row.get("duration_s"),
                    status=v_row["status"], hls_path=v_row.get("hls_path"),
                    thumbnail=v_row.get("thumbnail"), is_published=v_row["is_published"],
                    sort_order=v_row["sort_order"], created_at=v_row["created_at"],
                )
        except Exception:
            pass

    return {
        "video": video,
        "highlights": config.get("highlights", [])
    }

@router.get("/solutions/capabilities", response_model=list[CapabilityResponse])
async def list_capabilities():
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM capabilities WHERE is_active = true ORDER BY sort_order"
    )
    return [
        CapabilityResponse(
            id=str(r["id"]), icon=r["icon"], title=r["title"],
            description=r["description"], sort_order=r["sort_order"],
        )
        for r in rows
    ]


@router.get("/solutions/announcements", response_model=list[AnnouncementResponse])
async def list_announcements():
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM announcements WHERE is_active = true ORDER BY created_at DESC LIMIT 10"
    )
    return [
        AnnouncementResponse(
            id=str(r["id"]), title=r["title"], content=r.get("content"),
            badge=r.get("badge"), created_at=r["created_at"],
        )
        for r in rows
    ]


@router.get("/solutions/cards", response_model=list[SolutionCardResponse])
async def list_solution_cards():
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM solution_cards WHERE is_active = true ORDER BY sort_order LIMIT 8"
    )
    return [
        SolutionCardResponse(
            id=str(r["id"]), title=r["title"], subtitle=r.get("subtitle"),
            description=r["description"], long_description=r.get("long_description"),
            icon=r.get("icon", "smart_toy"), icon_color=r.get("icon_color", "text-primary"),
            badge=r.get("badge"), link_url=r.get("link_url"),
            sort_order=r["sort_order"], is_active=r["is_active"],
            created_at=r["created_at"], updated_at=r["updated_at"],
        )
        for r in rows
    ]


@router.get("/solutions/cards/{card_id}", response_model=SolutionCardResponse)
async def get_solution_card(card_id: str):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM solution_cards WHERE id = $1 AND is_active = true", card_id
    )
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Solution card not found")
    return SolutionCardResponse(
        id=str(row["id"]), title=row["title"], subtitle=row.get("subtitle"),
        description=row["description"], long_description=row.get("long_description"),
        icon=row.get("icon", "smart_toy"), icon_color=row.get("icon_color", "text-primary"),
        badge=row.get("badge"), link_url=row.get("link_url"),
        sort_order=row["sort_order"], is_active=row["is_active"],
        created_at=row["created_at"], updated_at=row["updated_at"],
    )


@router.get("/solutions/news", response_model=list[NewsFeedResponse])
async def list_news_feed():
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM news_feed WHERE is_active = true ORDER BY published_at DESC LIMIT 20"
    )
    return [
        NewsFeedResponse(
            id=str(r["id"]), title=r["title"], summary=r["summary"],
            content=r.get("content"), source=r["source"],
            source_url=r.get("source_url"), badge=r.get("badge"),
            is_active=r["is_active"], published_at=r["published_at"],
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.get("/solutions/news/{news_id}", response_model=NewsFeedResponse)
async def get_news_item(news_id: str):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM news_feed WHERE id = $1 AND is_active = true", news_id
    )
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="News item not found")
    return NewsFeedResponse(
        id=str(row["id"]), title=row["title"], summary=row["summary"],
        content=row.get("content"), source=row["source"],
        source_url=row.get("source_url"), badge=row.get("badge"),
        is_active=row["is_active"], published_at=row["published_at"],
        created_at=row["created_at"],
    )


@router.post("/contact")
async def submit_contact(req: ContactRequest):
    db = await get_db()
    await db.execute(
        "INSERT INTO contact_submissions (name, email, message) VALUES ($1, $2, $3)",
        req.name, req.email, req.message,
    )
    return {"message": "Contact form submitted successfully"}
