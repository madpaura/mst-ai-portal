from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class CourseResponse(BaseModel):
    id: str
    title: str
    slug: str
    description: Optional[str] = None
    sort_order: int
    video_count: int = 0


class CourseCreate(BaseModel):
    title: str
    slug: str
    description: Optional[str] = None
    sort_order: int = 0


class CourseUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None


class VideoResponse(BaseModel):
    id: str
    course_id: Optional[str] = None
    title: str
    slug: str
    description: Optional[str] = None
    category: str
    duration_s: Optional[int] = None
    status: str
    hls_path: Optional[str] = None
    thumbnail: Optional[str] = None
    is_published: bool
    sort_order: int
    created_at: datetime


class VideoCreate(BaseModel):
    title: str
    slug: str
    description: Optional[str] = None
    category: str
    course_id: Optional[str] = None
    sort_order: int = 0


class VideoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    course_id: Optional[str] = None
    sort_order: Optional[int] = None


class VideoAdminResponse(VideoResponse):
    is_active: bool = True
    custom_thumbnail: Optional[str] = None
    job_status: Optional[str] = None
    job_error: Optional[str] = None


class ChapterResponse(BaseModel):
    id: str
    video_id: str
    title: str
    start_time: int
    sort_order: int


class ChapterCreate(BaseModel):
    title: str
    start_time: int
    sort_order: int = 0


class ChapterUpdate(BaseModel):
    title: Optional[str] = None
    start_time: Optional[int] = None
    sort_order: Optional[int] = None


class ChapterReorder(BaseModel):
    chapter_ids: list[str]


class ProgressResponse(BaseModel):
    video_id: str
    watched_seconds: int
    completed: bool
    last_position: int


class ProgressUpdate(BaseModel):
    last_position: int
    watched_seconds: int


class OverallProgressResponse(BaseModel):
    completed_count: int
    total_count: int
    categories: list[dict]


class NoteResponse(BaseModel):
    id: str
    video_id: str
    timestamp_s: int
    content: str
    is_seed: bool = False
    created_at: datetime


class NoteCreate(BaseModel):
    timestamp_s: int
    content: str


class NoteUpdate(BaseModel):
    content: Optional[str] = None
    timestamp_s: Optional[int] = None


class HowtoResponse(BaseModel):
    id: Optional[str] = None
    video_id: str
    title: str
    content: str
    version: str = "1.0"


class HowtoUpdate(BaseModel):
    title: str
    content: str


class QualitySettingResponse(BaseModel):
    quality: str
    enabled: bool
    crf: int


class QualitySettingUpdate(BaseModel):
    qualities: list[QualitySettingResponse]


class SeedNoteCreate(BaseModel):
    timestamp_s: int
    content: str


class SeedNoteResponse(BaseModel):
    id: str
    video_id: str
    timestamp_s: int
    content: str
    created_at: datetime


class BannerConfigResponse(BaseModel):
    id: str
    video_id: str
    variant: str
    company_logo: str
    series_tag: str
    topic: str
    subtopic: str
    episode: str
    duration: str
    presenter: str
    presenter_initial: str
    status: str
    banner_video_path: Optional[str] = None
    error: Optional[str] = None


class BannerConfigUpdate(BaseModel):
    variant: str = 'A'
    company_logo: str = 'SAMSUNG'
    series_tag: str = 'KNOWLEDGE SERIES'
    topic: str = 'Intro to AI Agents'
    subtopic: str = 'Environment Setup & First Run'
    episode: str = 'EP 01'
    duration: str = '3:15'
    presenter: str = 'Vishwa'
    presenter_initial: str = 'V'


class JobStatusResponse(BaseModel):
    id: int
    video_id: str
    status: str
    attempts: int
    max_attempts: int
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
