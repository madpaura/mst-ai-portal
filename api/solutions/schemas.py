from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class CapabilityResponse(BaseModel):
    id: str
    icon: str
    title: str
    description: str
    sort_order: int


class AnnouncementResponse(BaseModel):
    id: str
    title: str
    content: Optional[str] = None
    badge: Optional[str] = None
    created_at: datetime


class ContactRequest(BaseModel):
    name: str
    email: str
    message: str
