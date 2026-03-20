from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SolutionCardResponse(BaseModel):
    id: str
    title: str
    subtitle: Optional[str] = None
    description: str
    long_description: Optional[str] = None
    icon: str = "smart_toy"
    icon_color: str = "text-primary"
    badge: Optional[str] = None
    link_url: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class SolutionCardCreate(BaseModel):
    title: str
    subtitle: Optional[str] = None
    description: str
    long_description: Optional[str] = None
    icon: str = "smart_toy"
    icon_color: str = "text-primary"
    badge: Optional[str] = None
    link_url: Optional[str] = None
    sort_order: int = 0


class SolutionCardUpdate(BaseModel):
    title: Optional[str] = None
    subtitle: Optional[str] = None
    description: Optional[str] = None
    long_description: Optional[str] = None
    icon: Optional[str] = None
    icon_color: Optional[str] = None
    badge: Optional[str] = None
    link_url: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class NewsFeedResponse(BaseModel):
    id: str
    title: str
    summary: str
    content: Optional[str] = None
    source: str = "manual"
    source_url: Optional[str] = None
    badge: Optional[str] = None
    is_active: bool = True
    published_at: datetime
    created_at: datetime


class NewsFeedCreate(BaseModel):
    title: str
    summary: str
    content: Optional[str] = None
    source: str = "manual"
    source_url: Optional[str] = None
    badge: Optional[str] = None


class NewsFeedUpdate(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    content: Optional[str] = None
    source: Optional[str] = None
    source_url: Optional[str] = None
    badge: Optional[str] = None
    is_active: Optional[bool] = None
