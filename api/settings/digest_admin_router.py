from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import json
import smtplib
import socket
import asyncpg
import httpx
from loguru import logger as log

from auth.dependencies import require_admin
from email_utils.digest import generate_learning_digest
from email_utils.utils import send_email_multi, send_email_multi_inline
from config import settings
from database import get_db
from articles.llm import INHOUSE_LLM_HEADERS

router = APIRouter()


class DigestPreviewRequest(BaseModel):
    days: int = 7
    custom_content: str = ""
    skip_announcements: bool = False


class DigestPreviewResponse(BaseModel):
    subject: str
    html_content: str
    plain_text: str
    summary: dict


class SendDigestRequest(BaseModel):
    recipient_emails: list[str]
    subject: str
    html_content: str
    plain_text: str
    summary: dict
    days_covered: int = 7
    custom_content: str = ""
    issue_number: Optional[int] = None
    title: str = ""


class DigestIssue(BaseModel):
    id: int
    issue_number: int
    title: str
    subject: str
    created_at: datetime
    sent_at: Optional[datetime]
    recipient_count: int
    days_covered: int


@router.get("/digest-issues", response_model=List[DigestIssue])
async def get_digest_issues(admin: dict = Depends(require_admin)):
    """Get list of all digest issues"""
    pool = await get_db()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, issue_number, title, subject, created_at, sent_at, 
                   recipient_count, days_covered
            FROM digest_issues 
            ORDER BY issue_number DESC
        """)
        return [DigestIssue(**dict(row)) for row in rows]


class DigestIssueFull(BaseModel):
    id: int
    issue_number: int
    title: str
    subject: str
    html_content: str
    plain_text: str
    summary: dict
    days_covered: int
    custom_content: str
    created_at: datetime
    sent_at: Optional[datetime]
    recipient_count: int


@router.get("/digest-issues/{issue_id}", response_model=DigestIssueFull)
async def get_digest_issue(issue_id: int, admin: dict = Depends(require_admin)):
    """Get a single digest issue with full content"""
    import json
    pool = await get_db()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT id, issue_number, title, subject, html_content, plain_text,
                   summary, days_covered, custom_content, created_at, sent_at, recipient_count
            FROM digest_issues
            WHERE id = $1
        """, issue_id)
        if not row:
            raise HTTPException(status_code=404, detail="Digest issue not found")
        data = dict(row)
        if isinstance(data['summary'], str):
            data['summary'] = json.loads(data['summary'])
        return DigestIssueFull(**data)


@router.delete("/digest-issues/{issue_id}")
async def delete_digest_issue(issue_id: int, admin: dict = Depends(require_admin)):
    """Delete a digest issue"""
    pool = await get_db()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM digest_issues WHERE id = $1", issue_id
        )
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Digest issue not found")
        return {"message": "Digest issue deleted"}


async def get_next_issue_number() -> int:
    """Get the next issue number"""
    pool = await get_db()
    async with pool.acquire() as conn:
        # Try to get the current max issue number
        result = await conn.fetchval(
            "SELECT MAX(issue_number) FROM digest_issues"
        )
        return (result or 0) + 1


async def save_digest_issue(
    issue_number: int,
    title: str,
    subject: str,
    html_content: str,
    plain_text: str,
    summary: dict,
    days_covered: int,
    custom_content: str
) -> int:
    """Upsert a digest issue — insert or update if issue_number already exists."""
    import json
    pool = await get_db()
    async with pool.acquire() as conn:
        record_id = await conn.fetchval("""
            INSERT INTO digest_issues
            (issue_number, title, subject, html_content, plain_text,
             summary, days_covered, custom_content)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (issue_number) DO UPDATE SET
                title        = EXCLUDED.title,
                subject      = EXCLUDED.subject,
                html_content = EXCLUDED.html_content,
                plain_text   = EXCLUDED.plain_text,
                summary      = EXCLUDED.summary,
                days_covered = EXCLUDED.days_covered,
                custom_content = EXCLUDED.custom_content
            RETURNING id
        """, issue_number, title, subject, html_content, plain_text,
            json.dumps(summary), days_covered, custom_content)
        return record_id


