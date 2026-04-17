from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import smtplib
import asyncpg

from auth.dependencies import require_admin
from email_utils.digest import generate_learning_digest
from email_utils.utils import send_email
from config import settings
from database import get_db, get_read_db

router = APIRouter()


class DigestPreviewRequest(BaseModel):
    days: int = 7
    custom_content: str = ""


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
    pool = await get_read_db()
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
    pool = await get_read_db()
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
        preview = await generate_learning_digest(req.days, req.custom_content or None, issue_number=issue_number)

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

        # Send emails
        sent_count = 0
        failed = []

        for recipient in req.recipient_emails:
            success = await send_email(
                to_email=recipient,
                subject=req.subject,
                html_content=req.html_content,
            )
            if success:
                sent_count += 1
            else:
                failed.append(recipient)

        # Update recipient count
        pool = await get_db()
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE digest_issues SET sent_at = NOW(), recipient_count = $1 WHERE issue_number = $2",
                sent_count, issue_number
            )

        if sent_count == len(req.recipient_emails):
            return SendDigestResponse(
                success=True,
                message=f"Successfully sent Issue #{issue_number} to all {sent_count} recipients",
                sent_count=sent_count,
            )
        else:
            return SendDigestResponse(
                success=False,
                message=f"Sent Issue #{issue_number} to {sent_count}/{len(req.recipient_emails)} recipients. Failed: {', '.join(failed)}",
                sent_count=sent_count,
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
            return {"success": False, "message": f"SMTP error: {str(e)}"}
