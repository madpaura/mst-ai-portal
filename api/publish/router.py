import json
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from loguru import logger as log

from database import get_db
from auth.dependencies import require_admin, require_content
from email_utils.utils import send_email_multi
from config import settings
import cache

router = APIRouter()


class PublishRequestCreate(BaseModel):
    target_type: str   # "video" or "marketplace"
    target_id: str
    target_title: str
    note: Optional[str] = None


class PublishRequestReview(BaseModel):
    note: Optional[str] = None


def _row_to_dict(r) -> dict:
    return {
        "id": str(r["id"]),
        "target_type": r["target_type"],
        "target_id": str(r["target_id"]),
        "target_title": r["target_title"],
        "requested_by": str(r["requested_by"]),
        "requester_name": r["requester_name"],
        "requester_email": r["requester_email"],
        "status": r["status"],
        "note": r["note"],
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        "reviewed_at": r["reviewed_at"].isoformat() if r["reviewed_at"] else None,
        "reviewer_name": r["reviewer_name"],
    }


async def _get_authority_emails(db) -> list[str]:
    """Return list of publish-authority emails from app_settings."""
    row = await db.fetchrow("SELECT value FROM app_settings WHERE key = 'publish_authority'")
    if not row:
        return []
    try:
        return json.loads(row["value"]) or []
    except Exception:
        return []


# Placeholder / non-routable domains used by seeded or test accounts (e.g. the
# default admin@mst.internal). Sending to these makes the SMTP server refuse the
# whole message, so we drop them before notifying.
_UNDELIVERABLE_DOMAINS = (".internal", ".local", ".localhost", "localhost", "example.com", "example.org")


def _deliverable(emails: list[str]) -> list[str]:
    out = []
    for e in emails:
        e = (e or "").strip()
        if not e or "@" not in e:
            continue
        domain = e.rsplit("@", 1)[1].lower()
        if any(domain == d or domain.endswith(d) for d in _UNDELIVERABLE_DOMAINS):
            continue
        out.append(e)
    return out


async def _notify_reviewers(db, req_id: str, target_type: str, target_title: str,
                            requester_name: str, note: str | None, portal_url: str):
    authority = await _get_authority_emails(db)
    recipients = _deliverable(list(dict.fromkeys(authority)))
    if not recipients:
        log.warning(
            "Publish-request notification skipped: no deliverable 'Publish Authority' emails. "
            "Configure 'Publish Authority' emails in Admin → Settings (real, non-.internal/.local "
            f"addresses). (authority={len(authority)})"
        )
        return
    log.info(f"Notifying {len(recipients)} reviewer(s) of publish request '{target_title}': {recipients}")

    type_label = "Video" if target_type == "video" else "Marketplace Item"
    review_link = f"{portal_url}/admin/videos" if target_type == "video" else f"{portal_url}/admin/marketplace"
    note_html = f"<p style='color:#94a3b8;font-size:13px;'><b>Note:</b> {note}</p>" if note else ""

    html = f"""
    <div style="font-family:Inter,sans-serif;background:#0a0f14;padding:32px;border-radius:12px;max-width:600px;margin:auto;">
      <h2 style="color:#f1f5f9;font-size:20px;margin-bottom:4px;">Publish Request</h2>
      <p style="color:#64748b;font-size:13px;margin-bottom:24px;">A contributor has requested to publish a {type_label.lower()}.</p>
      <div style="background:#131a22;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:16px;margin-bottom:20px;">
        <p style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">{type_label}</p>
        <p style="color:#f1f5f9;font-size:16px;font-weight:600;margin:0 0 8px;">{target_title}</p>
        <p style="color:#64748b;font-size:13px;margin:0;">Requested by: <span style="color:#94a3b8;">{requester_name}</span></p>
      </div>
      {note_html}
      <a href="{review_link}" style="display:inline-block;background:#258cf4;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;margin-top:8px;">
        Review in Admin Panel →
      </a>
      <p style="color:#475569;font-size:11px;margin-top:24px;">MST AI Portal · Publish Requests</p>
    </div>
    """
    try:
        sent = await send_email_multi(
            subject=f"Publish Request: {target_title}",
            html_content=html,
            to_emails=recipients,
        )
        if not sent:
            log.error(
                "Publish-request notification was NOT delivered. Check SMTP settings "
                "in Admin → Settings (server/port/credentials) — see preceding SMTP log lines."
            )
    except Exception as e:
        log.error(f"Failed to send publish request notification: {e}")