class SendDigestResponse(BaseModel):
    success: bool
    message: str
    sent_count: int


@router.post("/digest-preview", response_model=DigestPreviewResponse)
async def digest_preview(req: DigestPreviewRequest, admin: dict = Depends(require_admin)):
    """Generate a preview of the learning digest email"""
    try:
        # Get next issue number
        issue_number = await get_next_issue_number()
        
        # Generate digest content (pass issue_number so it appears in email header)
        preview = await generate_learning_digest(req.days, req.custom_content or None, issue_number=issue_number, skip_announcements=req.skip_announcements)

        # Update subject and title with issue number
        title = f"AI Ignite Digest · {req.days}-Day Update - #{issue_number}"
        preview["subject"] = title
        preview["issue_number"] = issue_number
        preview["title"] = title
        
        return DigestPreviewResponse(**preview)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate digest: {str(e)}")


class SaveDigestRequest(BaseModel):
    subject: str
    html_content: str
    plain_text: str
    summary: dict
    days_covered: int = 7
    custom_content: str = ""
    issue_number: Optional[int] = None
    title: str = ""


class SaveDigestResponse(BaseModel):
    success: bool
    message: str
    issue_number: int


@router.post("/save-digest", response_model=SaveDigestResponse)
async def save_digest(req: SaveDigestRequest, admin: dict = Depends(require_admin)):
    """Save digest as a draft without sending"""
    try:
        issue_number = req.issue_number or await get_next_issue_number()
        title = req.title or f"AI Ignite Digest · {req.days_covered}-Day Update - #{issue_number}"

        await save_digest_issue(
            issue_number=issue_number,
            title=title,
            subject=req.subject,
            html_content=req.html_content,
            plain_text=req.plain_text,
            summary=req.summary,
            days_covered=req.days_covered,
            custom_content=req.custom_content,
        )
        return SaveDigestResponse(success=True, message=f"Issue #{issue_number} saved", issue_number=issue_number)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Save error: {str(e)}")


