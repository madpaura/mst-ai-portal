"""Public endpoint for recording page views from the frontend."""

from fastapi import APIRouter, Request, Depends
from pydantic import BaseModel
from typing import Optional

from auth.dependencies import get_optional_user
from analytics.tracker import record_page_view, record_event

router = APIRouter()


class PageViewRequest(BaseModel):
    path: str


class EventRequest(BaseModel):
    event_type: str
    section: str
    entity_id: Optional[str] = None
    entity_name: Optional[str] = None
    metadata: Optional[dict] = None


@router.post("/pageview")
async def track_pageview(
    req: PageViewRequest,
    request: Request,
    user: Optional[dict] = Depends(get_optional_user),
):
    user_id = str(user["id"]) if user else None
    await record_page_view(req.path, request, user_id)
    return {"ok": True}


@router.post("/event")
async def track_event(
    req: EventRequest,
    request: Request,
    user: Optional[dict] = Depends(get_optional_user),
):
    user_id = str(user["id"]) if user else None
    ip = request.client.host if request.client else None
    await record_event(
        event_type=req.event_type,
        section=req.section,
        entity_id=req.entity_id,
        entity_name=req.entity_name,
        user_id=user_id,
        ip_address=ip,
        metadata=req.metadata,
    )
    return {"ok": True}
