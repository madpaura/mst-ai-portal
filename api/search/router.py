"""
Site-wide search — fuzzy, two endpoints:
  GET /search/suggest?q=...          autocomplete, top 10, cached 60 s
  GET /search?q=...&type=...&page=1  full paginated results, cached 300 s

Matching strategy (two-pass, merged):
  1. Full-text search via websearch_to_tsquery (stemming, phrase-aware)
  2. Trigram similarity via pg_trgm word_similarity() — catches typos / partials
  Results are unioned, deduped, ranked by GREATEST(ts_rank*1.5, trgm_score).
"""

from fastapi import APIRouter, Query
from loguru import logger

from cache.keys import NS_SEARCH
from cache.service import get_or_set
from database import get_db

router = APIRouter()

_SUGGEST_TTL = 60
_SEARCH_TTL  = 300
_PER_PAGE    = 20
_TRGM_THRESHOLD = 0.25   # word_similarity score floor for fuzzy matches


def _prefix_tsquery(q: str) -> str:
    """Build prefix-aware tsquery for autocomplete: last word gets :*."""
    words = [w for w in q.strip().split() if w]
    if not words:
        return ""
    parts = [f"'{w}'" for w in words[:-1]] + [f"'{words[-1]}':*"]
    return " & ".join(parts)


# ── /search/suggest ───────────────────────────────────────────────────────────

@router.get("/suggest")
async def suggest(q: str = Query("", min_length=1)):
    q = q.strip()
    if not q:
        return []

    cache_params = {"q": q.lower()}

    async def _fetch():
        db = await get_db()
        prefix_tsq = _prefix_tsquery(q)
        try:
            rows = await db.fetch(_SUGGEST_SQL, q, prefix_tsq or q)
        except Exception as exc:
            logger.warning("search suggest error: {}", exc)
            return []
        return [_row_to_suggest(r) for r in rows]

    return await get_or_set(NS_SEARCH, "suggest", "all", cache_params, _SUGGEST_TTL, _fetch)


# Each content-type block in the suggest UNION uses:
#   - FTS with prefix tsquery ($2) for exact/prefix matches (rank * 1.5 boost)
#   - trigram word_similarity($1, title) > threshold for fuzzy/typo matches
# Combined rank = GREATEST(fts_rank * 1.5, trgm_rank)
# Results are deduped by (type, id) at the outer level.