@router.post("/send-digest", response_model=SendDigestResponse)
async def send_digest(req: SendDigestRequest, admin: dict = Depends(require_admin)):
    """Send learning digest to multiple recipients"""
    try:
        # Save the digest issue
        issue_number = req.issue_number or await get_next_issue_number()
        title = req.title or f"AI Ignite Digest · Issue #{issue_number}"
        
        await save_digest_issue(
            issue_number=issue_number,
            title=title,
            subject=req.subject,
            html_content=req.html_content,
            plain_text=req.plain_text,
            summary=req.summary,
            days_covered=req.days_covered,
            custom_content=req.custom_content
        )

        # Send one email with all recipients in BCC
        total = len(req.recipient_emails)
        success = await send_email_multi(
            subject=req.subject,
            html_content=req.html_content,
            bcc_emails=req.recipient_emails,
        )

        sent_count = total if success else 0

        # Update recipient count
        pool = await get_db()
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE digest_issues SET sent_at = NOW(), recipient_count = $1 WHERE issue_number = $2",
                sent_count, issue_number
            )

        if success:
            return SendDigestResponse(
                success=True,
                message=f"Successfully sent Issue #{issue_number} to {total} recipients",
                sent_count=total,
            )
        else:
            return SendDigestResponse(
                success=False,
                message=f"Failed to send Issue #{issue_number} — check SMTP settings",
                sent_count=0,
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Digest send error: {str(e)}")


class GenerateEmlRequest(BaseModel):
    subject: str
    html_content: str
    plain_text: str = ""


@router.post("/generate-eml")
async def generate_eml(req: GenerateEmlRequest, admin: dict = Depends(require_admin)):
    """Generate a .eml file with full HTML newsletter body for external email clients"""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = req.subject
    msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
    msg["To"] = ""

    if req.plain_text:
        msg.attach(MIMEText(req.plain_text, "plain"))
    msg.attach(MIMEText(req.html_content, "html"))

    eml_bytes = msg.as_bytes()
    # Remove non-ASCII characters from filename for HTTP header compatibility
    import re
    safe_subject = re.sub(r'[^\x00-\x7F]+', '', req.subject)  # Remove non-ASCII
    filename = safe_subject.replace(" ", "_").replace(":", "").replace("/", "_")[:60] + ".eml"

    return Response(
        content=eml_bytes,
        media_type="message/rfc822",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class SendHtmlEmailRequest(BaseModel):
    subject: str
    html_content: str
    to_emails: Optional[List[str]] = None
    bcc_emails: Optional[List[str]] = None
    cc_emails: Optional[List[str]] = None


class SendHtmlEmailResponse(BaseModel):
    success: bool
    message: str
    sent_count: int


@router.post("/send-html-email", response_model=SendHtmlEmailResponse)
async def send_html_email(req: SendHtmlEmailRequest, admin: dict = Depends(require_admin)):
    """Send an arbitrary HTML email to the given recipients."""
    to = req.to_emails or []
    bcc = req.bcc_emails or []
    cc = req.cc_emails or []
    total = len({*to, *bcc, *cc})
    if total == 0:
        raise HTTPException(status_code=400, detail="At least one recipient is required")

    success = await send_email_multi(
        subject=req.subject,
        html_content=req.html_content,
        to_emails=to,
        cc_emails=cc,
        bcc_emails=bcc,
    )
    if success:
        return SendHtmlEmailResponse(
            success=True,
            message=f"Email sent to {total} recipient(s)",
            sent_count=total,
        )
    return SendHtmlEmailResponse(
        success=False,
        message="Send failed — check SMTP settings",
        sent_count=0,
    )


class InlineImage(BaseModel):
    cid: str
    filename: str
    content_b64: str
    mime: str = "image/png"


class SendHtmlEmailInlineRequest(SendHtmlEmailRequest):
    inline_images: List[InlineImage] = []


@router.post("/send-html-email-inline", response_model=SendHtmlEmailResponse)
async def send_html_email_inline(req: SendHtmlEmailInlineRequest, admin: dict = Depends(require_admin)):
    """Send an HTML email with images embedded as CID inline attachments
    (self-contained — renders inline in Gmail/Outlook/Apple Mail)."""
    to = req.to_emails or []
    bcc = req.bcc_emails or []
    cc = req.cc_emails or []
    total = len({*to, *bcc, *cc})
    if total == 0:
        raise HTTPException(status_code=400, detail="At least one recipient is required")

    success = await send_email_multi_inline(
        subject=req.subject,
        html_content=req.html_content,
        inline_images=[img.model_dump() for img in req.inline_images],
        to_emails=to,
        cc_emails=cc,
        bcc_emails=bcc,
    )
    if success:
        return SendHtmlEmailResponse(
            success=True,
            message=f"Email sent to {total} recipient(s)",
            sent_count=total,
        )
    return SendHtmlEmailResponse(
        success=False,
        message="Send failed — check SMTP settings",
        sent_count=0,
    )


class SmtpTestRequest(BaseModel):
    smtp_server: str
    smtp_port: int
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    test_recipient: str


@router.post("/test-smtp")
async def test_smtp(req: SmtpTestRequest, admin: dict = Depends(require_admin)):
    """Test SMTP connection and send a test email with enhanced error handling"""
    
    def get_provider_hint(server: str, port: int) -> str:
        """Get helpful hints for common SMTP providers"""
        server_lower = server.lower()
        if "gmail" in server_lower or "google" in server_lower:
            return "Gmail: Use smtp.gmail.com:587 with your full email and an App Password (not your regular password)"
        elif "outlook" in server_lower or "hotmail" in server_lower or "live" in server_lower:
            return "Outlook/Hotmail: Use smtp.office365.com:587 with your full email"
        elif "yahoo" in server_lower:
            return "Yahoo: Use smtp.mail.yahoo.com:587 with App Password enabled"
        elif "sendgrid" in server_lower:
            return "SendGrid: Use smtp.sendgrid.net:587 with API key as password"
        elif port == 465:
            return "Port 465 requires SSL - try port 587 with STARTTLS instead"
        elif port == 25:
            return "Port 25 is often blocked by ISPs - try port 587 or 465"
        return ""
    
    try:
        # Try standard SMTP first
        server = smtplib.SMTP(req.smtp_server, req.smtp_port, timeout=15)
        server.ehlo()
        
        # Check if STARTTLS is available
        if server.has_extn('starttls'):
            server.starttls()
            server.ehlo()
        elif req.smtp_port == 465:
            # For port 465, try SMTP_SSL
            server.quit()
            server = smtplib.SMTP_SSL(req.smtp_server, req.smtp_port, timeout=15)
            server.ehlo()

        if req.smtp_user and req.smtp_password:
            server.login(req.smtp_user, req.smtp_password)

        from_email = req.smtp_from_email or settings.SMTP_FROM_EMAIL
        msg = MIMEText(
            "<h2>SMTP Test Successful</h2><p>Your SMTP configuration is working correctly.</p>"
            "<p style='color:#888;font-size:12px;'>Sent from MST AI Portal Admin</p>",
            "html",
        )
        msg["Subject"] = "MST AI Portal — SMTP Test"
        msg["From"] = from_email
        msg["To"] = req.test_recipient

        server.sendmail(from_email, req.test_recipient, msg.as_string())
        server.quit()

        return {"success": True, "message": f"Test email sent to {req.test_recipient}"}
        
    except smtplib.SMTPAuthenticationError as e:
        hint = get_provider_hint(req.smtp_server, req.smtp_port)
        return {"success": False, "message": f"Authentication failed. {hint}"}
    except smtplib.SMTPConnectError as e:
        hint = get_provider_hint(req.smtp_server, req.smtp_port)
        return {"success": False, "message": f"Cannot connect to {req.smtp_server}:{req.smtp_port}. {hint}"}
    except smtplib.SMTPServerDisconnected:
        hint = get_provider_hint(req.smtp_server, req.smtp_port)
        return {"success": False, "message": f"Connection closed unexpectedly. Try different port (587/465/25). {hint}"}
    except smtplib.SMTPRecipientsRefused:
        return {"success": False, "message": f"Recipient refused: {req.test_recipient}"}
    except TimeoutError:
        return {"success": False, "message": f"Connection timeout to {req.smtp_server}:{req.smtp_port}. Check server/firewall"}
    except Exception as e:
        error_str = str(e).lower()
        if "timeout" in error_str:
            return {"success": False, "message": f"Connection timeout. Check server address and network"}
        elif "ssl" in error_str or "tls" in error_str:
            return {"success": False, "message": f"SSL/TLS error. Try port 587 with STARTTLS or port 465 with SSL"}
        else:
            return {"success": False, "message": f"SMTP error: {type(e).__name__}: {str(e) or '(no detail)'}"}


class SmtpProbeRequest(BaseModel):
    smtp_server: str
    smtp_port: int


@router.post("/probe-smtp")
async def probe_smtp(req: SmtpProbeRequest, admin: dict = Depends(require_admin)):
    """Step-by-step SMTP connectivity probe — TCP → banner → EHLO/STARTTLS.
    Does NOT authenticate or send mail. Use this to diagnose connectivity
    before troubleshooting credentials."""
    steps: list[dict] = []

    # ── Step 1: DNS resolution ─────────────────────────────────────────────
    try:
        ip = socket.gethostbyname(req.smtp_server)
        steps.append({"step": "DNS", "ok": True, "detail": f"{req.smtp_server} → {ip}"})
    except socket.gaierror as e:
        steps.append({"step": "DNS", "ok": False, "detail": f"Cannot resolve hostname: {e}"})
        return {"steps": steps, "reachable": False}

    # ── Step 2: TCP connect ────────────────────────────────────────────────
    try:
        sock = socket.create_connection((req.smtp_server, req.smtp_port), timeout=10)
        sock.close()
        steps.append({"step": "TCP connect", "ok": True,
                      "detail": f"Port {req.smtp_port} open"})
    except (ConnectionRefusedError, socket.timeout, OSError) as e:
        hint = ""
        if req.smtp_port == 25:
            hint = " — Port 25 is blocked inside most Docker/cloud environments to prevent spam. Use port 587 (STARTTLS) or 465 (SSL) instead."
        steps.append({"step": "TCP connect", "ok": False,
                      "detail": f"Port {req.smtp_port} unreachable: {e}{hint}"})
        return {"steps": steps, "reachable": False, "hint": hint.strip(" — ") if hint else None}

    # ── Step 3: SMTP banner + EHLO ─────────────────────────────────────────
    banner = ""
    extensions: list[str] = []
    try:
        if req.smtp_port == 465:
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            server = smtplib.SMTP_SSL(req.smtp_server, req.smtp_port, timeout=10, context=ctx)
        else:
            server = smtplib.SMTP(req.smtp_server, req.smtp_port, timeout=10)
        banner = server.getwelcome().decode(errors="replace")
        steps.append({"step": "SMTP banner", "ok": True, "detail": banner})
    except Exception as e:
        steps.append({"step": "SMTP banner", "ok": False,
                      "detail": f"{type(e).__name__}: {e}"})
        return {"steps": steps, "reachable": False}

    # ── Step 4: EHLO ──────────────────────────────────────────────────────
    try:
        code, resp = server.ehlo()
        extensions = resp.decode(errors="replace").splitlines()
        steps.append({"step": "EHLO", "ok": code == 250,
                      "detail": f"Code {code} — extensions: {', '.join(e.split()[0] for e in extensions if e.strip())}"})
    except Exception as e:
        steps.append({"step": "EHLO", "ok": False, "detail": str(e)})

    # ── Step 5: STARTTLS availability ──────────────────────────────────────
    if req.smtp_port != 465:
        has_tls = server.has_extn("starttls")
        steps.append({"step": "STARTTLS", "ok": has_tls,
                      "detail": "Supported" if has_tls else "Not advertised — plain SMTP or check port"})
        if has_tls:
            try:
                server.starttls()
                server.ehlo()
                steps.append({"step": "TLS handshake", "ok": True, "detail": "TLS negotiated successfully"})
            except Exception as e:
                steps.append({"step": "TLS handshake", "ok": False,
                              "detail": f"{type(e).__name__}: {e}"})

    # ── Step 6: AUTH methods ───────────────────────────────────────────────
    try:
        auth_exts = [e for e in (server.esmtp_features or {}) if "auth" in e.lower()]
        auth_methods = []
        for a in auth_exts:
            auth_methods += a.split()[1:]
        if auth_methods:
            steps.append({"step": "AUTH methods", "ok": True,
                          "detail": f"Supported: {', '.join(auth_methods)}"})
        else:
            steps.append({"step": "AUTH methods", "ok": True, "detail": "None advertised (may be ok for internal relay)"})
    except Exception:
        pass

    try:
        server.quit()
    except Exception:
        pass

    all_ok = all(s["ok"] for s in steps)
    return {"steps": steps, "reachable": all_ok}


# ── Announcement CRUD ────────────────────────────────────────────────────────

class AnnouncementCreate(BaseModel):
    title: str
    content: Optional[str] = None
    badge: Optional[str] = None
    is_active: bool = True


class AnnouncementUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    badge: Optional[str] = None
    is_active: Optional[bool] = None


class AnnouncementResponse(BaseModel):
    id: str
    title: str
    content: Optional[str] = None
    badge: Optional[str] = None
    is_active: bool
    created_at: datetime


@router.get("/announcements", response_model=list[AnnouncementResponse])
async def list_announcements(admin: dict = Depends(require_admin)):
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM announcements ORDER BY created_at DESC"
    )
    return [AnnouncementResponse(
        id=str(r["id"]), title=r["title"], content=r.get("content"),
        badge=r.get("badge"), is_active=r["is_active"], created_at=r["created_at"],
    ) for r in rows]


@router.post("/announcements", response_model=AnnouncementResponse)
async def create_announcement(req: AnnouncementCreate, admin: dict = Depends(require_admin)):
    db = await get_db()
    row = await db.fetchrow(
        "INSERT INTO announcements (title, content, badge, is_active) VALUES ($1, $2, $3, $4) RETURNING *",
        req.title, req.content, req.badge, req.is_active,
    )
    return AnnouncementResponse(
        id=str(row["id"]), title=row["title"], content=row.get("content"),
        badge=row.get("badge"), is_active=row["is_active"], created_at=row["created_at"],
    )


@router.put("/announcements/{announcement_id}", response_model=AnnouncementResponse)
async def update_announcement(
    announcement_id: str, req: AnnouncementUpdate, admin: dict = Depends(require_admin)
):
    db = await get_db()
    row = await db.fetchrow("SELECT * FROM announcements WHERE id = $1", announcement_id)
    if not row:
        raise HTTPException(status_code=404, detail="Announcement not found")

    updates = {k: v for k, v in req.dict(exclude_none=True).items()}
    if updates:
        set_clauses = [f"{k} = ${i+1}" for i, k in enumerate(updates)]
        values = list(updates.values()) + [announcement_id]
        await db.execute(
            f"UPDATE announcements SET {', '.join(set_clauses)} WHERE id = ${len(values)}",
            *values,
        )

    row = await db.fetchrow("SELECT * FROM announcements WHERE id = $1", announcement_id)
    return AnnouncementResponse(
        id=str(row["id"]), title=row["title"], content=row.get("content"),
        badge=row.get("badge"), is_active=row["is_active"], created_at=row["created_at"],
    )


class OllamaTestRequest(BaseModel):
    base_url: str


@router.post("/test-ollama")
async def test_ollama(req: OllamaTestRequest, admin: dict = Depends(require_admin)):
    """Test connectivity to an Ollama instance and return available models."""
    url = req.base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{url}/api/tags")
        if resp.status_code == 200:
            data = resp.json()
            models = [m.get("name", "") for m in data.get("models", [])]
            return {"ok": True, "models": models}
        return {"ok": False, "error": f"Ollama returned HTTP {resp.status_code}"}
    except httpx.ConnectError:
        return {"ok": False, "error": f"Cannot connect to {url}"}
    except httpx.TimeoutException:
        return {"ok": False, "error": f"Connection timed out — is Ollama running at {url}?"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


# ── In-house OpenAI-compatible LLM ────────────────────────────────────────────

class InhouseLLMQueryRequest(BaseModel):
    base_url: str
    api_key: str | None = None


def _normalize_model_list(data) -> list[dict]:
    """Normalize a /models response into [{id, title, model, provider}].

    Handles both the in-house shape ({"data":[{id,title,model,provider}]}) and the
    standard OpenAI shape ({"data":[{id, ...}]})."""
    items = data.get("data") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    out = []
    for m in items:
        if not isinstance(m, dict):
            continue
        mid = m.get("id") or m.get("model")
        if not mid:
            continue
        out.append({
            "id": mid,
            "title": m.get("title") or mid,
            "model": m.get("model") or mid,
            "provider": m.get("provider") or "",
        })
    return out


async def _resolve_inhouse_token(db, supplied: str | None) -> str | None:
    """Use the supplied token, or fall back to the saved one when the admin left it blank
    (the GET endpoint masks it, so the UI may not have the real value)."""
    if supplied:
        return supplied
    row = await db.fetchrow("SELECT value FROM app_settings WHERE key = 'inhouse_llm_config'")
    if row:
        try:
            return json.loads(row["value"]).get("api_key") or None
        except Exception:
            return None
    return None


@router.post("/llm/query-models")
async def query_inhouse_models(req: InhouseLLMQueryRequest, admin: dict = Depends(require_admin)):
    """Query an OpenAI-compatible endpoint for its available models (GET {base_url}/models)."""
    db = await get_db()
    url = req.base_url.strip().rstrip("/")
    if not url:
        return {"ok": False, "error": "Base URL is required"}
    token = await _resolve_inhouse_token(db, req.api_key)
    headers = {"Accept": "application/json", **INHOUSE_LLM_HEADERS}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    target = f"{url}/models"
    log.info("Inhouse LLM query-models: GET {} (token={})", target, "yes" if token else "none")
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(target, headers=headers)
        body_snippet = (resp.text or "")[:500]
        log.info(
            "Inhouse LLM query-models response: status={} content-type={} body={!r}",
            resp.status_code, resp.headers.get("content-type", ""), body_snippet,
        )
        if resp.status_code == 200:
            return {"ok": True, "models": _normalize_model_list(resp.json())}
        if resp.status_code in (401, 403):
            return {"ok": False, "error": "Authentication failed — check the token."}
        if resp.status_code == 404:
            log.warning(
                "Inhouse LLM query-models 404 at {}. The gateway likely expects a versioned "
                "path — try adding '/v1' to the Base URL (e.g. {}/v1).", target, url,
            )
            return {
                "ok": False,
                "error": (
                    f"Endpoint returned HTTP 404 at {target}. "
                    f"The gateway may expect a '/v1' prefix — try Base URL '{url}/v1'."
                    + (f" Response: {body_snippet}" if body_snippet else "")
                ),
            }
        return {
            "ok": False,
            "error": f"Endpoint returned HTTP {resp.status_code}"
                     + (f": {body_snippet}" if body_snippet else ""),
        }
    except httpx.ConnectError as e:
        log.warning("Inhouse LLM query-models connect error to {}: {}", target, e)
        return {"ok": False, "error": f"Cannot connect to {url}"}
    except httpx.TimeoutException:
        log.warning("Inhouse LLM query-models timeout to {}", target)
        return {"ok": False, "error": f"Connection to {url} timed out"}
    except Exception as e:
        log.exception("Inhouse LLM query-models unexpected error to {}", target)
        return {"ok": False, "error": str(e)[:200]}


class InhouseLLMTestRequest(BaseModel):
    base_url: str
    api_key: str | None = None
    model: str


@router.post("/llm/test-chat")
async def test_inhouse_chat(req: InhouseLLMTestRequest, admin: dict = Depends(require_admin)):
    """Send a tiny chat completion to verify the endpoint + token + model actually work."""
    db = await get_db()
    url = req.base_url.strip().rstrip("/")
    if not url:
        return {"ok": False, "error": "Base URL is required"}
    if not req.model:
        return {"ok": False, "error": "Select a model first"}
    token = await _resolve_inhouse_token(db, req.api_key)
    headers = {"Content-Type": "application/json", **INHOUSE_LLM_HEADERS}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = {
        "model": req.model,
        "messages": [{"role": "user", "content": "Reply with the single word: ok"}],
        "temperature": 0,
        "max_tokens": 16,
        "stream": False,
    }
    target = f"{url}/chat/completions"
    log.info(
        "Inhouse LLM test-chat: POST {} model={} (token={})",
        target, req.model, "yes" if token else "none",
    )
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(target, headers=headers, json=body)
        body_snippet = (resp.text or "")[:500]
        log.info(
            "Inhouse LLM test-chat response: status={} content-type={} body={!r}",
            resp.status_code, resp.headers.get("content-type", ""), body_snippet,
        )
        if resp.status_code == 200:
            try:
                reply = resp.json()["choices"][0]["message"]["content"]
            except Exception:
                reply = ""
            return {"ok": True, "reply": (reply or "").strip()[:200]}
        if resp.status_code in (401, 403):
            return {"ok": False, "error": "Authentication failed — check the token."}
        if resp.status_code == 404:
            log.warning(
                "Inhouse LLM test-chat 404 at {}. The gateway likely expects a '/v1' prefix "
                "(e.g. {}/v1).", target, url,
            )
            return {
                "ok": False,
                "error": (
                    f"Endpoint returned HTTP 404 at {target}. "
                    f"Try Base URL '{url}/v1'."
                    + (f" Response: {body_snippet}" if body_snippet else "")
                ),
            }
        return {"ok": False, "error": f"Endpoint returned HTTP {resp.status_code}: {body_snippet[:150]}"}
    except httpx.ConnectError as e:
        log.warning("Inhouse LLM test-chat connect error to {}: {}", target, e)
        return {"ok": False, "error": f"Cannot connect to {url}"}
    except httpx.TimeoutException:
        log.warning("Inhouse LLM test-chat timeout to {}", target)
        return {"ok": False, "error": f"Request to {url} timed out"}
    except Exception as e:
        log.exception("Inhouse LLM test-chat unexpected error to {}", target)
        return {"ok": False, "error": str(e)[:200]}


@router.delete("/announcements/{announcement_id}")
async def delete_announcement(announcement_id: str, admin: dict = Depends(require_admin)):
    db = await get_db()
    result = await db.execute("DELETE FROM announcements WHERE id = $1", announcement_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Announcement not found")
    return {"message": "Announcement deleted"}
