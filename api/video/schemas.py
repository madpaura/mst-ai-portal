from pydantic import BaseModel, Field, model_validator
from typing import Literal, Optional
from datetime import datetime


class PlaylistResponse(BaseModel):
    id: str
    name: str
    video_count: int = 0
    video_slugs: list[str] = []
    created_at: datetime


class PlaylistCreate(BaseModel):
    name: str


class PlaylistUpdate(BaseModel):
    name: str


class PlaylistVideoAdd(BaseModel):
    slug: str


class SeriesResponse(BaseModel):
    """Ignite browse bucket (issue #243) — pure organization, no enrollment."""
    id: str
    title: str
    slug: str
    description: Optional[str] = None
    sort_order: int
    video_count: int = 0
    thumbnail: Optional[str] = None
    is_featured: bool = False


class SeriesCreate(BaseModel):
    title: str
    slug: str
    description: Optional[str] = None
    sort_order: int = 0
    is_featured: bool = False


class SeriesUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_featured: Optional[bool] = None


class CourseResponse(BaseModel):
    id: str
    title: str
    slug: str
    description: Optional[str] = None
    sort_order: int
    video_count: int = 0
    thumbnail: Optional[str] = None
    is_featured: bool = False
    # authored metadata for the Courses section (issue #239)
    level: Optional[str] = None
    tags: list[str] = []
    cover_image: Optional[str] = None
    objectives: list[str] = []
    prerequisites: Optional[str] = None
    curriculum_published: bool = False
    # curriculum shape, for the Admin Courses list (issue #245)
    module_count: int = 0
    item_count: int = 0


class CourseCreate(BaseModel):
    title: str
    slug: str
    description: Optional[str] = None
    sort_order: int = 0
    is_featured: bool = False
    level: Optional[str] = None
    tags: list[str] = []
    objectives: list[str] = []
    prerequisites: Optional[str] = None


class CourseUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_featured: Optional[bool] = None
    level: Optional[str] = None
    tags: Optional[list[str]] = None
    objectives: Optional[list[str]] = None
    prerequisites: Optional[str] = None


# ── Curriculum (issue #239) ─────────────────────────────────

ITEM_TYPES = ("video", "exercise", "reading", "link")


class ItemLink(BaseModel):
    label: str
    url: str


class CourseItemResponse(BaseModel):
    id: str
    module_id: str
    item_type: str
    title: str
    description: Optional[str] = None
    duration_min: int = 0
    video_id: Optional[str] = None
    video_slug: Optional[str] = None
    video_title: Optional[str] = None
    external_url: Optional[str] = None
    links: list[ItemLink] = []
    sort_order: int = 0


class CourseItemCreate(BaseModel):
    item_type: str
    title: str
    description: Optional[str] = None
    duration_min: Optional[int] = None
    video_id: Optional[str] = None
    external_url: Optional[str] = None
    links: list[ItemLink] = []


class CourseItemUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    duration_min: Optional[int] = None
    video_id: Optional[str] = None
    external_url: Optional[str] = None
    links: Optional[list[ItemLink]] = None


class CourseModuleResponse(BaseModel):
    id: str
    course_id: str
    week_number: int
    title: str
    summary: Optional[str] = None
    sort_order: int = 0
    total_duration_min: int = 0
    items: list[CourseItemResponse] = []


class CourseModuleCreate(BaseModel):
    title: str
    summary: Optional[str] = None


