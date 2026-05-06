from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class MemeResponse(BaseModel):
    id: str
    group_id: str
    title: Optional[str] = None
    image_url: str
    link_url: Optional[str] = None
    sort_order: int


class MemeCreate(BaseModel):
    title: Optional[str] = None
    image_url: str
    link_url: Optional[str] = None
    sort_order: int = 0


class MemeUpdate(BaseModel):
    title: Optional[str] = None
    image_url: Optional[str] = None
    link_url: Optional[str] = None
    sort_order: Optional[int] = None


class MemeGroupResponse(BaseModel):
    id: str
    title: str
    slug: str
    category: str
    sort_order: int
    meme_count: int
    thumbnail: Optional[str] = None  # first meme's image_url for preview


class MemeGroupWithMemes(MemeGroupResponse):
    memes: list[MemeResponse] = []


class MemeGroupCreate(BaseModel):
    title: str
    slug: str
    category: str = "General"
    sort_order: int = 0


class MemeGroupUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    category: Optional[str] = None
    sort_order: Optional[int] = None
