from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class AttachmentResponse(BaseModel):
    id: str
    article_id: str
    filename: str
    file_size: int
    mime_type: str
    url: str
    created_at: datetime


class ArticleResponse(BaseModel):
    id: str
    title: str
    slug: str
    summary: Optional[str] = None
    content: str
    category: str
    author_name: Optional[str] = None
    is_published: bool
    published_at: Optional[datetime] = None
    pdf_url: Optional[str] = None
    pdf_filename: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    attachments: list[AttachmentResponse] = []


class ArticleListResponse(BaseModel):
    id: str
    title: str
    slug: str
    summary: Optional[str] = None
    category: str
    author_name: Optional[str] = None
    is_published: bool
    published_at: Optional[datetime] = None
    created_at: datetime


class ArticleCreate(BaseModel):
    title: str
    slug: Optional[str] = ""
    summary: Optional[str] = None
    content: str = ""
    category: str = "General"
    pdf_url: Optional[str] = None
    pdf_filename: Optional[str] = None


class ArticleUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    summary: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    pdf_url: Optional[str] = None
    pdf_filename: Optional[str] = None


class InlineUploadResponse(BaseModel):
    url: str
    filename: str
    mime_type: str
    file_size: int


class BeautifyRequest(BaseModel):
    content: str


class BeautifyResponse(BaseModel):
    content: str
