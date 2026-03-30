from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import smtplib

from auth.dependencies import require_admin
from email_utils.digest import generate_learning_digest
from email_utils.utils import send_email
from config import settings

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


class SendDigestResponse(BaseModel):
    success: bool
    message: str
    sent_count: int


@router.post("/digest-preview", response_model=DigestPreviewResponse)
async def digest_preview(req: DigestPreviewRequest, admin: dict = Depends(require_admin)):
    """Generate a preview of the learning digest email"""
    try:
        preview = await generate_learning_digest(req.days, req.custom_content or None)
        return DigestPreviewResponse(**preview)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate digest: {str(e)}")


@router.post("/send-digest", response_model=SendDigestResponse)
async def send_digest(req: SendDigestRequest, admin: dict = Depends(require_admin)):
    """Send learning digest to multiple recipients"""
    try:
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

        if sent_count == len(req.recipient_emails):
            return SendDigestResponse(
                success=True,
                message=f"Successfully sent digest to all {sent_count} recipients",
                sent_count=sent_count,
            )
        else:
            return SendDigestResponse(
                success=False,
                message=f"Sent to {sent_count}/{len(req.recipient_emails)} recipients. Failed: {', '.join(failed)}",
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
