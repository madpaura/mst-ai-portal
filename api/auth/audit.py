"""Lightweight admin audit logging — fire-and-forget DB inserts."""
from __future__ import annotations

from typing import Any

from fastapi import Request
from loguru import logger as log


async def audit(
    request: Request,
    admin: dict,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    try:
        from database import get_db
        db = await get_db()
        request_id = getattr(request.state, "request_id", None)
        ip = request.headers.get("x-forwarded-for", request.client.host if request.client else None)
        await db.execute(
            """
            INSERT INTO admin_audit_log
                (admin_id, admin_name, action, target_type, target_id, details, ip_address, request_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            str(admin["id"]),
            admin.get("display_name") or admin.get("username"),
            action,
            target_type,
            str(target_id) if target_id is not None else None,
            details or {},
            ip,
            request_id,
        )
    except Exception as exc:
        log.warning(f"audit log failed: {exc}")
