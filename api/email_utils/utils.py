import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
from config import settings
from database import get_db
from email_utils.template import generate_editorial_email


async def send_email(
    to_email: str,
    subject: str,
    html_content: str,
    plain_text: Optional[str] = None,
) -> bool:
    """Send email via SMTP using saved settings or config defaults"""
    try:
        # Fetch SMTP settings from database
        db = await get_db()
        smtp_config = await db.fetchrow("SELECT value FROM app_settings WHERE key = 'smtp_config'")
        
        # Use saved settings or fall back to config defaults
        if smtp_config:
            import json
            cfg = json.loads(smtp_config['value'])
            smtp_server = cfg.get('smtp_server', settings.SMTP_SERVER)
            smtp_port = int(cfg.get('smtp_port', settings.SMTP_PORT))
            smtp_user = cfg.get('smtp_user', settings.SMTP_USER)
            smtp_password = cfg.get('smtp_password', settings.SMTP_PASSWORD)
            smtp_from_email = cfg.get('smtp_from_email', settings.SMTP_FROM_EMAIL)
            smtp_from_name = cfg.get('smtp_from_name', settings.SMTP_FROM_NAME)
        else:
            smtp_server = settings.SMTP_SERVER
            smtp_port = settings.SMTP_PORT
            smtp_user = settings.SMTP_USER
            smtp_password = settings.SMTP_PASSWORD
            smtp_from_email = settings.SMTP_FROM_EMAIL
            smtp_from_name = settings.SMTP_FROM_NAME

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{smtp_from_name} <{smtp_from_email}>"
        msg["To"] = to_email

        if plain_text:
            part1 = MIMEText(plain_text, "plain")
            msg.attach(part1)

        part2 = MIMEText(html_content, "html")
        msg.attach(part2)

        if smtp_port == 465:
            server = smtplib.SMTP_SSL(smtp_server, smtp_port, timeout=15)
            server.ehlo()
        else:
            server = smtplib.SMTP(smtp_server, smtp_port, timeout=15)
            server.ehlo()
            if server.has_extn("starttls"):
                server.starttls()
                server.ehlo()

        if smtp_user and smtp_password:
            server.login(smtp_user, smtp_password)

        server.sendmail(smtp_from_email, to_email, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"Email send failed: {str(e)}")
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