class CourseModuleUpdate(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None


class CurriculumResponse(BaseModel):
    course_id: str
    curriculum_published: bool = False
    total_duration_min: int = 0
    item_count: int = 0
    modules: list[CourseModuleResponse] = []


class ReorderRequest(BaseModel):
    ids: list[str]


class CurriculumPublishRequest(BaseModel):
    published: bool


# ── Public Courses section (issue #239, PR 2) ───────────────

class CourseCardResponse(BaseModel):
    """Browse card for the public Courses section."""
    id: str
    slug: str
    title: str
    description: Optional[str] = None
    level: Optional[str] = None
    tags: list[str] = []
    cover_image: Optional[str] = None
    week_count: int = 0
    item_count: int = 0
    total_duration_min: int = 0
    rating_avg: Optional[float] = None
    rating_count: int = 0
    is_enrolled: bool = False
    completed_items: int = 0
    progress_pct: float = 0


class CourseUserState(BaseModel):
    """Per-user state on the course detail page (only when logged in)."""
    is_enrolled: bool = False
    enrolled_at: Optional[str] = None
    suggested_week: Optional[int] = None
    completed_item_ids: list[str] = []
    completed: int = 0
    total: int = 0
    pct: float = 0
    feedback_rating: Optional[int] = None
    feedback_comment: Optional[str] = None


class CourseDetailResponse(BaseModel):
    course: CourseResponse
    curriculum: CurriculumResponse
    rating_avg: Optional[float] = None
    rating_count: int = 0
    user: Optional[CourseUserState] = None


class ItemProgressRequest(BaseModel):
    completed: bool = True


class ItemProgressResponse(BaseModel):
    item_id: str
    completed: bool
    auto_enrolled: bool = False
    completed_items: int = 0
    total_items: int = 0
    progress_pct: float = 0


class CourseFeedbackSubmit(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None


class CourseFeedbackResponse(BaseModel):
    rating: int
    comment: Optional[str] = None
    updated_at: Optional[datetime] = None


class CourseFeedbackAdminEntry(BaseModel):
    user_display_name: str
    rating: int
    comment: Optional[str] = None
    updated_at: Optional[datetime] = None


class VideoResponse(BaseModel):
    id: str
    series_id: Optional[str] = None
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
    transcript_status: Optional[str] = None
    author_name: Optional[str] = None


class VideoCreate(BaseModel):
    title: str
    slug: Optional[str] = ""
    description: Optional[str] = None
    category: str
    series_id: Optional[str] = None
    sort_order: int = 0


class VideoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    series_id: Optional[str] = None
    sort_order: Optional[int] = None


class VideoAdminResponse(VideoResponse):
    is_active: bool = True
    custom_thumbnail: Optional[str] = None
    job_status: Optional[str] = None
    job_error: Optional[str] = None


class ContinueWatchingResponse(VideoResponse):
    """Video + the current user's saved progress — powers Ignite's
    'Continue Watching' row (issue #244)."""
    watched_seconds: int = 0
    last_position: int = 0


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
    brand_title: str = 'AI Ignite'
    topic: str
    subtopic: str
    episode: str
    duration: str
    presenter: str
    presenter_initial: str
    banner_duration_s: int = 3
    status: str
    banner_video_path: Optional[str] = None
    error: Optional[str] = None


class BannerConfigUpdate(BaseModel):
    variant: str = 'A'
    company_logo: str = 'SAMSUNG'
    series_tag: str = 'KNOWLEDGE SERIES'
    brand_title: str = 'AI Ignite'
    topic: str = 'Intro to AI Agents'
    subtopic: str = 'Environment Setup & First Run'
    episode: str = 'EP 01'
    duration: str = '3:15'
    presenter: str = 'Vishwa'
    presenter_initial: str = 'V'
    banner_duration_s: int = 3


class VideoLikeResponse(BaseModel):
    video_id: str
    like_count: int
    user_liked: bool


class TrimRequest(BaseModel):
    start_seconds: float
    end_seconds: float


class CutRequest(BaseModel):
    start_seconds: float
    end_seconds: float


class SpeedSectionRequest(BaseModel):
    start_seconds: float
    end_seconds: float
    speed_factor: float  # 2, 4, 8, 16, 32


class AttachmentResponse(BaseModel):
    id: str
    video_id: str
    filename: str
    display_name: Optional[str] = None
    file_size: int
    mime_type: Optional[str] = None
    sort_order: int
    download_url: str
    created_at: datetime


class AttachmentUpdate(BaseModel):
    display_name: Optional[str] = None
    sort_order: Optional[int] = None


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


class VideoEditorInfoResponse(BaseModel):
    """Bootstrap payload for the standalone video editor page (issue #255)."""
    id: str
    title: str
    duration_s: Optional[int] = None
    status: str
    raw_url: str
    raw_available: bool
    source_width: Optional[int] = None
    source_height: Optional[int] = None
    aspect_ratio: Optional[float] = None


# ── Video editor EDL draft (issue #256) ────────────────────────────────────

# Speed op factor is restricted to these presets (issue #258) — slow-motion
# plus the fast-forward factors from the legacy speed-section feature.
SPEED_FACTOR_PRESETS: frozenset[float] = frozenset({0.5, 0.75, 1.25, 1.5, 2.0, 4.0, 8.0, 16.0, 32.0})


class EditorEditOp(BaseModel):
    """One non-destructive edit operation on the timeline.

    `factor` is only used by `speed` ops (issue #258 adds the UI). Speed
    factors are restricted to `SPEED_FACTOR_PRESETS`. `source` is an optional
    provenance tag — `'suggestion'` marks a cut created by accepting a
    suggestion (issue #259), purely informational for the UI.
    """
    id: str
    type: Literal['cut', 'trim', 'speed']
    start_s: float
    end_s: float
    factor: Optional[float] = None
    source: Optional[Literal['suggestion']] = None

    @model_validator(mode='after')
    def _validate_speed_factor(self) -> 'EditorEditOp':
        if self.type == 'speed':
            if self.factor is None or self.factor not in SPEED_FACTOR_PRESETS:
                raise ValueError(
                    f'speed op factor must be one of {sorted(SPEED_FACTOR_PRESETS)}, got {self.factor!r}'
                )
        return self


class EditorStyle(BaseModel):
    """Background/frame style — only used by a later slice; stored now so the
    draft round-trips the full shape from day one."""
    preset: str = 'none'
    pad_pct: float = 0
    radius_px: float = 0


# ── Silence-gap suggestions (issue #259) ────────────────────────────────────
#
# `kind` is deliberately extensible: this slice only produces 'gap' (deterministic
# transcript-timestamp gaps), but issue #262 plugs an 'llm' kind into the same
# shape (with a `reason` string explaining the flag). Suggestion `id`s are a
# deterministic hash of the rounded start/end so re-analyzing with the same
# threshold reproduces the same ids — which is what lets accepted/ignored
# review state (persisted in `video_editor_drafts.suggestions`) survive a
# re-analyze instead of resurrecting already-reviewed suggestions.

class EditorSuggestion(BaseModel):
    id: str
    kind: Literal['gap', 'llm'] = 'gap'
    start_s: float
    end_s: float
    gap_s: Optional[float] = None
    reason: Optional[str] = None
    state: Literal['open', 'accepted', 'ignored'] = 'open'


class VideoEditorDraftResponse(BaseModel):
    video_id: str
    edits: list[EditorEditOp] = []
    muted: bool = False
    style: EditorStyle = EditorStyle()
    suggestions: list[EditorSuggestion] = []
    updated_at: datetime


class VideoEditorDraftUpdate(BaseModel):
    edits: list[EditorEditOp] = []
    muted: bool = False
    style: EditorStyle = EditorStyle()


class EditorSuggestAnalyzeRequest(BaseModel):
    threshold_s: float = 2.0


class EditorSuggestAnalyzeResponse(BaseModel):
    """Result of an on-demand suggestion analysis pass.

    `transcript_status` mirrors `videos.transcript_status`; the frontend uses
    it to distinguish "ready — here are suggestions" from "not ready yet —
    offer the generate-transcript flow" without a second round trip.
    """
    transcript_status: str
    transcript_error: Optional[str] = None
    threshold_s: float
    suggestions: list[EditorSuggestion] = []


class EditorSuggestionStateUpdate(BaseModel):
    state: Literal['open', 'accepted', 'ignored']


# ── Timeline filmstrip (issue #257) ─────────────────────────────────────────

class VideoFilmstripResponse(BaseModel):
    """Filmstrip sprite metadata for the editor's timeline video track.

    `status` drives frontend polling: `generating` means an ffmpeg pass is
    in flight (or about to be); `ready` means `sprite_url` is fetchable now;
    `unavailable` means there's no raw file to sample from; `error` means
    generation failed (frontend should stop polling and show a fallback).
    """
    status: Literal['ready', 'generating', 'unavailable', 'error']
    sprite_url: Optional[str] = None
    tile_count: Optional[int] = None
    cols: Optional[int] = None
    rows: Optional[int] = None
    tile_width: Optional[int] = None
    tile_height: Optional[int] = None
    interval_s: Optional[float] = None
