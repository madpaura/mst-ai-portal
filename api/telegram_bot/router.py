"""
FastAPI routes for the Telegram Admin Bot.

Endpoints:
  POST /admin/telegram/webhook    — Telegram webhook receiver (no auth, secret token)
  POST /admin/telegram/setup      — Register webhook URL with Telegram (admin only)
  GET  /admin/telegram/status     — Check webhook info (admin only)
  DELETE /admin/telegram/webhook  — Remove webhook (admin only)
"""
from __future__ import annotations

from fastapi import APIRouter, Request, HTTPException, Depends, Query
import httpx
from loguru import logger as log

from auth.dependencies import require_admin
from config import settings
from .handlers import handle_update, send_message

router = APIRouter(tags=["telegram-bot"])


def _token() -> str:
    if not settings.TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=503, detail="TELEGRAM_BOT_TOKEN not configured")
    return settings.TELEGRAM_BOT_TOKEN


def _admin_ids() -> set[int]:
    raw = settings.TELEGRAM_ADMIN_USER_IDS
    if not raw:
        return set()
    ids = set()
    for part in raw.split(","):
        part = part.strip()
        if part.isdigit():
            ids.add(int(part))
    return ids


@router.post("/admin/telegram/webhook")
async def telegram_webhook(request: Request):
    """Receive updates from Telegram. Secured by X-Telegram-Bot-Api-Secret-Token header."""
    secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if settings.TELEGRAM_WEBHOOK_SECRET and secret != settings.TELEGRAM_WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Invalid webhook secret")

    try:
        update = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    token = _token()
    admin_ids = _admin_ids()

    # Handle async without blocking Telegram's retry
    import asyncio
    asyncio.create_task(handle_update(update, token, admin_ids))

    return {"ok": True}


@router.post("/admin/telegram/setup")
async def setup_telegram_webhook(
    base_url: str = Query(..., description="Public HTTPS URL of this server, e.g. https://portal.example.com"),
    admin: dict = Depends(require_admin),
):
    """Register this server as the Telegram bot webhook."""
    token = _token()
    webhook_url = f"{base_url.rstrip('/')}/admin/telegram/webhook"

    payload: dict = {"url": webhook_url, "allowed_updates": ["message", "edited_message"]}
    if settings.TELEGRAM_WEBHOOK_SECRET:
        payload["secret_token"] = settings.TELEGRAM_WEBHOOK_SECRET

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{token}/setWebhook",
            json=payload,
        )

    data = resp.json()
    if not data.get("ok"):
        raise HTTPException(status_code=502, detail=f"Telegram error: {data.get('description')}")

    log.info(f"Telegram webhook registered: {webhook_url}")
    return {"ok": True, "webhook_url": webhook_url, "telegram_response": data}


@router.get("/admin/telegram/status")
async def telegram_webhook_status(admin: dict = Depends(require_admin)):
    """Get current Telegram webhook info."""
    token = _token()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"https://api.telegram.org/bot{token}/getWebhookInfo")
    return resp.json()


@router.delete("/admin/telegram/webhook")
async def delete_telegram_webhook(admin: dict = Depends(require_admin)):
    """Remove the Telegram webhook (switch to polling mode)."""
    token = _token()
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(f"https://api.telegram.org/bot{token}/deleteWebhook")
    return resp.json()


@router.post("/admin/telegram/test")
async def test_telegram_message(
    chat_id: int = Query(..., description="Telegram chat ID to send test message to"),
    admin: dict = Depends(require_admin),
):
    """Send a test message to verify the bot is working."""
    token = _token()
    await send_message(token, chat_id, "✅ MST AI Portal bot is connected and working!")
    return {"ok": True, "sent_to": chat_id}