_SUGGEST_SQL = """
SELECT DISTINCT ON (type, id) type, id, url_key, title, description, thumbnail, category, rank
FROM (

  SELECT 'video' AS type, id::text, slug AS url_key, title,
    COALESCE(description,'') AS description,
    COALESCE(custom_thumbnail, thumbnail) AS thumbnail,
    category,
    GREATEST(
      ts_rank_cd(
        to_tsvector('english', title||' '||COALESCE(description,'')||' '||category),
        to_tsquery('english', $2)
      ) * 1.5,
      word_similarity($1, title)
    ) AS rank
  FROM videos
  WHERE is_published = true AND is_active = true
    AND (
      to_tsvector('english', title||' '||COALESCE(description,'')||' '||category)
        @@ to_tsquery('english', $2)
      OR word_similarity($1, title) > %s
    )

  UNION ALL

  SELECT 'article' AS type, id::text, slug AS url_key, title,
    COALESCE(summary,'') AS description, NULL AS thumbnail, category,
    GREATEST(
      ts_rank_cd(
        to_tsvector('english', title||' '||COALESCE(summary,'')||' '||content),
        to_tsquery('english', $2)
      ) * 1.5,
      word_similarity($1, title)
    ) AS rank
  FROM articles
  WHERE is_published = true AND is_active = true
    AND (
      to_tsvector('english', title||' '||COALESCE(summary,'')||' '||content)
        @@ to_tsquery('english', $2)
      OR word_similarity($1, title) > %s
    )

  UNION ALL

  SELECT 'solution' AS type, id::text, id::text AS url_key, title,
    COALESCE(description,'') AS description, NULL AS thumbnail, NULL AS category,
    GREATEST(
      ts_rank_cd(
        to_tsvector('english', title||' '||COALESCE(subtitle,'')||' '||COALESCE(description,'')),
        to_tsquery('english', $2)
      ) * 1.5,
      word_similarity($1, title)
    ) AS rank
  FROM solution_cards
  WHERE is_active = true
    AND (
      to_tsvector('english', title||' '||COALESCE(subtitle,'')||' '||COALESCE(description,''))
        @@ to_tsquery('english', $2)
      OR word_similarity($1, title) > %s
    )

  UNION ALL

  SELECT 'news' AS type, id::text, id::text AS url_key, title,
    summary AS description, NULL AS thumbnail, NULL AS category,
    GREATEST(
      ts_rank_cd(
        to_tsvector('english', title||' '||summary||' '||COALESCE(content,'')),
        to_tsquery('english', $2)
      ) * 1.5,
      word_similarity($1, title)
    ) AS rank
  FROM news_feed
  WHERE is_active = true
    AND (
      to_tsvector('english', title||' '||summary||' '||COALESCE(content,''))
        @@ to_tsquery('english', $2)
      OR word_similarity($1, title) > %s
    )

  UNION ALL

  SELECT 'marketplace' AS type, id::text, slug AS url_key, name AS title,
    COALESCE(description,'') AS description, NULL AS thumbnail, component_type AS category,
    GREATEST(
      ts_rank_cd(
        to_tsvector('english', name||' '||COALESCE(description,'')||' '||component_type),
        to_tsquery('english', $2)
      ) * 1.5,
      word_similarity($1, name)
    ) AS rank
  FROM forge_components
  WHERE is_active = true
    AND (
      to_tsvector('english', name||' '||COALESCE(description,'')||' '||component_type)
        @@ to_tsquery('english', $2)
      OR word_similarity($1, name) > %s
    )

) combined
ORDER BY type, id, rank DESC
LIMIT 10
""" % ((_TRGM_THRESHOLD,) * 5)


def _row_to_suggest(r) -> dict:
    type_ = r["type"]
    url_key = r["url_key"]
    url = {
        "video":       f"/ignite/{url_key}",
        "article":     f"/articles/{url_key}",
        "solution":    f"/solutions/{url_key}",
        "news":        f"/news/{url_key}",
        "marketplace": f"/marketplace?q={url_key}",
    }.get(type_, "/")
    return {
        "type":        type_,
        "id":          r["id"],
        "title":       r["title"],
        "description": (r["description"] or "")[:120],
        "url":         url,
        "thumbnail":   r["thumbnail"],
        "category":    r["category"],
    }


# ── /search ───────────────────────────────────────────────────────────────────

@router.get("")
async def search(
    q: str = Query("", min_length=1),
    type: str = Query("all"),
    page: int = Query(1, ge=1),
    per_page: int = Query(_PER_PAGE, ge=1, le=50),
):
    q = q.strip()
    if not q:
        return {"total": 0, "page": page, "per_page": per_page, "results": []}

    type_ = type.lower() if type.lower() in ("video","article","solution","news","marketplace") else "all"
    cache_params = {"q": q.lower(), "type": type_, "page": page, "per_page": per_page}

    async def _fetch():
        db = await get_db()
        offset = (page - 1) * per_page
        try:
            rows, total = await _run_full_search(db, q, type_, offset, per_page)
        except Exception as exc:
            logger.warning("search error: {}", exc)
            return {"total": 0, "page": page, "per_page": per_page, "results": []}
        return {
            "total":    total,
            "page":     page,
            "per_page": per_page,
            "results":  [_row_to_result(r) for r in rows],
        }

    return await get_or_set(NS_SEARCH, "search", "all", cache_params, _SEARCH_TTL, _fetch)


