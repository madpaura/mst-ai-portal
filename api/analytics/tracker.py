"""Lightweight helpers to record page views and analytics events."""

from fastapi import Request
from typing import Optional
from database import get_db


SECTION_MAP = {
    "/": "solutions",
    "/marketplace": "marketplace",
    "/ignite": "ignite",
    "/news": "news",
    "/howto": "ignite",
}


def _resolve_section(path: str) -> str:
    for prefix, section in SECTION_MAP.items():
        if path == prefix or path.startswith(prefix + "/"):
            return section
    return "other"


async def record_page_view(
    path: str,
    request: Request,
    user_id: Optional[str] = None,
) -> None:
    db = await get_db()
    section = _resolve_section(path)
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent", "")[:500]
    referrer = request.headers.get("referer", "")[:500] or None

    await db.execute(
        """INSERT INTO page_views (path, section, ip_address, user_agent, user_id, referrer)
           VALUES ($1, $2, $3, $4, $5, $6)""",
        path, section, ip, ua, user_id, referrer,
    )


async def record_event(
    event_type: str,
    section: str,
    entity_id: Optional[str] = None,
    entity_name: Optional[str] = None,
    user_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    import json
    db = await get_db()
    await db.execute(
        """INSERT INTO analytics_events
           (event_type, section, entity_id, entity_name, user_id, ip_address, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)""",
        event_type, section, entity_id, entity_name, user_id, ip_address,
        json.dumps(metadata or {}),
    )
