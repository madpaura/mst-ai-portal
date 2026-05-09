"""
Site-wide search — two endpoints:
  GET /search/suggest?q=...          autocomplete, top 10, cached 60 s
  GET /search?q=...&type=...&page=1  full paginated results, cached 300 s
"""

from fastapi import APIRouter, Query
from loguru import logger

from cache.keys import NS_SEARCH
from cache.service import get_or_set
from database import get_db

router = APIRouter()

_SUGGEST_TTL = 60
_SEARCH_TTL = 300
_PER_PAGE = 20


def _tsquery(q: str) -> str:
    """Build a prefix-aware tsquery string: last word gets :* for autocomplete."""
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
        tsq = _tsquery(q)
        if not tsq:
            return []
        try:
            rows = await db.fetch(_SUGGEST_SQL, q, tsq)
        except Exception as exc:
            logger.warning("search suggest error: {}", exc)
            return []
        return [_row_to_suggest(r) for r in rows]

    return await get_or_set(NS_SEARCH, "suggest", "all", cache_params, _SUGGEST_TTL, _fetch)


_SUGGEST_SQL = """
SELECT * FROM (
  (SELECT
    'video'       AS type,
    id::text      AS id,
    slug          AS url_key,
    title,
    COALESCE(description, '')                   AS description,
    COALESCE(custom_thumbnail, thumbnail)       AS thumbnail,
    category                                    AS category,
    ts_rank_cd(
      to_tsvector('english', title || ' ' || COALESCE(description,'') || ' ' || category),
      to_tsquery('english', $2)
    )                                           AS rank
  FROM videos
  WHERE is_published = true AND is_active = true
    AND to_tsvector('english', title || ' ' || COALESCE(description,'') || ' ' || category)
        @@ to_tsquery('english', $2)
  ORDER BY rank DESC LIMIT 4),

  (SELECT
    'article'     AS type,
    id::text,
    slug          AS url_key,
    title,
    COALESCE(summary, '')                       AS description,
    NULL                                        AS thumbnail,
    category                                    AS category,
    ts_rank_cd(
      to_tsvector('english', title || ' ' || COALESCE(summary,'') || ' ' || content),
      to_tsquery('english', $2)
    )                                           AS rank
  FROM articles
  WHERE is_published = true AND is_active = true
    AND to_tsvector('english', title || ' ' || COALESCE(summary,'') || ' ' || content)
        @@ to_tsquery('english', $2)
  ORDER BY rank DESC LIMIT 4),

  (SELECT
    'solution'    AS type,
    id::text,
    id::text      AS url_key,
    title,
    COALESCE(description, '')                   AS description,
    NULL                                        AS thumbnail,
    NULL                                        AS category,
    ts_rank_cd(
      to_tsvector('english', title || ' ' || COALESCE(subtitle,'') || ' ' || description),
      to_tsquery('english', $2)
    )                                           AS rank
  FROM solution_cards
  WHERE is_active = true
    AND to_tsvector('english', title || ' ' || COALESCE(subtitle,'') || ' ' || description)
        @@ to_tsquery('english', $2)
  ORDER BY rank DESC LIMIT 2),

  (SELECT
    'news'        AS type,
    id::text,
    id::text      AS url_key,
    title,
    summary                                     AS description,
    NULL                                        AS thumbnail,
    NULL                                        AS category,
    ts_rank_cd(
      to_tsvector('english', title || ' ' || summary || ' ' || COALESCE(content,'')),
      to_tsquery('english', $2)
    )                                           AS rank
  FROM news_feed
  WHERE is_active = true
    AND to_tsvector('english', title || ' ' || summary || ' ' || COALESCE(content,''))
        @@ to_tsquery('english', $2)
  ORDER BY rank DESC LIMIT 2),

  (SELECT
    'marketplace' AS type,
    id::text,
    slug          AS url_key,
    name          AS title,
    COALESCE(description, '')                   AS description,
    NULL                                        AS thumbnail,
    component_type                              AS category,
    ts_rank_cd(
      to_tsvector('english', name || ' ' || COALESCE(description,'') || ' ' || component_type),
      to_tsquery('english', $2)
    )                                           AS rank
  FROM forge_components
  WHERE is_active = true
    AND to_tsvector('english', name || ' ' || COALESCE(description,'') || ' ' || component_type)
        @@ to_tsquery('english', $2)
  ORDER BY rank DESC LIMIT 3)
) combined
ORDER BY rank DESC
LIMIT 10
"""


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


