from fastapi import APIRouter, HTTPException, Depends
from auth.dependencies import get_current_user
from database import get_db
from contacts.schemas import ContactEntryResponse, ContactMessageRequest
from email_utils.utils import send_email_multi

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

    to_emails = [r["email"] for r in rows]
    names = ", ".join(r["name"] for r in rows)

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
      <p style="margin:0 0 20px;font-size:14px;color:#475569;">Hi {names},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#475569;">
        You have received a new message via the MST AI Portal contact page.
      </p>
      <div style="background:#f1f5f9;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
        <table style="width:100%;font-size:13px;color:#64748b;border-collapse:collapse;">
          <tr><td style="padding:4px 0;font-weight:600;width:100px;">From:</td><td style="color:#0f172a;">{req.sender_name}</td></tr>
          <tr><td style="padding:4px 0;font-weight:600;">Email:</td><td style="color:#0f172a;">{req.sender_email}</td></tr>
          <tr><td style="padding:4px 0;font-weight:600;">Subject:</td><td style="color:#0f172a;">{req.subject}</td></tr>
        </table>
      </div>
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#94a3b8;">Message</p>
        <p style="margin:0;font-size:14px;color:#1e293b;white-space:pre-wrap;line-height:1.6;">{req.message}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#94a3b8;">
        Reply directly to <a href="mailto:{req.sender_email}" style="color:#3b82f6;">{req.sender_email}</a> to respond.
      </p>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:11px;color:#94a3b8;">Sent via MST AI Portal · You were contacted as a listed division contact.</p>
    </div>
  </div>
</body>
</html>
"""

    plain = f"Message from {req.sender_name} ({req.sender_email}):\n\nSubject: {req.subject}\n\n{req.message}"

    ok = await send_email_multi(
        subject=f"[Portal Contact] {req.subject}",
        html_content=html_body,
        plain_text=plain,
        to_emails=to_emails,
        cc_emails=[req.sender_email],
    )

    if not ok:
        raise HTTPException(status_code=500, detail="Failed to send email — check SMTP settings")

    return {"sent": len(to_emails), "failed": 0, "total": len(to_emails)}
