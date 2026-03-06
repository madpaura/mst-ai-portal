from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ForgeComponentResponse(BaseModel):
    id: str
    slug: str
    name: str
    component_type: str
    description: Optional[str] = None
    long_description: Optional[str] = None
    icon: Optional[str] = None
    icon_color: Optional[str] = None
    version: str
    install_command: str
    badge: Optional[str] = None
    author: Optional[str] = None
    downloads: int = 0
    tags: list[str] = []
    is_active: bool = True
    created_at: datetime
    updated_at: datetime


class ForgeComponentCreate(BaseModel):
    slug: str
    name: str
    component_type: str
    description: Optional[str] = None
    long_description: Optional[str] = None
    icon: Optional[str] = None
    icon_color: Optional[str] = None
    version: str
    install_command: str
    badge: Optional[str] = None
    author: Optional[str] = None
    tags: list[str] = []


class ForgeComponentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    long_description: Optional[str] = None
    icon: Optional[str] = None
    icon_color: Optional[str] = None
    version: Optional[str] = None
    install_command: Optional[str] = None
    badge: Optional[str] = None
    author: Optional[str] = None
    tags: Optional[list[str]] = None


class ForgeCategoryResponse(BaseModel):
    component_type: str
    count: int
