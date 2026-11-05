"""Email notifications for the MMRAG space workflow.

Access keys are never emailed: messages point to the portal, where the owner can
reveal the key on demand.
"""
from html import escape
from typing import Optional

from loguru import logger as log

from config import settings
from database import get_db
from email_utils.utils import (
    filter_deliverable,
    get_publish_authority_emails,
    send_email,
    send_email_multi,
)


async def _reviewer_emails() -> list[str]:
    """Publish Authority reviewers, falling back to every admin when none are set."""
    emails = await get_publish_authority_emails()
    if emails:
        return emails
    db = await get_db()
    rows = await db.fetch("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL")
    return filter_deliverable([r["email"] for r in rows])


def render(heading: str, intro: str, space: dict, note: Optional[str], link: str, link_label: str) -> str:
    rows = "".join(
        f'<p style="color:#94a3b8;font-size:13px;margin:0 0 4px;"><b>{label}:</b> {escape(str(value))}</p>'
        for label, value in (
            ("Space", space["name"]),
            ("Space ID", space["slug"]),
            ("PLM project", space["plm_project"]),
        )
    )
    note_html = (
        f'<p style="color:#f1f5f9;font-size:14px;white-space:pre-wrap;margin:0 0 20px;">{escape(note)}</p>'
        if note else ""
    )
    return f"""
    <div style="font-family:Inter,sans-serif;background:#0a0f14;padding:32px;border-radius:12px;max-width:600px;margin:auto;">
      <h2 style="color:#f1f5f9;font-size:20px;margin-bottom:4px;">{escape(heading)}</h2>
      <p style="color:#94a3b8;font-size:14px;margin-bottom:24px;">{escape(intro)}</p>
      <div style="background:#131a22;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:16px;margin-bottom:20px;">{rows}</div>
      {note_html}
      <a href="{escape(link, quote=True)}" style="display:inline-block;background:#258cf4;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">{escape(link_label)}</a>
      <p style="color:#475569;font-size:11px;margin-top:24px;">MST AI Portal · MMRAG Spaces</p>
    </div>
    """


async def notify_owner(space: dict, subject: str, heading: str, intro: str, note: Optional[str] = None):
    email = (filter_deliverable([space.get("owner_email") or ""]) or [None])[0]
    if not email:
        log.warning("MMRAG notification skipped: no deliverable email for the owner of {}", space["slug"])
        return
    link = f"{settings.PORTAL_BASE_URL.rstrip('/')}/rag-spaces"
    html = render(heading, intro, space, note, link, "Open MMRAG Spaces")
    if not await send_email(email, subject, html):
        log.error("MMRAG owner notification was not delivered for {}", space["slug"])


async def notify_reviewers(space: dict, subject: str, heading: str, intro: str, note: Optional[str] = None):
    recipients = await _reviewer_emails()
    if not recipients:
        log.warning("MMRAG review notification skipped: no reviewer has a deliverable email")
        return
    link = f"{settings.PORTAL_BASE_URL.rstrip('/')}/admin/rag-spaces"
    html = render(heading, intro, space, note, link, "Review in Admin Panel")
    if not await send_email_multi(subject=subject, html_content=html, to_emails=recipients):
        log.error("MMRAG review notification was not delivered for {}", space["slug"])
