import os
import re
import uuid
import bleach
from fastapi import APIRouter, HTTPException, Query, Depends, UploadFile, File
from typing import Optional

from articles.schemas import (
    ArticleResponse, ArticleListResponse, ArticleCreate, ArticleUpdate,
    BeautifyRequest, BeautifyResponse, AttachmentResponse, InlineUploadResponse,
    ArticleLikeResponse,
)
from articles.llm import call_llm
from auth.dependencies import get_current_user, get_optional_user
from database import get_db
import cache
from config import settings

router = APIRouter()

# HTML tags and attributes allowed in article content (markdown-rendered HTML)
_ALLOWED_TAGS = list(bleach.sanitizer.ALLOWED_TAGS) + [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr", "pre", "code", "blockquote",
    "table", "thead", "tbody", "tr", "th", "td",
    "img", "del", "ins", "sup", "sub",
]
_ALLOWED_ATTRS = {
    **bleach.sanitizer.ALLOWED_ATTRIBUTES,
    "a": ["href", "title", "rel"],
    "img": ["src", "alt", "title", "width", "height"],
    "th": ["align"], "td": ["align"],
}


def _sanitize(content: str) -> str:
    return bleach.clean(content, tags=_ALLOWED_TAGS, attributes=_ALLOWED_ATTRS, strip=True)


# Inline uploads (pasted images, dropped PDFs) — stored outside any single
# article so they can be uploaded before the article exists.
_INLINE_URL_PREFIX = "/media/articles/inline/"
_INLINE_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}  # no .svg (script risk)
_INLINE_PDF_EXTENSION = ".pdf"
_MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB
_MAX_INLINE_PDF_BYTES = 20 * 1024 * 1024    # 20 MB


def _validate_pdf_url(pdf_url: Optional[str]) -> Optional[str]:
    """Only allow PDFs we stored ourselves; '' clears the field."""
    if not pdf_url:
        return None
    if not pdf_url.startswith(_INLINE_URL_PREFIX) or not pdf_url.endswith(_INLINE_PDF_EXTENSION):
        raise HTTPException(status_code=400, detail="Invalid PDF URL")
    name = pdf_url[len(_INLINE_URL_PREFIX):]
    if "/" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Invalid PDF URL")
    return pdf_url


def _attachment_url(article_id: str, stored_name: str) -> str:
    return f"/media/articles/{article_id}/{stored_name}"


def _row_to_attachment(r) -> AttachmentResponse:
    return AttachmentResponse(
        id=str(r["id"]),
        article_id=str(r["article_id"]),
        filename=r["filename"],
        file_size=r["file_size"],
        mime_type=r["mime_type"],
        url=_attachment_url(str(r["article_id"]), r["file_path"].split("/")[-1]),
        created_at=r["created_at"],
    )


async def _get_attachments(db, article_id: str) -> list[AttachmentResponse]:
    rows = await db.fetch(
        "SELECT * FROM article_attachments WHERE article_id = $1 ORDER BY created_at",
        article_id,
    )
    return [_row_to_attachment(r) for r in rows]


def _row_to_response(r, attachments: list[AttachmentResponse] | None = None) -> ArticleResponse:
    return ArticleResponse(
        id=str(r["id"]), title=r["title"], slug=r["slug"],
        summary=r.get("summary"), content=r["content"],
        category=r["category"], author_name=r.get("author_name"),
        is_published=r["is_published"], published_at=r.get("published_at"),
        pdf_url=r.get("pdf_url"), pdf_filename=r.get("pdf_filename"),
        created_at=r["created_at"], updated_at=r["updated_at"],
        attachments=attachments or [],
    )


def _row_to_list(r) -> ArticleListResponse:
    return ArticleListResponse(
        id=str(r["id"]), title=r["title"], slug=r["slug"],
        summary=r.get("summary"), category=r["category"],
        author_name=r.get("author_name"), is_published=r["is_published"],
        published_at=r.get("published_at"), created_at=r["created_at"],
    )


