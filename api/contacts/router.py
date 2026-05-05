from fastapi import APIRouter, HTTPException, Depends
from auth.dependencies import get_current_user
from database import get_db
from contacts.schemas import ContactEntryResponse, ContactMessageRequest
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import json
from config import settings
from loguru import logger as log

router = APIRouter()


def _row_to_entry(r) -> ContactEntryResponse:
    return ContactEntryResponse(
        id=str(r["id"]),
        division=r["division"],
        name=r["name"],
        title=r.get("title") or "",
        email=r["email"],
        is_active=r["is_active"],
        sort_order=r["sort_order"],
        created_at=r["created_at"],
    )


@router.get("", response_model=list[ContactEntryResponse])
async def list_contacts(user: dict = Depends(get_current_user)):
    db = await get_db()
    rows = await db.fetch(
        "SELECT * FROM contact_entries WHERE is_active = true ORDER BY sort_order, division, name"
    )
    return [_row_to_entry(r) for r in rows]


async def _send_contact_email(
    to_email: str,
    to_name: str,
    sender_name: str,
    sender_email: str,
    subject: str,
    message: str,
) -> bool:
    try:
        db = await get_db()
        smtp_config = await db.fetchrow("SELECT value FROM app_settings WHERE key = 'smtp_config'")
        if smtp_config:
            cfg = json.loads(smtp_config["value"])
            smtp_server = cfg.get("smtp_server", settings.SMTP_SERVER)
            smtp_port = int(cfg.get("smtp_port", settings.SMTP_PORT))
            smtp_user = cfg.get("smtp_user", settings.SMTP_USER)
            smtp_password = cfg.get("smtp_password", settings.SMTP_PASSWORD)
            smtp_from_email = cfg.get("smtp_from_email", settings.SMTP_FROM_EMAIL)
            smtp_from_name = cfg.get("smtp_from_name", settings.SMTP_FROM_NAME)
        else:
            smtp_server = settings.SMTP_SERVER
            smtp_port = settings.SMTP_PORT
            smtp_user = settings.SMTP_USER
            smtp_password = settings.SMTP_PASSWORD
            smtp_from_email = settings.SMTP_FROM_EMAIL
            smtp_from_name = settings.SMTP_FROM_NAME

        html_body = f"""
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Inter,-apple-system,sans-serif;background:#f8fafc;margin:0;padding:32px 0;">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:28px 32px;">
      <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#60a5fa;">MST AI Portal</p>
      <h1 style="margin:8px 0 0;font-size:20px;font-weight:800;color:#f1f5f9;letter-spacing:-0.5px;">New Message from Portal</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;font-size:14px;color:#475569;">Hi {to_name},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#475569;">
        You have received a new message via the MST AI Portal contact page.
      </p>
      <div style="background:#f1f5f9;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
        <table style="width:100%;font-size:13px;color:#64748b;border-collapse:collapse;">
          <tr><td style="padding:4px 0;font-weight:600;width:100px;">From:</td><td style="color:#0f172a;">{sender_name}</td></tr>
          <tr><td style="padding:4px 0;font-weight:600;">Email:</td><td style="color:#0f172a;">{sender_email}</td></tr>
          <tr><td style="padding:4px 0;font-weight:600;">Subject:</td><td style="color:#0f172a;">{subject}</td></tr>
        </table>
      </div>
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;">Message</p>
        <p style="margin:0;font-size:14px;color:#1e293b;white-space:pre-wrap;line-height:1.6;">{message}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#94a3b8;">
        Reply directly to <a href="mailto:{sender_email}" style="color:#3b82f6;">{sender_email}</a> to respond.
      </p>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:11px;color:#94a3b8;">Sent via MST AI Portal · You were contacted as a listed division contact.</p>
    </div>
  </div>
</body>
</html>
"""

        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[Portal Contact] {subject}"
        msg["From"] = f"{smtp_from_name} <{smtp_from_email}>"
        msg["To"] = to_email
        msg["CC"] = sender_email
        msg["Reply-To"] = sender_email

        msg.attach(MIMEText(f"Message from {sender_name} ({sender_email}):\n\nSubject: {subject}\n\n{message}", "plain"))
        msg.attach(MIMEText(html_body, "html"))

        all_recipients = [to_email, sender_email]

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

        server.sendmail(smtp_from_email, all_recipients, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        log.error(f"Contact email failed to {to_email}: {e}")
        return False


@router.post("/send")
async def send_contact_message(
    req: ContactMessageRequest,
    user: dict = Depends(get_current_user),
):
    if not req.contact_ids:
        raise HTTPException(status_code=400, detail="Select at least one contact")

    db = await get_db()
    placeholders = ",".join(f"${i+1}" for i in range(len(req.contact_ids)))
    rows = await db.fetch(
        f"SELECT id, name, email FROM contact_entries WHERE id::text IN ({placeholders}) AND is_active = true",
        *req.contact_ids,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No valid contacts found")

    sent, failed = 0, 0
    for row in rows:
        ok = await _send_contact_email(
            to_email=row["email"],
            to_name=row["name"],
            sender_name=req.sender_name,
            sender_email=req.sender_email,
            subject=req.subject,
            message=req.message,
        )
        if ok:
            sent += 1
        else:
            failed += 1

    if sent == 0:
        raise HTTPException(status_code=500, detail="Failed to send any emails — check SMTP settings")

    return {"sent": sent, "failed": failed, "total": len(rows)}
