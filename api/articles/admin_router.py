import os
import re
import uuid
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File

from articles.schemas import (
    ArticleResponse, ArticleListResponse, ArticleCreate, ArticleUpdate,
    BeautifyRequest, BeautifyResponse, AttachmentResponse,
)
from articles.llm import call_llm
from auth.dependencies import require_content as require_admin
from config import settings
from database import get_db

router = APIRouter()

_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024  # 20 MB
_ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"}
_ALLOWED_MIMES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


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


@router.get("/articles", response_model=list[ArticleListResponse])
async def admin_list_articles(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM articles WHERE is_active = true ORDER BY created_at DESC"
    )
    return [_row_to_list(r) for r in rows]


@router.post("/articles", response_model=ArticleResponse)
async def admin_create_article(req: ArticleCreate, admin: dict = Depends(require_admin)):
    db = await get_db()

    slug = req.slug.strip() if req.slug else ""
    if not slug:
        slug = re.sub(r'[^a-z0-9]+', '-', req.title.lower()).strip('-')

    existing = await db.fetchval("SELECT id FROM articles WHERE slug = $1", slug)
    if existing:
        slug = f"{slug}-{str(existing)[:8]}"

    row = await db.fetchrow(
        """
        INSERT INTO articles (title, slug, summary, content, category, author_id, author_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
        """,
        req.title, slug, req.summary, req.content, req.category,
        admin["id"], admin.get("display_name", "Admin"),
    )
    return _row_to_response(row, [])


# ── Beautify (must be BEFORE {article_id} routes) ──────────

@router.post("/articles/beautify", response_model=BeautifyResponse)
async def beautify_text(req: BeautifyRequest, admin: dict = Depends(require_admin)):
    prompt = (
        "You are a technical editor. Improve the following markdown text: "
        "fix grammar, improve clarity, add proper markdown formatting "
        "(headers, lists, bold, code blocks where appropriate). "
        "Return ONLY the improved markdown, no explanation.\n\n"
        f"{req.content}"
    )
    result = await call_llm(prompt)
    return BeautifyResponse(content=result)


# ── Article by ID routes ────────────────────────────────────

@router.get("/articles/{article_id}", response_model=ArticleResponse)
async def admin_get_article(article_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM articles WHERE id = $1 AND is_active = true", article_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Article not found")
    attachments = await _get_attachments(db, article_id)
    return _row_to_response(row, attachments)


@router.put("/articles/{article_id}", response_model=ArticleResponse)
async def admin_update_article(
    article_id: str, req: ArticleUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM articles WHERE id = $1 AND is_active = true", article_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Article not found")

    _ARTICLE_UPDATABLE_FIELDS = frozenset({"title", "slug", "summary", "content", "category"})
    updates = {}
    if req.title is not None:
        updates["title"] = req.title
    if req.slug is not None:
        updates["slug"] = req.slug
    if req.summary is not None:
        updates["summary"] = req.summary
    if req.content is not None:
        updates["content"] = req.content
    if req.category is not None:
        updates["category"] = req.category
    updates = {k: v for k, v in updates.items() if k in _ARTICLE_UPDATABLE_FIELDS}

    if updates:
        set_clauses = [f"{k} = ${i+1}" for i, k in enumerate(updates.keys())]
        set_clauses.append(f"updated_at = now()")
        values = list(updates.values())
        values.append(article_id)
        await db.execute(
            f"UPDATE articles SET {', '.join(set_clauses)} WHERE id = ${len(values)}",
            *values,
        )

    row = await db.fetchrow("SELECT * FROM articles WHERE id = $1", article_id)
    attachments = await _get_attachments(db, article_id)
    return _row_to_response(row, attachments)


@router.delete("/articles/{article_id}")
async def admin_delete_article(article_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute(
        "UPDATE articles SET is_active = false WHERE id = $1 AND is_active = true",
        article_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Article not found")
    return {"message": "Article deleted"}


@router.post("/articles/{article_id}/publish")
async def admin_publish_article(article_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute(
        "UPDATE articles SET is_published = true, published_at = now(), updated_at = now() WHERE id = $1 AND is_active = true",
        article_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Article not found")
    return {"message": "Article published"}


@router.post("/articles/{article_id}/unpublish")
async def admin_unpublish_article(article_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute(
        "UPDATE articles SET is_published = false, updated_at = now() WHERE id = $1 AND is_active = true",
        article_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Article not found")
    return {"message": "Article unpublished"}


# ── Attachment endpoints ────────────────────────────────────

@router.post("/articles/{article_id}/attachments", response_model=AttachmentResponse)
async def upload_attachment(
    article_id: str,
    file: UploadFile = File(...),
    admin: dict = Depends(require_admin),
):
    db = await get_db()
    exists = await db.fetchval(
        "SELECT id FROM articles WHERE id = $1 AND is_active = true", article_id
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Article not found")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed: PDF, Word, PowerPoint, Excel",
        )

    data = await file.read()
    if len(data) > _MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 20 MB limit")

    mime = file.content_type or ""
    attachment_id = str(uuid.uuid4())
    stored_name = f"{attachment_id}{ext}"
    dir_path = os.path.join(settings.MEDIA_STORAGE_PATH, "articles", article_id)
    os.makedirs(dir_path, exist_ok=True)
    file_path = os.path.join(dir_path, stored_name)

    with open(file_path, "wb") as f:
        f.write(data)

    row = await db.fetchrow(
        """
        INSERT INTO article_attachments (id, article_id, filename, file_path, file_size, mime_type)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
        """,
        attachment_id, article_id,
        file.filename or stored_name,
        file_path, len(data), mime,
    )
    return _row_to_attachment(row)


@router.delete("/articles/{article_id}/attachments/{attachment_id}")
async def delete_attachment(
    article_id: str,
    attachment_id: str,
    admin: dict = Depends(require_admin),
):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM article_attachments WHERE id = $1 AND article_id = $2",
        attachment_id, article_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")

    try:
        os.remove(row["file_path"])
    except OSError:
        pass

    await db.execute("DELETE FROM article_attachments WHERE id = $1", attachment_id)
    return {"message": "Attachment deleted"}
