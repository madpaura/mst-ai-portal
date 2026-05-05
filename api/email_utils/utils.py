import smtplib
import json
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
from loguru import logger as log
from config import settings
from database import get_db
from email_utils.template import generate_editorial_email


async def _get_smtp_cfg() -> dict:
    """Load SMTP config from DB, falling back to env settings."""
    db = await get_db()
    row = await db.fetchrow("SELECT value FROM app_settings WHERE key = 'smtp_config'")
    if row:
        cfg = json.loads(row["value"])
        return {
            "server": cfg.get("smtp_server", settings.SMTP_SERVER),
            "port": int(cfg.get("smtp_port", settings.SMTP_PORT)),
            "user": cfg.get("smtp_user", settings.SMTP_USER),
            "password": cfg.get("smtp_password", settings.SMTP_PASSWORD),
            "from_email": cfg.get("smtp_from_email", settings.SMTP_FROM_EMAIL),
            "from_name": cfg.get("smtp_from_name", settings.SMTP_FROM_NAME),
        }
    return {
        "server": settings.SMTP_SERVER,
        "port": settings.SMTP_PORT,
        "user": settings.SMTP_USER,
        "password": settings.SMTP_PASSWORD,
        "from_email": settings.SMTP_FROM_EMAIL,
        "from_name": settings.SMTP_FROM_NAME,
    }


def _make_smtp_connection(cfg: dict):
    if cfg["port"] == 465:
        server = smtplib.SMTP_SSL(cfg["server"], cfg["port"], timeout=15)
    else:
        server = smtplib.SMTP(cfg["server"], cfg["port"], timeout=15)
        server.ehlo()
        if server.has_extn("starttls"):
            server.starttls()
    server.ehlo()
    if cfg["user"] and cfg["password"]:
        server.login(cfg["user"], cfg["password"])
    return server


async def send_email(
    to_email: str,
    subject: str,
    html_content: str,
    plain_text: Optional[str] = None,
) -> bool:
    """Send email to a single recipient."""
    try:
        cfg = await _get_smtp_cfg()
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{cfg['from_name']} <{cfg['from_email']}>"
        msg["To"] = to_email
        if plain_text:
            msg.attach(MIMEText(plain_text, "plain"))
        msg.attach(MIMEText(html_content, "html"))

        server = _make_smtp_connection(cfg)
        server.sendmail(cfg["from_email"], [to_email], msg.as_string())
        server.quit()
        return True
    except Exception as e:
        log.error(f"Email send failed: {e}")
        return False


async def send_email_multi(
    subject: str,
    html_content: str,
    plain_text: Optional[str] = None,
    to_emails: Optional[list[str]] = None,
    cc_emails: Optional[list[str]] = None,
    bcc_emails: Optional[list[str]] = None,
) -> bool:
    """Send one email to multiple recipients in a single SMTP transaction.

    to_emails  — visible To recipients
    cc_emails  — visible CC recipients (e.g. message sender)
    bcc_emails — hidden BCC recipients (e.g. newsletter list)
    BCC addresses are passed to sendmail() but NOT written into headers.
    """
    to_emails = to_emails or []
    cc_emails = cc_emails or []
    bcc_emails = bcc_emails or []
    all_recipients = list({*to_emails, *cc_emails, *bcc_emails})
    if not all_recipients:
        log.warning("send_email_multi called with no recipients")
        return False
    try:
        cfg = await _get_smtp_cfg()
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{cfg['from_name']} <{cfg['from_email']}>"
        # To: header shows explicit To list; if none, show portal address so inbox displays nicely
        msg["To"] = ", ".join(to_emails) if to_emails else f"{cfg['from_name']} <{cfg['from_email']}>"
        if cc_emails:
            msg["CC"] = ", ".join(cc_emails)
        # BCC: deliberately omitted from headers
        if plain_text:
            msg.attach(MIMEText(plain_text, "plain"))
        msg.attach(MIMEText(html_content, "html"))

        server = _make_smtp_connection(cfg)
        server.sendmail(cfg["from_email"], all_recipients, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        log.error(f"send_email_multi failed: {e}")
        return False


def generate_email_html(video_data: dict, featured_items: list = None, stats: dict = None, series: dict = None, issue_label: str = None) -> str:
    """
    Generate HTML email using editorial template.

    Args:
        video_data: Featured item {title, description, category, slug, duration, author, author_initials, tag, link}
        featured_items: List of additional items to show in grid (auto-filled if not provided)
        stats: Stats dict {label: value} (auto-filled if not provided)
        series: Featured series info (optional)
    """
    # Featured item
    featured = {
        "title": video_data.get("title", "New Video"),
        "description": video_data.get("description", "A new session from your AI learning library."),
        "category": video_data.get("category", "Learning"),
        "duration": video_data.get("duration", "45:30"),
        "author": video_data.get("author", "AI Ignite"),
        "author_initials": video_data.get("author_initials", "AI"),
        "tag": video_data.get("tag", "Featured"),
        "link": video_data.get("link", f"{settings.PORTAL_URL}/ignite"),
    }

    # Default featured items if not provided
    if not featured_items:
        featured_items = [
            {
                "title": "Next Session",
                "category": "Learning",
                "tag": "New",
                "duration": "38:15",
                "level": "Intermediate",
            },
            {
                "title": "Advanced Topic",
                "category": "Deep Dive",
                "tag": "Deep Dive",
                "duration": "52:44",
                "level": "Advanced",
            },
            {
                "title": "Introduction Guide",
                "category": "Foundations",
                "tag": "Beginner",
                "duration": "22:10",
                "level": "Beginner",
            },
        ]

    # Default stats if not provided
    if not stats:
        stats = {
            "total videos": "42",
            "new this week": "8",
            "active series": "6",
            "hours of content": "4h",
        }

    # Generate editorial email
    return generate_editorial_email(
        issue_title="Your AI<br><em>Learning</em><br>Digest",
        issue_number=1,
        featured_item=featured,
        featured_items=featured_items,
        stats=stats,
        featured_series=series,
        cta_text="Explore the full library",
        cta_link=settings.PORTAL_URL,
        issue_label=issue_label,
    )
