import re
from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Optional

from articles.schemas import (
    ArticleResponse, ArticleListResponse, ArticleCreate, ArticleUpdate,
    BeautifyRequest, BeautifyResponse,
)
from articles.llm import call_llm
from auth.dependencies import get_current_user
from database import get_db

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
):
    db = await get_db()
    conditions = ["is_published = true", "is_active = true"]
    params: list = []
    idx = 1

    if category:
        conditions.append(f"category = ${idx}")
        params.append(category)
        idx += 1

    if search and search.strip():
        conditions.append(
            f"to_tsvector('english', title || ' ' || COALESCE(summary, '') || ' ' || content) @@ plainto_tsquery('english', ${idx})"
        )
        params.append(search.strip())
        idx += 1

    where = " AND ".join(conditions)
    rows = await db.fetch(
        f"SELECT * FROM articles WHERE {where} ORDER BY published_at DESC",
        *params,
    )
    return [_row_to_list(r) for r in rows]


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
        INSERT INTO articles (title, slug, summary, content, category, author_id, author_name, is_published, published_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, now()) RETURNING *
        """,
        req.title, slug, req.summary, req.content, req.category,
        user["id"], user.get("display_name", user.get("username", "User")),
    )
    return _row_to_response(row)


@router.get("/my/{article_id}", response_model=ArticleResponse)
async def get_my_article(article_id: str, user: dict = Depends(get_current_user)):
    db = await get_db()
    row = await db.fetchrow(
        "SELECT * FROM articles WHERE id = $1 AND author_id = $2 AND is_active = true",
        article_id, user["id"],
    )
    if not row:
        raise HTTPException(status_code=404, detail="Article not found")
    return _row_to_response(row)


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
        updates["content"] = req.content
    if req.category is not None:
        updates["category"] = req.category

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
    return _row_to_response(row)


@router.delete("/my/{article_id}")
async def delete_my_article(article_id: str, user: dict = Depends(get_current_user)):
    db = await get_db()
    result = await db.execute(
        "UPDATE articles SET is_active = false WHERE id = $1 AND author_id = $2 AND is_active = true",
        article_id, user["id"],
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="Article not found or not yours")
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
    return _row_to_response(row)
