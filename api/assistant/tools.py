"""Assistant tool definitions, schemas, role mapping, and implementations."""
import json
import os
from database import get_db
from config import settings

# ── Tool schemas (OpenAI function-calling format) ─────────────────────────────

_USER_TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "search_videos",
            "description": "Search published videos and courses by title, description, or topic",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Search terms"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_courses",
            "description": "List all available courses with their titles and descriptions",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_video_details",
            "description": "Get details for a specific video by its slug, including chapters and howto guide",
            "parameters": {
                "type": "object",
                "properties": {"slug": {"type": "string", "description": "Video URL slug"}},
                "required": ["slug"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_video_transcript",
            "description": "Get the transcript/captions for a video to answer questions about its content",
            "parameters": {
                "type": "object",
                "properties": {"slug": {"type": "string", "description": "Video URL slug"}},
                "required": ["slug"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_learning_progress",
            "description": "Get the current user's overall learning progress across all enrolled courses and videos",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_course_progress",
            "description": "Get the current user's progress for a specific course",
            "parameters": {
                "type": "object",
                "properties": {"slug": {"type": "string", "description": "Course URL slug"}},
                "required": ["slug"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_notes",
            "description": "Get the current user's personal notes, optionally filtered to a specific video",
            "parameters": {
                "type": "object",
                "properties": {"video_slug": {"type": "string", "description": "Optional video slug to filter notes"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_articles",
            "description": "Search published knowledge articles by title, summary, or content",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Search terms"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_solutions",
            "description": "Search AI solution cards by title, description, or category",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Search terms"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_announcements",
            "description": "Get the latest portal announcements",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_ai_news",
            "description": "Get the latest AI news feed items from the portal",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_forge_components",
            "description": "Search Forge/marketplace components: skills, agents, MCP servers",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Search terms"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_forge_component",
            "description": "Get full details for a Forge component by its slug",
            "parameters": {
                "type": "object",
                "properties": {"slug": {"type": "string", "description": "Component slug"}},
                "required": ["slug"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_forge_component_instructions",
            "description": "Get installation and usage instructions for a Forge component",
            "parameters": {
                "type": "object",
                "properties": {"slug": {"type": "string", "description": "Component slug"}},
                "required": ["slug"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "global_search",
            "description": "Cross-portal search across videos, articles, solutions, news, and marketplace components",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Search terms"}},
                "required": ["query"],
            },
        },
    },
]

_CONTENT_ONLY_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_my_articles",
            "description": "Get articles authored by the current user",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_publish_requests",
            "description": "List all publish requests submitted by the current user — use this for 'ready to publish', 'pending approval', 'approved videos', or 'what's waiting to go live' queries",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_publish_request_status",
            "description": "Get the status and reviewer notes for a specific publish request",
            "parameters": {
                "type": "object",
                "properties": {"req_id": {"type": "string", "description": "Publish request ID"}},
                "required": ["req_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_video_job_status",
            "description": "Get transcode and auto-processor job status for videos — use for 'is my video processing', 'video stuck', 'job failed', or 'what videos are being processed' queries",
            "parameters": {
                "type": "object",
                "properties": {"video_id": {"type": "string", "description": "Optional video ID to filter jobs"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_my_artifacts",
            "description": "Get Artifact Hub submissions by the current user with their statuses",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_artifact_status",
            "description": "Get the status and details for a specific artifact submission",
            "parameters": {
                "type": "object",
                "properties": {"artifact_id": {"type": "string", "description": "Artifact submission ID"}},
                "required": ["artifact_id"],
            },
        },
    },
]


def get_tools_for_role(role: str) -> list[dict]:
    if role in ("content", "admin"):
        return _USER_TOOL_SCHEMAS + _CONTENT_ONLY_SCHEMAS
    return _USER_TOOL_SCHEMAS


# ── Tool display messages (shown while tool runs) ─────────────────────────────

TOOL_MESSAGES: dict[str, str] = {
    "search_videos": "Searching videos…",
    "list_courses": "Loading courses…",
    "get_video_details": "Getting video details…",
    "get_video_transcript": "Fetching transcript…",
    "get_my_learning_progress": "Checking your progress…",
    "get_course_progress": "Checking course progress…",
    "get_my_notes": "Loading your notes…",
    "search_articles": "Searching articles…",
    "search_solutions": "Searching solutions…",
    "get_announcements": "Loading announcements…",
    "get_ai_news": "Fetching news…",
    "search_forge_components": "Searching marketplace…",
    "get_forge_component": "Getting component details…",
    "get_forge_component_instructions": "Getting install instructions…",
    "global_search": "Searching portal…",
    "get_my_articles": "Loading your articles…",
    "get_my_publish_requests": "Checking your publish requests…",
    "get_publish_request_status": "Checking request status…",
    "get_video_job_status": "Checking job status…",
    "get_my_artifacts": "Loading your artifacts…",
    "get_artifact_status": "Checking artifact status…",
}


# ── Dispatcher ────────────────────────────────────────────────────────────────

_REGISTRY: dict[str, callable] = {}


def _tool(fn):
    _REGISTRY[fn.__name__] = fn
    return fn


async def dispatch_tool(name: str, arguments: dict, user: dict) -> dict:
    if name not in _REGISTRY:
        return {"error": f"Unknown tool: {name}"}
    uid = str(user.get("id", ""))
    role = user.get("role", "user")
    try:
        return await _REGISTRY[name](user_id=uid, user_role=role, **arguments)
    except TypeError as exc:
        return {"error": f"Invalid arguments for tool '{name}': {exc}"}
    except Exception as exc:
        return {"error": str(exc)}


# ── User-role tools ───────────────────────────────────────────────────────────

@_tool
async def search_videos(query: str, user_id: str, user_role: str) -> dict:
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT title, slug, category, COALESCE(description,'') AS description
        FROM videos
        WHERE is_published = true AND is_active = true
          AND to_tsvector('english', title || ' ' || COALESCE(description,'') || ' ' || category)
              @@ plainto_tsquery('english', $1)
        ORDER BY ts_rank_cd(
            to_tsvector('english', title || ' ' || COALESCE(description,'') || ' ' || category),
            plainto_tsquery('english', $1)
        ) DESC LIMIT 5
        """,
        query,
    )
    if not rows:
        return {"found": False, "message": f"No videos found for '{query}'"}
    return {
        "found": True,
        "results": [
            {"title": r["title"], "slug": r["slug"], "category": r["category"],
             "description": (r["description"] or "")[:120], "url": f"/ignite/{r['slug']}"}
            for r in rows
        ],
    }


@_tool
async def list_courses(user_id: str, user_role: str) -> dict:
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT c.title, c.slug, COALESCE(c.description,'') AS description,
               COUNT(v.id) AS video_count
        FROM courses c
        LEFT JOIN videos v ON v.course_id = c.id AND v.is_active = true
        WHERE c.is_active = true
        GROUP BY c.id ORDER BY c.sort_order, c.title
        """
    )
    if not rows:
        return {"found": False, "message": "No courses available"}
    return {
        "found": True,
        "courses": [
            {"title": r["title"], "slug": r["slug"],
             "description": (r["description"] or "")[:120],
             "video_count": r["video_count"], "url": f"/ignite?course={r['slug']}"}
            for r in rows
        ],
    }


@_tool
async def get_video_details(slug: str, user_id: str, user_role: str) -> dict:
    db = await get_db()
    row = await db.fetchrow(
        "SELECT id, title, description, category, is_published FROM videos WHERE slug=$1 AND is_active=true", slug
    )
    if not row:
        return {"found": False, "message": f"Video '{slug}' not found"}
    chapters = await db.fetch(
        "SELECT title, start_time FROM chapters WHERE video_id=$1 ORDER BY sort_order", row["id"]
    )
    return {
        "found": True,
        "title": row["title"],
        "url": f"/ignite/{slug}",
        "description": (row["description"] or "")[:300],
        "category": row["category"],
        "is_published": row["is_published"],
        "chapters": [{"title": c["title"], "start_time": c["start_time"]} for c in chapters],
    }


@_tool
async def get_video_transcript(slug: str, user_id: str, user_role: str) -> dict:
    db = await get_db()
    row = await db.fetchrow("SELECT id FROM videos WHERE slug=$1 AND is_active=true", slug)
    if not row:
        return {"found": False, "message": f"Video '{slug}' not found"}
    path = os.path.join(settings.VIDEO_STORAGE_PATH, str(row["id"]), "transcript.json")
    if not os.path.exists(path):
        return {"found": False, "message": "No transcript available for this video"}
    try:
        with open(path) as f:
            data = json.load(f)
        segments = data if isinstance(data, list) else data.get("segments", [])
        text = " ".join(s.get("text", "") for s in segments)[:3000]
        return {"found": True, "transcript": text}
    except Exception:
        return {"found": False, "message": "Transcript could not be read"}


@_tool
async def get_my_learning_progress(user_id: str, user_role: str) -> dict:
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT v.title, v.slug, p.completed, p.watched_seconds
        FROM user_video_progress p
        JOIN videos v ON v.id = p.video_id
        WHERE p.user_id = $1
        ORDER BY p.updated_at DESC LIMIT 20
        """,
        user_id,
    )
    if not rows:
        return {"found": False, "message": "No learning progress found"}
    return {
        "found": True,
        "progress": [
            {"title": r["title"], "slug": r["slug"], "completed": r["completed"],
             "watched_seconds": r["watched_seconds"]}
            for r in rows
        ],
    }


@_tool
async def get_course_progress(slug: str, user_id: str, user_role: str) -> dict:
    db = await get_db()
    course = await db.fetchrow("SELECT id, title FROM courses WHERE slug=$1", slug)
    if not course:
        return {"found": False, "message": f"Course '{slug}' not found"}
    rows = await db.fetch(
        """
        SELECT v.id, v.title, v.slug, v.sort_order,
               COALESCE(p.completed, false) AS completed
        FROM videos v
        LEFT JOIN user_video_progress p ON p.video_id = v.id AND p.user_id = $2
        WHERE v.course_id = $1 AND v.is_active = true
        ORDER BY v.sort_order
        """,
        course["id"], user_id,
    )
    total = len(rows)
    done = sum(1 for r in rows if r["completed"])
    next_video = next((r["slug"] for r in rows if not r["completed"]), None)
    return {
        "found": True,
        "course_title": course["title"],
        "total": total,
        "completed_count": done,
        "percentage": round(done / total * 100) if total else 0,
        "next_video_slug": next_video,
        "videos": [{"title": r["title"], "slug": r["slug"], "completed": r["completed"]} for r in rows],
    }


@_tool
async def get_my_notes(user_id: str, user_role: str, video_slug: str | None = None) -> dict:
    db = await get_db()
    if video_slug:
        vid = await db.fetchrow("SELECT id FROM videos WHERE slug=$1", video_slug)
        if not vid:
            return {"found": False, "message": f"Video '{video_slug}' not found"}
        rows = await db.fetch(
            "SELECT n.content, n.timestamp_s, v.title AS video_title FROM user_notes n JOIN videos v ON v.id=n.video_id WHERE n.user_id=$1 AND n.video_id=$2 ORDER BY n.timestamp_s",
            user_id, vid["id"],
        )
    else:
        rows = await db.fetch(
            "SELECT n.content, n.timestamp_s, v.title AS video_title FROM user_notes n JOIN videos v ON v.id=n.video_id WHERE n.user_id=$1 ORDER BY n.timestamp_s LIMIT 20",
            user_id,
        )
    if not rows:
        return {"found": False, "message": "No notes found"}
    return {
        "found": True,
        "notes": [{"video": r["video_title"], "content": r["content"], "at_seconds": r["timestamp_s"]} for r in rows],
    }


@_tool
async def search_articles(query: str, user_id: str, user_role: str) -> dict:
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT title, slug, category, COALESCE(summary,'') AS summary
        FROM articles
        WHERE is_published=true AND is_active=true
          AND to_tsvector('english', title||' '||COALESCE(summary,'')||' '||content)
              @@ plainto_tsquery('english', $1)
        ORDER BY ts_rank_cd(
            to_tsvector('english', title||' '||COALESCE(summary,'')||' '||content),
            plainto_tsquery('english', $1)
        ) DESC LIMIT 5
        """,
        query,
    )
    if not rows:
        return {"found": False, "message": f"No articles found for '{query}'"}
    return {
        "found": True,
        "results": [
            {"title": r["title"], "slug": r["slug"], "category": r["category"],
             "summary": (r["summary"] or "")[:120], "url": f"/articles/{r['slug']}"}
            for r in rows
        ],
    }


@_tool
async def search_solutions(query: str, user_id: str, user_role: str) -> dict:
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT title, COALESCE(subtitle,'') AS subtitle, COALESCE(description,'') AS description, category
        FROM solution_cards
        WHERE is_active=true
          AND to_tsvector('english', title||' '||COALESCE(subtitle,'')||' '||description)
              @@ plainto_tsquery('english', $1)
        LIMIT 5
        """,
        query,
    )
    if not rows:
        return {"found": False, "message": f"No solutions found for '{query}'"}
    return {
        "found": True,
        "results": [
            {"title": r["title"], "subtitle": r["subtitle"],
             "description": (r["description"] or "")[:120], "category": r["category"]}
            for r in rows
        ],
    }


@_tool
async def get_announcements(user_id: str, user_role: str) -> dict:
    db = await get_db()
    rows = await db.fetch(
        "SELECT title, content, created_at FROM announcements WHERE is_active=true ORDER BY created_at DESC LIMIT 10"
    )
    if not rows:
        return {"found": False, "message": "No announcements"}
    return {
        "found": True,
        "announcements": [
            {"title": r["title"], "content": (r["content"] or "")[:200],
             "date": str(r["created_at"])[:10] if r["created_at"] else None}
            for r in rows
        ],
    }


@_tool
async def get_ai_news(user_id: str, user_role: str) -> dict:
    db = await get_db()
    rows = await db.fetch(
        "SELECT title, summary, source_url, published_at FROM news_feed WHERE is_active=true ORDER BY published_at DESC LIMIT 10"
    )
    if not rows:
        return {"found": False, "message": "No news items"}
    return {
        "found": True,
        "news": [
            {"title": r["title"], "summary": (r["summary"] or "")[:150],
             "source_url": r["source_url"],
             "date": str(r["published_at"])[:10] if r["published_at"] else None}
            for r in rows
        ],
    }


@_tool
async def search_forge_components(query: str, user_id: str, user_role: str) -> dict:
    db = await get_db()
    rows = await db.fetch(
        """
        SELECT name, slug, component_type, COALESCE(description,'') AS description, install_command
        FROM forge_components
        WHERE is_active=true
          AND to_tsvector('english', name||' '||COALESCE(description,'')||' '||component_type)
              @@ plainto_tsquery('english', $1)
        ORDER BY downloads DESC LIMIT 5
        """,
        query,
    )
    if not rows:
        return {"found": False, "message": f"No marketplace components found for '{query}'"}
    return {
        "found": True,
        "results": [
            {"name": r["name"], "slug": r["slug"], "type": r["component_type"],
             "description": (r["description"] or "")[:120],
             "install_command": r["install_command"],
             "url": f"/marketplace?q={r['slug']}"}
            for r in rows
        ],
    }


@_tool
async def get_forge_component(slug: str, user_id: str, user_role: str) -> dict:
    db = await get_db()
    row = await db.fetchrow(
        "SELECT name, slug, component_type, description, version, install_command, author, tags FROM forge_components WHERE slug=$1 AND is_active=true",
        slug,
    )
    if not row:
        return {"found": False, "message": f"Component '{slug}' not found"}
    return {
        "found": True,
        "name": row["name"], "slug": row["slug"], "type": row["component_type"],
        "description": row["description"], "version": row["version"],
        "install_command": row["install_command"], "author": row["author"],
        "tags": list(row["tags"]) if row["tags"] else [],
        "url": f"/marketplace?q={slug}",
    }


@_tool
async def get_forge_component_instructions(slug: str, user_id: str, user_role: str) -> dict:
    db = await get_db()
    row = await db.fetchrow(
        "SELECT slug, name, component_type, install_command, long_description, howto_guide FROM forge_components WHERE slug=$1 AND is_active=true",
        slug,
    )
    if not row:
        return {"found": False, "message": f"Component '{slug}' not found"}
    import re
    instructions = ""
    long_desc = row.get("long_description") or ""
    if long_desc:
        for section in re.split(r'^#{1,3}\s+', long_desc, flags=re.MULTILINE):
            if any(kw in section.lower()[:60] for kw in ["install", "setup", "usage", "getting started", "quick start"]):
                instructions += section.strip() + "\n\n"
    if not instructions:
        instructions = row.get("howto_guide") or f"Run: `{row['install_command']}`"
    return {
        "found": True,
        "name": row["name"], "type": row["component_type"],
        "install_command": row["install_command"],
        "instructions": instructions[:2000],
    }


@_tool
async def global_search(query: str, user_id: str, user_role: str) -> dict:
    db = await get_db()
    try:
        rows = await db.fetch(
            """
            SELECT * FROM (
              (SELECT 'video' AS type, slug AS url_key, title,
                      COALESCE(description,'') AS description, NULL AS thumbnail, category
               FROM videos WHERE is_published=true AND is_active=true
                 AND to_tsvector('english', title||' '||COALESCE(description,'')||' '||category)
                     @@ plainto_tsquery('english', $1) LIMIT 3),
              (SELECT 'article' AS type, slug AS url_key, title,
                      COALESCE(summary,'') AS description, NULL AS thumbnail, category
               FROM articles WHERE is_published=true AND is_active=true
                 AND to_tsvector('english', title||' '||COALESCE(summary,'')||' '||content)
                     @@ plainto_tsquery('english', $1) LIMIT 3),
              (SELECT 'solution' AS type, id::text AS url_key, title,
                      COALESCE(description,'') AS description, NULL AS thumbnail, NULL AS category
               FROM solution_cards WHERE is_active=true
                 AND to_tsvector('english', title||' '||COALESCE(description,''))
                     @@ plainto_tsquery('english', $1) LIMIT 2),
              (SELECT 'marketplace' AS type, slug AS url_key, name AS title,
                      COALESCE(description,'') AS description, NULL AS thumbnail, component_type AS category
               FROM forge_components WHERE is_active=true
                 AND to_tsvector('english', name||' '||COALESCE(description,''))
                     @@ plainto_tsquery('english', $1) LIMIT 2)
            ) combined LIMIT 10
            """,
            query,
        )
    except Exception:
        return {"found": False, "message": "Search unavailable"}

    if not rows:
        return {"found": False, "message": f"No results found for '{query}'"}

    url_map = {
        "video": lambda k: f"/ignite/{k}",
        "article": lambda k: f"/articles/{k}",
        "solution": lambda k: f"/solutions/{k}",
        "marketplace": lambda k: f"/marketplace?q={k}",
    }
    return {
        "found": True,
        "results": [
            {"type": r["type"], "title": r["title"],
             "description": (r["description"] or "")[:120],
             "url": url_map.get(r["type"], lambda k: "/")(r["url_key"])}
            for r in rows
        ],
    }


# ── Content/admin-only tools ──────────────────────────────────────────────────

@_tool
async def get_my_articles(user_id: str, user_role: str) -> dict:
    db = await get_db()
    rows = await db.fetch(
        "SELECT title, slug, category, status, created_at FROM articles WHERE author_id=$1 AND is_active=true ORDER BY created_at DESC LIMIT 20",
        user_id,
    )
    if not rows:
        return {"found": False, "message": "No articles found"}
    return {
        "found": True,
        "articles": [
            {"title": r["title"], "slug": r["slug"], "category": r["category"],
             "status": r["status"], "url": f"/articles/{r['slug']}"}
            for r in rows
        ],
    }


@_tool
async def get_my_publish_requests(user_id: str, user_role: str) -> dict:
    db = await get_db()
    rows = await db.fetch(
        "SELECT id, target_type, target_title, status, note, created_at, reviewed_at FROM publish_requests WHERE requested_by=$1 ORDER BY created_at DESC LIMIT 20",
        user_id,
    )
    if not rows:
        return {"found": False, "message": "No publish requests found"}
    return {
        "found": True,
        "requests": [
            {"id": str(r["id"]), "type": r["target_type"], "title": r["target_title"],
             "status": r["status"], "note": r["note"],
             "submitted": str(r["created_at"])[:10] if r["created_at"] else None,
             "reviewed": str(r["reviewed_at"])[:10] if r["reviewed_at"] else None}
            for r in rows
        ],
    }


@_tool
async def get_publish_request_status(req_id: str, user_id: str, user_role: str) -> dict:
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM publish_requests WHERE id=$1", req_id)
    if not row:
        return {"found": False, "message": "Publish request not found"}
    if user_role != "admin" and str(row["requested_by"]) != user_id:
        return {"error": "You do not have permission to view this request"}
    return {
        "found": True,
        "id": str(row["id"]), "type": row["target_type"], "title": row["target_title"],
        "status": row["status"], "note": row["note"],
        "reviewer": row.get("reviewer_name"),
        "submitted": str(row["created_at"])[:10] if row["created_at"] else None,
        "reviewed": str(row["reviewed_at"])[:10] if row["reviewed_at"] else None,
    }


@_tool
async def get_video_job_status(user_id: str, user_role: str, video_id: str | None = None) -> dict:
    db = await get_db()
    if user_role == "admin":
        if video_id:
            rows = await db.fetch(
                "SELECT j.job_type, j.status, j.created_at, j.completed_at, j.error, v.title AS video_title FROM jobs j JOIN videos v ON v.id=j.video_id WHERE j.video_id=$1 ORDER BY j.created_at DESC LIMIT 10",
                video_id,
            )
        else:
            rows = await db.fetch(
                "SELECT j.job_type, j.status, j.created_at, j.completed_at, j.error, v.title AS video_title FROM jobs j JOIN videos v ON v.id=j.video_id ORDER BY j.created_at DESC LIMIT 10"
            )
    else:
        if video_id:
            rows = await db.fetch(
                "SELECT j.job_type, j.status, j.created_at, j.completed_at, j.error, v.title AS video_title FROM jobs j JOIN videos v ON v.id=j.video_id WHERE j.video_id=$1 AND v.uploaded_by=$2 ORDER BY j.created_at DESC LIMIT 10",
                video_id, user_id,
            )
        else:
            rows = await db.fetch(
                "SELECT j.job_type, j.status, j.created_at, j.completed_at, j.error, v.title AS video_title FROM jobs j JOIN videos v ON v.id=j.video_id WHERE v.uploaded_by=$1 ORDER BY j.created_at DESC LIMIT 10",
                user_id,
            )
    if not rows:
        return {"found": False, "message": "No jobs found"}
    return {
        "found": True,
        "jobs": [
            {"video": r["video_title"], "type": r["job_type"], "status": r["status"],
             "error": r["error"],
             "created": str(r["created_at"])[:16] if r["created_at"] else None}
            for r in rows
        ],
    }


@_tool
async def get_my_artifacts(user_id: str, user_role: str) -> dict:
    db = await get_db()
    if user_role == "admin":
        rows = await db.fetch(
            "SELECT id, name, display_name, artifact_type, status, submitted_by_name, created_at FROM artifact_submissions ORDER BY created_at DESC LIMIT 20"
        )
    else:
        rows = await db.fetch(
            "SELECT id, name, display_name, artifact_type, status, created_at FROM artifact_submissions WHERE submitted_by_id=$1 ORDER BY created_at DESC LIMIT 20",
            user_id,
        )
    if not rows:
        return {"found": False, "message": "No artifact submissions found"}
    return {
        "found": True,
        "artifacts": [
            {"id": str(r["id"]), "name": r["name"], "display_name": r["display_name"],
             "type": r["artifact_type"], "status": r["status"],
             "submitted_by": r.get("submitted_by_name"),
             "submitted": str(r["created_at"])[:10] if r["created_at"] else None}
            for r in rows
        ],
    }


@_tool
async def get_artifact_status(artifact_id: str, user_id: str, user_role: str) -> dict:
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM artifact_submissions WHERE id=$1", artifact_id)
    if not row:
        return {"found": False, "message": "Artifact not found"}
    if user_role != "admin" and str(row.get("submitted_by_id", "")) != user_id:
        return {"error": "You do not have permission to view this artifact"}
    return {
        "found": True,
        "id": str(row["id"]), "name": row["name"], "display_name": row["display_name"],
        "type": row["artifact_type"], "status": row["status"],
        "github_url": row.get("github_url"), "reject_reason": row.get("reject_reason"),
        "submitted": str(row["created_at"])[:10] if row["created_at"] else None,
    }