async def _run_full_search(db, q: str, type_: str, offset: int, per_page: int):
    """Build and run the type-filtered full search with total count."""
    parts = []
    params: list = [q]  # $1 = raw query for ts_headline

    def _add(sql):
        parts.append(sql)

    plain_q = q  # used as $1 for plainto_tsquery

    if type_ in ("all", "video"):
        _add("""
        SELECT
          'video'   AS type,
          id::text  AS id,
          slug      AS url_key,
          title,
          COALESCE(description,'') AS description,
          COALESCE(custom_thumbnail, thumbnail) AS thumbnail,
          category  AS category,
          ts_headline('english', title || ' ' || COALESCE(description,''),
            plainto_tsquery('english', $1),
            'MaxFragments=1,MaxWords=15,MinWords=5,StartSel=<mark>,StopSel=</mark>'
          ) AS highlight,
          ts_rank_cd(
            to_tsvector('english', title||' '||COALESCE(description,'')||' '||category),
            plainto_tsquery('english', $1)
          ) AS rank
        FROM videos
        WHERE is_published = true AND is_active = true
          AND to_tsvector('english', title||' '||COALESCE(description,'')||' '||category)
              @@ plainto_tsquery('english', $1)
        """)

    if type_ in ("all", "article"):
        _add("""
        SELECT
          'article' AS type,
          id::text,
          slug      AS url_key,
          title,
          COALESCE(summary,'') AS description,
          NULL      AS thumbnail,
          category  AS category,
          ts_headline('english', title || ' ' || COALESCE(summary,'') || ' ' || content,
            plainto_tsquery('english', $1),
            'MaxFragments=1,MaxWords=15,MinWords=5,StartSel=<mark>,StopSel=</mark>'
          ) AS highlight,
          ts_rank_cd(
            to_tsvector('english', title||' '||COALESCE(summary,'')||' '||content),
            plainto_tsquery('english', $1)
          ) AS rank
        FROM articles
        WHERE is_published = true AND is_active = true
          AND to_tsvector('english', title||' '||COALESCE(summary,'')||' '||content)
              @@ plainto_tsquery('english', $1)
        """)

    if type_ in ("all", "solution"):
        _add("""
        SELECT
          'solution' AS type,
          id::text,
          id::text   AS url_key,
          title,
          COALESCE(description,'') AS description,
          NULL       AS thumbnail,
          NULL       AS category,
          ts_headline('english', title || ' ' || COALESCE(subtitle,'') || ' ' || description,
            plainto_tsquery('english', $1),
            'MaxFragments=1,MaxWords=15,MinWords=5,StartSel=<mark>,StopSel=</mark>'
          ) AS highlight,
          ts_rank_cd(
            to_tsvector('english', title||' '||COALESCE(subtitle,'')||' '||description),
            plainto_tsquery('english', $1)
          ) AS rank
        FROM solution_cards
        WHERE is_active = true
          AND to_tsvector('english', title||' '||COALESCE(subtitle,'')||' '||description)
              @@ plainto_tsquery('english', $1)
        """)

    if type_ in ("all", "news"):
        _add("""
        SELECT
          'news'    AS type,
          id::text,
          id::text  AS url_key,
          title,
          summary   AS description,
          NULL      AS thumbnail,
          NULL      AS category,
          ts_headline('english', title || ' ' || summary || ' ' || COALESCE(content,''),
            plainto_tsquery('english', $1),
            'MaxFragments=1,MaxWords=15,MinWords=5,StartSel=<mark>,StopSel=</mark>'
          ) AS highlight,
          ts_rank_cd(
            to_tsvector('english', title||' '||summary||' '||COALESCE(content,'')),
            plainto_tsquery('english', $1)
          ) AS rank
        FROM news_feed
        WHERE is_active = true
          AND to_tsvector('english', title||' '||summary||' '||COALESCE(content,''))
              @@ plainto_tsquery('english', $1)
        """)

    if type_ in ("all", "marketplace"):
        _add("""
        SELECT
          'marketplace' AS type,
          id::text,
          slug      AS url_key,
          name      AS title,
          COALESCE(description,'') AS description,
          NULL      AS thumbnail,
          component_type AS category,
          ts_headline('english', name || ' ' || COALESCE(description,''),
            plainto_tsquery('english', $1),
            'MaxFragments=1,MaxWords=15,MinWords=5,StartSel=<mark>,StopSel=</mark>'
          ) AS highlight,
          ts_rank_cd(
            to_tsvector('english', name||' '||COALESCE(description,'')||' '||component_type),
            plainto_tsquery('english', $1)
          ) AS rank
        FROM forge_components
        WHERE is_active = true
          AND to_tsvector('english', name||' '||COALESCE(description,'')||' '||component_type)
              @@ plainto_tsquery('english', $1)
        """)

    if not parts:
        return [], 0

    union_sql = " UNION ALL ".join(f"({p})" for p in parts)
    count_sql = f"SELECT COUNT(*) FROM ({union_sql}) _c"
    paged_sql  = f"""
        SELECT * FROM ({union_sql}) _r
        ORDER BY rank DESC
        LIMIT {per_page} OFFSET {offset}
    """

    total = await db.fetchval(count_sql, *params)
    rows  = await db.fetch(paged_sql, *params)
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