@router.get("/categories", response_model=list[str])
async def list_categories():
    db = await get_db()
    rows = await db.fetch(
        "SELECT DISTINCT category FROM articles WHERE is_published = true AND is_active = true ORDER BY category"
    )
    return [r["category"] for r in rows]


@router.get("", response_model=list[ArticleListResponse])
async def list_articles(
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    cache_params: dict | None = None
    if search or category or limit is not None or offset:
        cache_params = {}
        if search:
            cache_params["s"] = search.strip()
        if category:
            cache_params["c"] = category
        if limit is not None:
            cache_params["l"] = limit
        if offset:
            cache_params["o"] = offset

    async def _fetch():
        db = await get_db()
        conditions = ["is_published = true", "is_active = true"]
        qparams: list = []
        idx = 1
        if category:
            conditions.append(f"category = ${idx}")
            qparams.append(category)
            idx += 1
        if search and search.strip():
            conditions.append(
                f"to_tsvector('english', title || ' ' || COALESCE(summary, '') || ' ' || content) @@ plainto_tsquery('english', ${idx})"
            )
            qparams.append(search.strip())
            idx += 1
        where = " AND ".join(conditions)
        sql = f"SELECT * FROM articles WHERE {where} ORDER BY published_at DESC"
        if limit is not None:
            qparams.append(limit)
            sql += f" LIMIT ${len(qparams)}"
        if offset:
            qparams.append(offset)
            sql += f" OFFSET ${len(qparams)}"
        rows = await db.fetch(sql, *qparams)
        return [_row_to_list(r).model_dump(mode="json") for r in rows]

    return await cache.get_or_set(cache.NS_ARTICLES, "list", "all", cache_params, settings.REDIS_DEFAULT_TTL, _fetch)


# ── Likes & view stats (power the trending sort) ───────────

@router.get("/like-counts")
async def article_like_counts() -> dict[str, int]:
    """Public per-article like counts keyed by slug. Short-TTL cached."""
    async def _fetch():
        db = await get_db()
        rows = await db.fetch(
            """
            SELECT a.slug, COUNT(l.user_id) AS likes
            FROM articles a
            JOIN article_likes l ON l.article_id = a.id
            WHERE a.is_published = true AND a.is_active = true
            GROUP BY a.slug
            """,
        )
        return {r["slug"]: r["likes"] for r in rows}
    return await cache.get_or_set(cache.NS_ARTICLES, "stats", "likes", None, 120, _fetch)


@router.get("/view-stats")
async def article_view_stats() -> dict[str, int]:
    """Public per-article view counts keyed by slug, derived from page_views.

    The detail page records a pageview at `/articles/<slug>`; editor routes
    (`/articles/new`, `/articles/edit/...`) are excluded. Short-TTL cached."""
    async def _fetch():
        db = await get_db()
        rows = await db.fetch(
            """
            SELECT path, COUNT(*) AS views
            FROM page_views
            WHERE path LIKE '/articles/%'
              AND path NOT LIKE '/articles/edit/%'
              AND path != '/articles/new'
            GROUP BY path
            """,
        )
        prefix = "/articles/"
        out: dict[str, int] = {}
        for r in rows:
            slug = r["path"][len(prefix):]
            if slug:
                out[slug] = out.get(slug, 0) + r["views"]
        return out
    return await cache.get_or_set(cache.NS_ARTICLES, "stats", "views", None, 120, _fetch)


@router.get("/my-likes")
async def list_my_likes(user: dict = Depends(get_current_user)) -> list[str]:
    """Return slugs of articles the current user has liked."""
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT a.slug
        FROM article_likes l
        JOIN articles a ON a.id = l.article_id
        WHERE l.user_id = $1 AND a.is_published = true AND a.is_active = true
        """,
        user["id"],
    )
    return [r["slug"] for r in rows]


# ── User article CRUD (authenticated) ──────────────────────

@router.get("/my", response_model=list[ArticleListResponse])
async def list_my_articles(user: dict = Depends(get_current_user)):
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM articles WHERE author_id = $1 AND is_active = true ORDER BY created_at DESC",
        user["id"],
    )
    return [_row_to_list(r) for r in rows]


@router.post("", response_model=ArticleResponse)
async def create_article(req: ArticleCreate, user: dict = Depends(get_current_user)):
    db = await get_db()

    slug = req.slug.strip() if req.slug else ""
    if not slug:
        slug = re.sub(r'[^a-z0-9]+', '-', req.title.lower()).strip('-')

    existing = await db.fetchval("SELECT id FROM articles WHERE slug = $1", slug)
    if existing:
        slug = f"{slug}-{str(existing)[:8]}"

    row = await db.fetchrow(
        """
        INSERT INTO articles (title, slug, summary, content, category, author_id, author_name, is_published, published_at, pdf_url, pdf_filename)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, now(), $8, $9) RETURNING *
        """,
        req.title, slug, req.summary, _sanitize(req.content), req.category,
        user["id"], user.get("display_name", user.get("username", "User")),
        _validate_pdf_url(req.pdf_url), req.pdf_filename,
    )
    await cache.bump_version(cache.NS_ARTICLES)
    return _row_to_response(row, [])


@router.get("/my/{article_id}", response_model=ArticleResponse)
async def get_my_article(article_id: str, user: dict = Depends(get_current_user)):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM articles WHERE id = $1 AND author_id = $2 AND is_active = true",
        article_id, user["id"],
    )
    if not row:
        raise HTTPException(status_code=404, detail="Article not found")
    attachments = await _get_attachments(db, article_id)
    return _row_to_response(row, attachments)


@router.put("/my/{article_id}", response_model=ArticleResponse)
async def update_my_article(
    article_id: str, req: ArticleUpdate, user: dict = Depends(get_current_user)
):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM articles WHERE id = $1 AND author_id = $2 AND is_active = true",
        article_id, user["id"],
    )
    if not row:
        raise HTTPException(status_code=404, detail="Article not found or not yours")

    updates = {}
    if req.title is not None:
        updates["title"] = req.title
    if req.slug is not None:
        updates["slug"] = req.slug
    if req.summary is not None:
        updates["summary"] = req.summary
    if req.content is not None:
        updates["content"] = _sanitize(req.content)
    if req.category is not None:
        updates["category"] = req.category
    if req.pdf_url is not None:
        updates["pdf_url"] = _validate_pdf_url(req.pdf_url)
    if req.pdf_filename is not None:
        updates["pdf_filename"] = req.pdf_filename or None

    if updates:
        set_clauses = [f"{k} = ${i+1}" for i, k in enumerate(updates.keys())]
        set_clauses.append("updated_at = now()")
        values = list(updates.values())
        values.append(article_id)
        await db.execute(
            f"UPDATE articles SET {', '.join(set_clauses)} WHERE id = ${len(values)}",
            *values,
        )

    row = await db.fetchrow("SELECT * FROM articles WHERE id = $1", article_id)
    attachments = await _get_attachments(db, article_id)
    await cache.bump_version(cache.NS_ARTICLES)
    return _row_to_response(row, attachments)


@router.delete("/my/{article_id}")
async def delete_my_article(article_id: str, user: dict = Depends(get_current_user)):
    db = await get_db()
    result = await db.execute(
        "UPDATE articles SET is_active = false WHERE id = $1 AND author_id = $2 AND is_active = true",
        article_id, user["id"],
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Article not found or not yours")
    await cache.bump_version(cache.NS_ARTICLES)
    return {"message": "Article deleted"}


# ── Beautify (available to all authenticated users) ─────────

@router.post("/beautify", response_model=BeautifyResponse)
async def beautify_text(req: BeautifyRequest, user: dict = Depends(get_current_user)):
    prompt = (
        "You are a technical editor. Improve the following markdown text: "
        "fix grammar, improve clarity, add proper markdown formatting "
        "(headers, lists, bold, code blocks where appropriate). "
        "Return ONLY the improved markdown, no explanation.\n\n"
        f"{req.content}"
    )
    result = await call_llm(prompt)
    return BeautifyResponse(content=result)


# ── Inline uploads: pasted images & dropped PDFs ─────────────

@router.post("/uploads", response_model=InlineUploadResponse)
async def upload_inline_file(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    is_image = ext in _INLINE_IMAGE_EXTENSIONS
    is_pdf = ext == _INLINE_PDF_EXTENSION
    if not is_image and not is_pdf:
        raise HTTPException(
            status_code=400,
            detail="File type not allowed. Allowed: PNG, JPG, GIF, WebP, PDF",
        )

    data = await file.read()
    limit = _MAX_INLINE_PDF_BYTES if is_pdf else _MAX_INLINE_IMAGE_BYTES
    if len(data) > limit:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds {limit // (1024 * 1024)} MB limit",
        )

    stored_name = f"{uuid.uuid4()}{ext}"
    dir_path = os.path.join(settings.MEDIA_STORAGE_PATH, "articles", "inline")
    os.makedirs(dir_path, exist_ok=True)
    with open(os.path.join(dir_path, stored_name), "wb") as f:
        f.write(data)

    return InlineUploadResponse(
        url=f"{_INLINE_URL_PREFIX}{stored_name}",
        filename=file.filename or stored_name,
        mime_type=file.content_type or ("application/pdf" if is_pdf else "image/*"),
        file_size=len(data),
    )


# ── Public article by slug (must be LAST — catches {slug}) ──

@router.get("/{slug}", response_model=ArticleResponse)
async def get_article(slug: str):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM articles WHERE slug = $1 AND is_published = true AND is_active = true",
        slug,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Article not found")
    attachments = await _get_attachments(db, str(row["id"]))
    return _row_to_response(row, attachments)


# ── Per-article likes (thumbs up) ──────────────────────────

async def _published_article(db, slug: str):
    row = await db.fetchrow(
        "SELECT id FROM articles WHERE slug = $1 AND is_published = true AND is_active = true",
        slug,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Article not found")
    return row


@router.get("/{slug}/likes", response_model=ArticleLikeResponse)
async def get_article_likes(slug: str, user: Optional[dict] = Depends(get_optional_user)):
    db = await get_db()
    article = await _published_article(db, slug)
    count = await db.fetchval(
        "SELECT COUNT(*) FROM article_likes WHERE article_id = $1", article["id"]
    )
    user_liked = False
    if user:
        row = await db.fetchrow(
            "SELECT 1 FROM article_likes WHERE user_id = $1 AND article_id = $2",
            user["id"], article["id"],
        )
        user_liked = row is not None
    return ArticleLikeResponse(article_id=str(article["id"]), like_count=count, user_liked=user_liked)


@router.post("/{slug}/likes", response_model=ArticleLikeResponse)
async def like_article(slug: str, user: dict = Depends(get_current_user)):
    db = await get_db()
    article = await _published_article(db, slug)
    await db.execute(
        "INSERT INTO article_likes (user_id, article_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        user["id"], article["id"],
    )
    count = await db.fetchval(
        "SELECT COUNT(*) FROM article_likes WHERE article_id = $1", article["id"]
    )
    return ArticleLikeResponse(article_id=str(article["id"]), like_count=count, user_liked=True)


@router.delete("/{slug}/likes", response_model=ArticleLikeResponse)
async def unlike_article(slug: str, user: dict = Depends(get_current_user)):
    db = await get_db()
    article = await _published_article(db, slug)
    await db.execute(
        "DELETE FROM article_likes WHERE user_id = $1 AND article_id = $2",
        user["id"], article["id"],
    )
    count = await db.fetchval(
        "SELECT COUNT(*) FROM article_likes WHERE article_id = $1", article["id"]
    )
    return ArticleLikeResponse(article_id=str(article["id"]), like_count=count, user_liked=False)
