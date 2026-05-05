from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ContactEntryResponse(BaseModel):
    id: str
    division: str
    name: str
    title: str
    email: str
    is_active: bool
    sort_order: int
    created_at: datetime


class ContactEntryCreate(BaseModel):
    division: str
    name: str
    title: str = ""
    email: str
    is_active: bool = True
    sort_order: int = 0


class ContactEntryUpdate(BaseModel):
    division: Optional[str] = None
    name: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class ContactMessageRequest(BaseModel):
    sender_name: str
    sender_email: str
    subject: str
    message: str
    contact_ids: list[str]
