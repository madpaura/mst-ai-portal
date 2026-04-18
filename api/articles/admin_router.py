import re
from fastapi import APIRouter, HTTPException, Depends

from articles.schemas import (
    ArticleResponse, ArticleListResponse, ArticleCreate, ArticleUpdate,
    BeautifyRequest, BeautifyResponse,
)
from articles.llm import call_llm
from auth.dependencies import require_content as require_admin
from database import get_db, get_read_db
from content_pipeline.pipeline import process_article

router = APIRouter()


def _row_to_response(r) -> ArticleResponse:
    return ArticleResponse(
        id=str(r["id"]), title=r["title"], slug=r["slug"],
        summary=r.get("summary"), content=r["content"],
        category=r["category"], author_name=r.get("author_name"),
        is_published=r["is_published"], published_at=r.get("published_at"),
        created_at=r["created_at"], updated_at=r["updated_at"],
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
    db = await get_read_db()
    rows = await db.fetch(
        "SELECT * FROM articles WHERE is_active = true ORDER BY created_at DESC"
    )
    return [_row_to_list(r) for r in rows]


@router.post("/articles", response_model=ArticleResponse)
async def admin_create_article(req: ArticleCreate, admin: dict = Depends(require_admin)):
    db = await get_db()

    # Auto-generate slug from title if not provided
    slug = req.slug.strip() if req.slug else ""
    if not slug:
        slug = re.sub(r'[^a-z0-9]+', '-', req.title.lower()).strip('-')

    # Ensure unique slug
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

    # Kick off AI summarisation in the background (non-blocking)
    import asyncio
    asyncio.create_task(process_article(str(row["id"])))

    return _row_to_response(row)


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
    db = await get_read_db()
    row = await db.fetchrow(
        "SELECT * FROM articles WHERE id = $1 AND is_active = true", article_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Article not found")
    return _row_to_response(row)


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
    return _row_to_response(row)


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