async def _notify_requester(requester_email: str, requester_name: str,
                            target_type: str, target_title: str,
                            approved: bool, note: str | None, view_link: str):
    if not requester_email:
        return
    status_word = "Approved" if approved else "Rejected"
    status_color = "#22c55e" if approved else "#ef4444"
    type_label = "video" if target_type == "video" else "marketplace item"
    note_html = f"<p style='color:#94a3b8;font-size:13px;'><b>Reviewer note:</b> {note}</p>" if note else ""
    action_html = (
        f'<a href="{view_link}" style="display:inline-block;background:#258cf4;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;margin-top:8px;">View on Portal →</a>'
        if approved else ""
    )

    html = f"""
    <div style="font-family:Inter,sans-serif;background:#0a0f14;padding:32px;border-radius:12px;max-width:600px;margin:auto;">
      <h2 style="color:{status_color};font-size:20px;margin-bottom:4px;">Publish Request {status_word}</h2>
      <p style="color:#64748b;font-size:13px;margin-bottom:24px;">Hi {requester_name}, your publish request has been reviewed.</p>
      <div style="background:#131a22;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:16px;margin-bottom:20px;">
        <p style="color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">{type_label.title()}</p>
        <p style="color:#f1f5f9;font-size:16px;font-weight:600;margin:0;">{target_title}</p>
      </div>
      {note_html}
      {action_html}
      <p style="color:#475569;font-size:11px;margin-top:24px;">MST AI Portal · Publish Requests</p>
    </div>
    """
    try:
        await send_email_multi(
            subject=f"Publish Request {status_word}: {target_title}",
            html_content=html,
            to_emails=[requester_email],
        )
    except Exception as e:
        log.error(f"Failed to send publish decision notification: {e}")


# ── Endpoints ────────────────────────────────────────────────


@router.post("/publish-requests")
async def create_publish_request(
    req: PublishRequestCreate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_content),
):
    if req.target_type not in ("video", "marketplace"):
        raise HTTPException(status_code=400, detail="target_type must be 'video' or 'marketplace'")
    db = await get_db()

    # Block duplicate pending requests
    existing = await db.fetchrow(
        "SELECT id FROM publish_requests WHERE target_type=$1 AND target_id=$2 AND status='pending'",
        req.target_type, req.target_id,
    )
    if existing:
        raise HTTPException(status_code=409, detail="A pending publish request already exists for this item")

    row = await db.fetchrow(
        """INSERT INTO publish_requests
           (target_type, target_id, target_title, requested_by, requester_name, requester_email, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *""",
        req.target_type, req.target_id, req.target_title,
        user["id"], user.get("display_name") or user.get("username"),
        user.get("email"), req.note,
    )
    background_tasks.add_task(
        _notify_reviewers, db,
        str(row["id"]), req.target_type, req.target_title,
        user.get("display_name") or user.get("username"), req.note, settings.PORTAL_BASE_URL,
    )
    return _row_to_dict(row)


@router.get("/publish-requests")
async def list_publish_requests(
    status: Optional[str] = None,
    admin: dict = Depends(require_admin),
):
    db = await get_db()
    if status:
        rows = await db.fetch(
            "SELECT * FROM publish_requests WHERE status=$1 ORDER BY created_at DESC", status
        )
    else:
        rows = await db.fetch("SELECT * FROM publish_requests ORDER BY created_at DESC")
    return [_row_to_dict(r) for r in rows]


@router.get("/publish-requests/my")
async def my_publish_requests(user: dict = Depends(require_content)):
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM publish_requests WHERE requested_by=$1 ORDER BY created_at DESC",
        user["id"],
    )
    return [_row_to_dict(r) for r in rows]


