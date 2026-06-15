import smtplib
import json
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
from loguru import logger as log
from config import settings
from database import get_db
from email_utils.template import generate_editorial_email

# SMTP errors that indicate a transient failure worth retrying.
# SMTPException inherits from OSError in Python 3, so we list specific
# transient subclasses rather than broad OSError to avoid catching permanent
# failures like SMTPRecipientsRefused or SMTPSenderRefused.
_TRANSIENT_SMTP_ERRORS = (
    smtplib.SMTPServerDisconnected,
    smtplib.SMTPConnectError,
    smtplib.SMTPHeloError,
    ConnectionError,
    TimeoutError,
)

_EMAIL_MAX_ATTEMPTS = 3


def _send_smtp(cfg: dict, msg, recipients: list) -> None:
    """Send via SMTP with retry on transient errors. Raises on final failure."""
    last_exc: Exception = RuntimeError("No attempt made")
    for attempt in range(1, _EMAIL_MAX_ATTEMPTS + 1):
        try:
            server = _make_smtp_connection(cfg)
            server.sendmail(cfg["from_email"], recipients, msg.as_string())
            server.quit()
            return
        except _TRANSIENT_SMTP_ERRORS as e:
            last_exc = e
            if attempt < _EMAIL_MAX_ATTEMPTS:
                backoff = 2 ** attempt
                log.warning(f"SMTP transient error (attempt {attempt}/{_EMAIL_MAX_ATTEMPTS}), "
                             f"retrying in {backoff}s: {e}")
                time.sleep(backoff)
            else:
                log.error(f"SMTP send failed after {_EMAIL_MAX_ATTEMPTS} attempts: {e}")
        except Exception as e:
            raise  # non-transient — don't retry
    raise last_exc


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
            # Empty string in DB means "no prefix"; only fall back to the env
            # default when the key is absent entirely.
            "subject_prefix": cfg.get("subject_prefix", settings.EMAIL_SUBJECT_PREFIX),
        }
    return {
        "server": settings.SMTP_SERVER,
        "port": settings.SMTP_PORT,
        "user": settings.SMTP_USER,
        "password": settings.SMTP_PASSWORD,
        "from_email": settings.SMTP_FROM_EMAIL,
        "from_name": settings.SMTP_FROM_NAME,
        "subject_prefix": settings.EMAIL_SUBJECT_PREFIX,
    }


def _apply_subject_prefix(subject: str, cfg: dict) -> str:
    """Prepend the configured prefix to every email subject (e.g. 'MSTAI-TF').
    Idempotent — won't double-prefix a subject that already starts with it."""
    prefix = (cfg.get("subject_prefix") or "").strip()
    if not prefix:
        return subject
    if subject.startswith(prefix):
        return subject
    return f"{prefix} {subject}"


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
    """Send email to a single recipient (with retry on transient SMTP errors)."""
    try:
        cfg = await _get_smtp_cfg()
        msg = MIMEMultipart("alternative")
        msg["Subject"] = _apply_subject_prefix(subject, cfg)
        msg["From"] = f"{cfg['from_name']} <{cfg['from_email']}>"
        msg["To"] = to_email
        if plain_text:
            msg.attach(MIMEText(plain_text, "plain"))
        msg.attach(MIMEText(html_content, "html"))
        _send_smtp(cfg, msg, [to_email])
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
        msg["Subject"] = _apply_subject_prefix(subject, cfg)
        msg["From"] = f"{cfg['from_name']} <{cfg['from_email']}>"
        # To: header shows explicit To list; if none, show portal address so inbox displays nicely
        msg["To"] = ", ".join(to_emails) if to_emails else f"{cfg['from_name']} <{cfg['from_email']}>"
        if cc_emails:
            msg["CC"] = ", ".join(cc_emails)
        # BCC: deliberately omitted from headers
        if plain_text:
            msg.attach(MIMEText(plain_text, "plain"))
        msg.attach(MIMEText(html_content, "html"))

        _send_smtp(cfg, msg, all_recipients)
        return True
    except Exception as e:
        log.error(f"send_email_multi failed: {e}")
        return False


# Placeholder / non-routable domains used by seeded or test accounts (e.g. the
# default admin@mst.internal). Sending to these makes the SMTP server refuse the
# whole message, so we drop them before notifying.
_UNDELIVERABLE_DOMAINS = (".internal", ".local", ".localhost", "localhost", "example.com", "example.org")


def filter_deliverable(emails: list[str]) -> list[str]:
    """Drop blank, malformed, and non-routable addresses (e.g. admin@mst.internal),
    de-duplicating while preserving order. Sending to an undeliverable address makes
    the SMTP server refuse the whole message, so these must never reach send."""
    out: list[str] = []
    seen: set[str] = set()
    for e in emails or []:
        e = (e or "").strip()
        if not e or "@" not in e:
            continue
        domain = e.rsplit("@", 1)[1].lower()
        if any(domain == d or domain.endswith(d) for d in _UNDELIVERABLE_DOMAINS):
            continue
        key = e.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


async def get_publish_authority_emails() -> list[str]:
    """Return the configured 'Publish Authority' emails (Admin → Settings),
    filtered to deliverable addresses. These are the people authorised to review
    publish/contributor requests — notifications go to them, not to every admin."""
    db = await get_db()
    row = await db.fetchrow("SELECT value FROM app_settings WHERE key = 'publish_authority'")
    if not row:
        return []
    try:
        emails = json.loads(row["value"]) or []
    except Exception:
        return []
    return filter_deliverable(emails)


def generate_item_email_html(
    item: dict,
    related_items: Optional[list] = None,
    stats: Optional[dict] = None,
    issue_title: str = "Portal<br><em>Update</em>",
    cta_text: str = "Explore the portal",
    cta_link: Optional[str] = None,
    issue_label: Optional[str] = None,
) -> str:
    """Generate a single-item editorial email (article, marketplace component, …).

    Unlike generate_email_html (which fills video-flavored placeholder items when
    none are given), this passes the caller's lists through verbatim — pass an
    empty related_items to omit the "more to explore" grid entirely.

    item keys: title, description, category, duration, author, author_initials, tag, link
    """
    featured = {
        "title": item.get("title", ""),
        "description": item.get("description", ""),
        "category": item.get("category", "Update"),
        "duration": item.get("duration", ""),
        "author": item.get("author", "MST AI Portal"),
        "author_initials": item.get("author_initials", "AI"),
        "tag": item.get("tag", "Featured"),
        "link": item.get("link", settings.PORTAL_URL),
    }
    return generate_editorial_email(
        issue_title=issue_title,
        issue_number=1,
        featured_item=featured,
        featured_items=related_items or [],
        stats=stats or {},
        cta_text=cta_text,
        cta_link=cta_link or settings.PORTAL_URL,
        issue_label=issue_label,
    )


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
