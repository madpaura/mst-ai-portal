from fastapi import APIRouter

from solutions.schemas import CapabilityResponse, AnnouncementResponse, ContactRequest
from database import get_db

router = APIRouter()


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


@router.post("/contact")
async def submit_contact(req: ContactRequest):
    db = await get_db()
    await db.execute(
        "INSERT INTO contact_submissions (name, email, message) VALUES ($1, $2, $3)",
        req.name, req.email, req.message,
    )
    return {"message": "Contact form submitted successfully"}