@router.post("/publish-requests/{req_id}/approve")
async def approve_publish_request(
    req_id: str,
    body: PublishRequestReview,
    background_tasks: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    db = await get_db()
    pr = await db.fetchrow("SELECT * FROM publish_requests WHERE id=$1", req_id)
    if not pr:
        raise HTTPException(status_code=404, detail="Request not found")
    if pr["status"] != "pending":
        raise HTTPException(status_code=400, detail="Request already reviewed")

    # Publish the actual content
    view_link = f"{settings.PORTAL_BASE_URL}/ignite"
    if pr["target_type"] == "video":
        video = await db.fetchrow("SELECT status, slug FROM videos WHERE id=$1", pr["target_id"])
        if not video:
            raise HTTPException(status_code=404, detail="Video not found")
        if video["status"] != "ready":
            raise HTTPException(status_code=400, detail="Video must be transcoded before publishing")
        await db.execute("UPDATE videos SET is_published=true WHERE id=$1", pr["target_id"])
        await cache.bump_version(cache.NS_VIDEO)
        # Deep-link straight to the published video so "View on Portal" lands on it
        view_link = f"{settings.PORTAL_BASE_URL}/ignite/{video['slug']}" if video["slug"] else view_link
    elif pr["target_type"] == "marketplace":
        view_link = f"{settings.PORTAL_BASE_URL}/marketplace"
        comp = await db.fetchrow("SELECT id FROM forge_components WHERE id=$1", pr["target_id"])
        if not comp:
            raise HTTPException(status_code=404, detail="Marketplace item not found")
        await db.execute("UPDATE forge_components SET is_active=true, updated_at=now() WHERE id=$1", pr["target_id"])

    reviewer_name = admin.get("display_name") or admin.get("username")
    await db.execute(
        """UPDATE publish_requests
           SET status='approved', reviewed_at=now(), reviewed_by=$2, reviewer_name=$3, note=COALESCE($4, note)
           WHERE id=$1""",
        req_id, admin["id"], reviewer_name, body.note,
    )
    background_tasks.add_task(
        _notify_requester,
        pr["requester_email"], pr["requester_name"],
        pr["target_type"], pr["target_title"],
        True, body.note, view_link,
    )
    return {"message": "Approved and published"}


@router.post("/publish-requests/{req_id}/reject")
async def reject_publish_request(
    req_id: str,
    body: PublishRequestReview,
    background_tasks: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    db = await get_db()
    pr = await db.fetchrow("SELECT * FROM publish_requests WHERE id=$1", req_id)
    if not pr:
        raise HTTPException(status_code=404, detail="Request not found")
    if pr["status"] != "pending":
        raise HTTPException(status_code=400, detail="Request already reviewed")

    reviewer_name = admin.get("display_name") or admin.get("username")
    await db.execute(
        """UPDATE publish_requests
           SET status='rejected', reviewed_at=now(), reviewed_by=$2, reviewer_name=$3, note=COALESCE($4, note)
           WHERE id=$1""",
        req_id, admin["id"], reviewer_name, body.note,
    )
    background_tasks.add_task(
        _notify_requester,
        pr["requester_email"], pr["requester_name"],
        pr["target_type"], pr["target_title"],
        False, body.note, f"{settings.PORTAL_BASE_URL}/marketplace" if pr["target_type"] == "marketplace" else f"{settings.PORTAL_BASE_URL}/ignite",
    )
    return {"message": "Rejected"}


# ── Publish Authority Setting ────────────────────────────────

@router.get("/publish-authority")
async def get_publish_authority(admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow("SELECT value FROM app_settings WHERE key='publish_authority'")
    if not row:
        return []
    try:
        return json.loads(row["value"]) or []
    except Exception:
        return []


class PublishAuthorityUpdate(BaseModel):
    emails: list[str]


@router.put("/publish-authority")
async def set_publish_authority(req: PublishAuthorityUpdate, admin: dict = Depends(require_admin)):
    db = await get_db()
    cleaned = [e.strip().lower() for e in req.emails if e.strip()]
    await db.execute(
        """INSERT INTO app_settings (key, value) VALUES ('publish_authority', $1)
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value""",
        json.dumps(cleaned),
    )
    return cleaned
