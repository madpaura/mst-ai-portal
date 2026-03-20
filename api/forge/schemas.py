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
    howto_guide: Optional[str] = None
    git_repo_url: Optional[str] = None
    git_ref: Optional[str] = None
    last_synced_at: Optional[datetime] = None
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
    howto_guide: Optional[str] = None


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
    howto_guide: Optional[str] = None


class ForgeCategoryResponse(BaseModel):
    component_type: str
    count: int