def _block(table: str, type_label: str, title_expr: str, desc_expr: str,
           id_expr: str, url_key_expr: str, cat_expr: str,
           thumb_expr: str, where_extra: str, trgm_field: str) -> str:
    """
    Build one UNION block with combined FTS + trigram ranking.
    $1 = raw query string (for websearch_to_tsquery and word_similarity)
    tsvec is built inline from title/description fields.
    """
    tsvec = f"to_tsvector('english', {title_expr} || ' ' || {desc_expr})"
    tsq   = "websearch_to_tsquery('english', $1)"
    return f"""
    SELECT
      '{type_label}' AS type,
      {id_expr}::text AS id,
      {url_key_expr} AS url_key,
      {title_expr} AS title,
      {desc_expr} AS description,
      {thumb_expr} AS thumbnail,
      {cat_expr} AS category,
      ts_headline('english',
        {title_expr} || ' ' || {desc_expr},
        {tsq},
        'MaxFragments=1,MaxWords=15,MinWords=5,StartSel=<mark>,StopSel=</mark>'
      ) AS highlight,
      GREATEST(
        ts_rank_cd({tsvec}, {tsq}) * 1.5,
        word_similarity($1, {trgm_field})
      ) AS rank
    FROM {table}
    WHERE {where_extra}
      AND (
        {tsvec} @@ {tsq}
        OR word_similarity($1, {trgm_field}) > {_TRGM_THRESHOLD}
      )
    """


async def _run_full_search(db, q: str, type_: str, offset: int, per_page: int):
    parts = []

    if type_ in ("all", "video"):
        parts.append(_block(
            table="videos", type_label="video",
            title_expr="title", desc_expr="COALESCE(description,'')",
            id_expr="id", url_key_expr="slug", cat_expr="category",
            thumb_expr="COALESCE(custom_thumbnail, thumbnail)",
            where_extra="is_published = true AND is_active = true",
            trgm_field="title",
        ))

    if type_ in ("all", "article"):
        parts.append(_block(
            table="articles", type_label="article",
            title_expr="title", desc_expr="COALESCE(summary,'')||' '||content",
            id_expr="id", url_key_expr="slug", cat_expr="category",
            thumb_expr="NULL",
            where_extra="is_published = true AND is_active = true",
            trgm_field="title",
        ))

    if type_ in ("all", "solution"):
        parts.append(_block(
            table="solution_cards", type_label="solution",
            title_expr="title",
            desc_expr="COALESCE(subtitle,'')||' '||COALESCE(description,'')",
            id_expr="id", url_key_expr="id::text", cat_expr="NULL",
            thumb_expr="NULL",
            where_extra="is_active = true",
            trgm_field="title",
        ))

    if type_ in ("all", "news"):
        parts.append(_block(
            table="news_feed", type_label="news",
            title_expr="title",
            desc_expr="summary||' '||COALESCE(content,'')",
            id_expr="id", url_key_expr="id::text", cat_expr="NULL",
            thumb_expr="NULL",
            where_extra="is_active = true",
            trgm_field="title",
        ))

    if type_ in ("all", "marketplace"):
        parts.append(_block(
            table="forge_components", type_label="marketplace",
            title_expr="name",
            desc_expr="COALESCE(description,'')||' '||component_type",
            id_expr="id", url_key_expr="slug", cat_expr="component_type",
            thumb_expr="NULL",
            where_extra="is_active = true",
            trgm_field="name",
        ))

    if not parts:
        return [], 0

    union_sql  = " UNION ALL ".join(f"({p})" for p in parts)
    count_sql  = f"SELECT COUNT(*) FROM ({union_sql}) _c"
    paged_sql  = f"""
        SELECT * FROM ({union_sql}) _r
        ORDER BY rank DESC
        LIMIT {per_page} OFFSET {offset}
    """

    total = await db.fetchval(count_sql, q)
    rows  = await db.fetch(paged_sql, q)
    return rows, total


def _row_to_result(r) -> dict:
    type_ = r["type"]
    url_key = r["url_key"]
    url = {
        "video":       f"/ignite/{url_key}",
        "article":     f"/articles/{url_key}",
        "solution":    f"/solutions/{url_key}",
        "news":        f"/news/{url_key}",
        "marketplace": f"/marketplace?q={url_key}",
    }.get(type_, "/")
    return {
        "type":        type_,
        "id":          r["id"],
        "title":       r["title"],
        "description": (r["description"] or "")[:200],
        "url":         url,
        "thumbnail":   r["thumbnail"],
        "category":    r["category"],
        "highlight":   r["highlight"],
    }
