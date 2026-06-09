"""The read-only endpoint catalog and discovery of real ids/slugs.

Every entry here is a non-mutating GET. Endpoints with no server-side side
effects only — analytics pageview/event, meme click-redirects, forge download
counters and any progress/notes/likes writes are deliberately excluded so the
suite is safe to run against production.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional


SEARCH_TERMS = [
    "ai", "llm", "video", "agent", "python", "course", "model", "data",
    "security", "automation", "rag", "prompt", "skill", "mcp", "guide",
]


@dataclass
class Endpoint:
    key: str                       # label in reports
    path: str                      # may contain {placeholder}
    weight: float = 1.0            # relative selection weight
    auth: bool = False             # requires a minted identity
    group: str = "misc"           # for report grouping
    needs: List[str] = field(default_factory=list)  # discovery keys for placeholders
    query: Optional[Callable[[], Dict[str, str]]] = None


# Discovery keys → which list endpoint feeds them
DISCOVERY_SOURCES = {
    "video_slug":   ("/video/videos", lambda v: v.get("slug")),
    "course_slug":  ("/video/courses", lambda v: v.get("slug")),
    "article_slug": ("/articles", lambda v: v.get("slug")),
    "card_id":      ("/api/solutions/cards", lambda v: v.get("id")),
    "news_id":      ("/api/solutions/news", lambda v: v.get("id")),
    "component_slug": ("/forge/components", lambda v: v.get("slug")),
    "meme_slug":    ("/memes/groups", lambda v: v.get("slug")),
}


def _q_search() -> Dict[str, str]:
    return {"q": random.choice(SEARCH_TERMS)}


# ── Catalog (weights reflect a realistic corporate-portal browse mix) ─────────
CATALOG: List[Endpoint] = [
    # Infra / cheap
    Endpoint("health", "/health", weight=1.0, group="infra"),

    # Ignite (video) — the heaviest, most-used section
    Endpoint("video.list", "/video/videos", weight=8, group="ignite"),
    Endpoint("video.stats", "/video/videos/stats", weight=2, group="ignite"),
    Endpoint("video.like_counts", "/video/videos/like-counts", weight=2, group="ignite"),
    Endpoint("video.courses", "/video/courses", weight=4, group="ignite"),
    Endpoint("video.course_detail", "/video/courses/{course_slug}", weight=3,
             group="ignite", needs=["course_slug"]),
    Endpoint("video.detail", "/video/videos/{video_slug}", weight=6,
             group="ignite", needs=["video_slug"]),
    Endpoint("video.chapters", "/video/videos/{video_slug}/chapters", weight=3,
             group="ignite", needs=["video_slug"]),
    Endpoint("video.attachments", "/video/videos/{video_slug}/attachments", weight=2,
             group="ignite", needs=["video_slug"]),
    Endpoint("video.howto", "/video/videos/{video_slug}/howto", weight=2,
             group="ignite", needs=["video_slug"]),
    Endpoint("video.likes", "/video/videos/{video_slug}/likes", weight=2,
             group="ignite", needs=["video_slug"]),

    # Solutions
    Endpoint("sol.landing", "/api/solutions/landing_page", weight=3, group="solutions"),
    Endpoint("sol.cards", "/api/solutions/cards", weight=5, group="solutions"),
    Endpoint("sol.card_detail", "/api/solutions/cards/{card_id}", weight=3,
             group="solutions", needs=["card_id"]),
    Endpoint("sol.capabilities", "/api/solutions/capabilities", weight=2, group="solutions"),
    Endpoint("sol.announcements", "/api/solutions/announcements", weight=2, group="solutions"),
    Endpoint("sol.news", "/api/solutions/news", weight=3, group="solutions"),
    Endpoint("sol.news_detail", "/api/solutions/news/{news_id}", weight=2,
             group="solutions", needs=["news_id"]),

    # Articles
    Endpoint("art.list", "/articles", weight=4, group="articles"),
    Endpoint("art.categories", "/articles/categories", weight=2, group="articles"),
    Endpoint("art.detail", "/articles/{article_slug}", weight=3,
             group="articles", needs=["article_slug"]),

    # Forge / marketplace
    Endpoint("forge.components", "/forge/components", weight=3, group="forge"),
    Endpoint("forge.categories", "/forge/categories", weight=1, group="forge"),
    Endpoint("forge.component_detail", "/forge/components/{component_slug}", weight=2,
             group="forge", needs=["component_slug"]),
    Endpoint("forge.instructions", "/forge/components/{component_slug}/instructions", weight=1,
             group="forge", needs=["component_slug"]),

    # Memes
    Endpoint("memes.groups", "/memes/groups", weight=1, group="memes"),
    Endpoint("memes.categories", "/memes/categories", weight=1, group="memes"),
    Endpoint("memes.group_detail", "/memes/groups/{meme_slug}", weight=1,
             group="memes", needs=["meme_slug"]),

    # Search — DB-heavy, worth stressing
    Endpoint("search.query", "/search", weight=3, group="search", query=_q_search),
    Endpoint("search.suggest", "/search/suggest", weight=3, group="search", query=_q_search),

    # Authenticated reads (exercise the JWT path + per-user queries)
    Endpoint("auth.me", "/auth/me", weight=2, group="auth", auth=True),
    Endpoint("video.progress", "/video/progress", weight=2, group="auth", auth=True),
    Endpoint("video.bookmarks", "/video/bookmarks", weight=1, group="auth", auth=True),
    Endpoint("video.playlists", "/video/playlists", weight=1, group="auth", auth=True),
    Endpoint("video.my_courses", "/video/my-courses", weight=1, group="auth", auth=True),
    Endpoint("art.mine", "/articles/my", weight=1, group="auth", auth=True),
    Endpoint("assistant.enabled", "/assistant/enabled", weight=1, group="auth", auth=True),
]


class Discovery:
    """Fetches list endpoints once to learn real ids/slugs (and HLS paths)."""

    def __init__(self) -> None:
        self.pools: Dict[str, List[str]] = {}
        self.videos: List[dict] = []   # full video objects (for HLS scenario)

    async def run(self, http, identity_cookie: Optional[str] = None) -> "Discovery":
        headers = {"Cookie": identity_cookie} if identity_cookie else {}
        for key, (path, extract) in DISCOVERY_SOURCES.items():
            try:
                r = await http.get(path, headers=headers, timeout=20.0)
                if r.status_code != 200:
                    self.pools[key] = []
                    continue
                data = r.json()
                items = data if isinstance(data, list) else data.get("items", [])
                vals = [str(extract(v)) for v in items if extract(v)]
                self.pools[key] = vals
                if key == "video_slug":
                    self.videos = [v for v in items if isinstance(v, dict)]
            except Exception:
                self.pools[key] = []
        return self

    def pick(self, key: str) -> Optional[str]:
        pool = self.pools.get(key)
        if not pool:
            return None
        return random.choice(pool)

    def available(self, ep: Endpoint) -> bool:
        """True if every placeholder this endpoint needs has at least one value."""
        return all(self.pools.get(k) for k in ep.needs)


def build_request(ep: Endpoint, disc: Discovery):
    """Return (path, query_dict) with placeholders filled, or None if not resolvable."""
    path = ep.path
    for key in ep.needs:
        val = disc.pick(key)
        if val is None:
            return None
        placeholder = "{" + _placeholder_for(ep.path, key) + "}"
        path = path.replace(placeholder, val)
    query = ep.query() if ep.query else None
    return path, query


def _placeholder_for(path: str, need_key: str) -> str:
    # The placeholder name in the path equals the need key by convention.
    return need_key
