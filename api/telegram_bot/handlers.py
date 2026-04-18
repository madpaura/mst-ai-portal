"""
Telegram Admin Bot — command handlers and NL query engine.

Supported commands:
  /help                     — list commands
  /status                   — system health snapshot
  /stats                    — portal statistics
  /report                   — weekly summary (LLM-written)
  /backup                   — trigger backup.sh
  /logs [n]                 — last N error lines, LLM-summarised
  /announce <title> | <msg> — post site-wide announcement
  /user info <email>        — user details
  /user disable <email>     — disable user (requires CONFIRM)
  /user enable  <email>     — re-enable user  (requires CONFIRM)
  <anything else>           — NL query answered with live DB context
"""
from __future__ import annotations

import asyncio
import time
from typing import Optional

import httpx
from loguru import logger as log

from articles.llm import call_llm
from database import get_read_db, get_write_db
from .queries import (
    get_portal_stats, get_recent_errors, get_storage_usage,
    disable_user, enable_user, get_user_info, create_announcement,
)

# ── In-memory pending confirmations {chat_id: {action, payload, expires_at}} ──
_pending: dict[int, dict] = {}
_CONFIRM_TTL = 120  # seconds


# ── Telegram API helper ────────────────────────────────────────────────────────

async def send_message(bot_token: str, chat_id: int, text: str, parse_mode: str = "HTML") -> None:
    """Send a message via the Telegram Bot API."""
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload)
            if resp.status_code != 200:
                log.warning(f"Telegram send failed {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        log.error(f"Telegram send_message error: {e}")


# ── Entry point ───────────────────────────────────────────────────────────────

async def handle_update(update: dict, bot_token: str, admin_ids: set[int]) -> None:
    """Process a single Telegram update."""
    message = update.get("message") or update.get("edited_message")
    if not message:
        return

    chat_id: int = message["chat"]["id"]
    from_id: int = message.get("from", {}).get("id", 0)
    text: str = (message.get("text") or "").strip()

    if not text:
        return

    # Security: only allowlisted admin user IDs
    if admin_ids and from_id not in admin_ids:
        await send_message(bot_token, chat_id, "⛔ Unauthorized. Contact your portal admin.")
        return

    reply = await _dispatch(chat_id, from_id, text, bot_token)
    if reply:
        await send_message(bot_token, chat_id, reply)


# ── Dispatcher ────────────────────────────────────────────────────────────────

async def _dispatch(chat_id: int, from_id: int, text: str, bot_token: str) -> str:
    # Handle pending confirmation flow
    pending = _pending.get(chat_id)
    if pending and time.time() < pending["expires_at"]:
        if text.upper() == "CONFIRM":
            del _pending[chat_id]
            return await _execute_confirmed(pending)
        elif text.upper() in ("CANCEL", "NO"):
            del _pending[chat_id]
            return "❌ Action cancelled."
        # Fall through to process as new command (confirmation replaced)
    if chat_id in _pending:
        del _pending[chat_id]

    cmd = text.lower().split()[0] if text else ""

    if cmd in ("/help", "/start"):
        return _cmd_help()
    elif cmd == "/status":
        return await _cmd_status()
    elif cmd == "/stats":
        return await _cmd_stats()
    elif cmd == "/report":
        return await _cmd_report()
    elif cmd == "/backup":
        return await _cmd_backup()
    elif cmd.startswith("/logs"):
        parts = text.split()
        n = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 20
        return await _cmd_logs(n)
    elif cmd == "/announce":
        return await _cmd_announce(chat_id, text)
    elif cmd == "/user":
        return await _cmd_user(chat_id, text)
    else:
        return await _cmd_nl(text)


# ── Command handlers ──────────────────────────────────────────────────────────

def _cmd_help() -> str:
    return (
        "🤖 <b>MST AI Portal Admin Bot</b>\n\n"
        "<b>Commands:</b>\n"
        "/status — system health snapshot\n"
        "/stats — portal statistics\n"
        "/report — weekly LLM-generated report\n"
        "/backup — trigger a backup now\n"
        "/logs [n] — last N error lines (default 20)\n"
        "/announce &lt;title&gt; | &lt;message&gt; — post announcement\n"
        "/user info &lt;email&gt; — user details\n"
        "/user disable &lt;email&gt; — disable account\n"
        "/user enable &lt;email&gt; — re-enable account\n\n"
        "Or just ask a question in natural language:\n"
        "<i>How many users signed up this week?</i>"
    )


async def _cmd_status() -> str:
    lines = ["🔍 <b>Portal Status</b>\n"]

    # Backend reachable (we're running, so it's up)
    lines.append("✅ Backend: running")

    # DB check
    try:
        db = await get_read_db()
        await db.fetchval("SELECT 1")
        lines.append("✅ Database: connected")
    except Exception as e:
        lines.append(f"❌ Database: {e}")

    # Storage check
    try:
        storage = await get_storage_usage()
        for name, info in storage.items():
            if "error" in info:
                lines.append(f"⚠️ Storage/{name}: {info['error']}")
            else:
                mb = round(info["files_bytes"] / 1024**2, 1)
                lines.append(f"💾 Storage/{name}: {mb} MB used, {info['disk_free_gb']} GB free")
    except Exception as e:
        lines.append(f"⚠️ Storage check failed: {e}")

    # Quick user/content count
    try:
        db = await get_read_db()
        users = await db.fetchval("SELECT COUNT(*) FROM users")
        videos = await db.fetchval("SELECT COUNT(*) FROM videos")
        lines.append(f"👥 Users: {users}  |  🎬 Videos: {videos}")
    except Exception:
        pass

    return "\n".join(lines)


async def _cmd_stats() -> str:
    try:
        db = await get_read_db()
        s = await get_portal_stats(db)
        u = s.get("users", {})
        c = s.get("content", {})
        e = s.get("enrollments", {})
        pv = s.get("page_views", {})

        lines = [
            "📊 <b>Portal Statistics</b>\n",
            f"👥 Users: {u.get('total', '?')} total  "
            f"({u.get('new_week', '?')} new this week, "
            f"{u.get('new_month', '?')} this month)",
            f"🟢 Active (7d): {s.get('active_users_7d', '?')}",
            f"🎬 Videos: {c.get('videos', '?')}  "
            f"📚 Courses: {c.get('courses', '?')}  "
            f"📝 Articles: {c.get('articles', '?')}",
            f"🎓 Enrollments: {e.get('total', '?')} total "
            f"({e.get('new_week', '?')} this week)",
            f"👁 Page views: {pv.get('today', '?')} today / {pv.get('week', '?')} this week",
            f"🗄 DB size: {s.get('db_size', '?')}",
        ]

        if s.get("pending_contribute_requests", 0):
            lines.append(f"⏳ Pending content-creator requests: {s['pending_contribute_requests']}")

        if s.get("popular_videos_week"):
            lines.append("\n🔥 <b>Top videos this week:</b>")
            for i, v in enumerate(s["popular_videos_week"], 1):
                lines.append(f"  {i}. {v['title']} ({v['views']} views)")

        return "\n".join(lines)
    except Exception as e:
        log.error(f"Telegram /stats error: {e}")
        return f"❌ Failed to fetch stats: {e}"


async def _cmd_report() -> str:
    try:
        db = await get_read_db()
        s = await get_portal_stats(db)
        storage = await get_storage_usage()

        context = f"""
Portal weekly snapshot:
- Users: {s['users'].get('total')} total, {s['users'].get('new_week')} new this week
- Active users (7d): {s.get('active_users_7d')}
- Videos: {s['content'].get('videos')}, Courses: {s['content'].get('courses')}, Articles: {s['content'].get('articles')}
- Enrollments: {s['enrollments'].get('total')} total, {s['enrollments'].get('new_week')} new this week
- Video completions this week: {s['video_progress'].get('completions_week')}
- Page views: {s['page_views'].get('today')} today, {s['page_views'].get('week')} this week
- Marketplace components: {s['marketplace'].get('total_components')}
- DB size: {s['db_size']}
- Storage: videos={storage.get('videos', {}).get('files_bytes', 0) // 1024**2} MB, media={storage.get('media', {}).get('files_bytes', 0) // 1024**2} MB
- Pending content-creator requests: {s.get('pending_contribute_requests')}
- Top videos: {', '.join(v['title'] for v in s.get('popular_videos_week', [])[:3]) or 'none'}
"""
        prompt = (
            "You are an AI assistant generating a concise weekly operations report for an AI learning portal admin.\n"
            f"Here is the current data:\n{context}\n\n"
            "Write a friendly 150-200 word weekly report with:\n"
            "1. User growth highlights\n"
            "2. Content engagement summary\n"
            "3. Any issues or items needing attention\n"
            "4. One positive observation\n"
            "Keep it concise and actionable. No markdown headers, plain paragraphs."
        )
        report = await call_llm(prompt)
        return f"📋 <b>Weekly Report</b>\n\n{report}"
    except Exception as e:
        log.error(f"Telegram /report error: {e}")
        return f"❌ Failed to generate report: {e}"


async def _cmd_backup() -> str:
    try:
        from pathlib import Path
        script = Path(__file__).parent.parent.parent / "scripts" / "backup.sh"
        if not script.exists():
            return "❌ backup.sh not found"

        proc = await asyncio.create_subprocess_exec(
            "bash", str(script),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        except asyncio.TimeoutError:
            proc.kill()
            return "⏱ Backup timed out after 5 minutes. Check server logs."

        if proc.returncode == 0:
            # Find "Location:" line in output
            output = stdout.decode(errors="replace")
            location = next(
                (l.strip() for l in output.splitlines() if l.strip().startswith("Location:")),
                ""
            )
            return f"✅ Backup completed successfully.\n{location}"
        else:
            err = stderr.decode(errors="replace")[-300:]
            return f"⚠️ Backup completed with errors:\n<code>{err}</code>"
    except Exception as e:
        log.error(f"Telegram /backup error: {e}")
        return f"❌ Backup failed: {e}"


async def _cmd_logs(n: int) -> str:
    try:
        errors = await get_recent_errors(n)
        if not errors:
            return "✅ No recent errors found in logs."

        raw = "\n".join(errors[-30:])
        prompt = (
            f"You are analysing backend error logs for an AI learning portal.\n"
            f"Here are the {len(errors)} most recent error/warning entries:\n\n{raw}\n\n"
            "In 100-150 words, summarise:\n"
            "1. What are the main issues?\n"
            "2. Which appear most frequently?\n"
            "3. What immediate action (if any) is needed?\n"
            "Be concise and direct."
        )
        summary = await call_llm(prompt)
        return f"📋 <b>Log Summary</b> (last {n} entries)\n\n{summary}"
    except Exception as e:
        log.error(f"Telegram /logs error: {e}")
        return f"❌ Log analysis failed: {e}"


async def _cmd_announce(chat_id: int, text: str) -> str:
    """
    Usage: /announce My Title | My announcement message body
    """
    body = text[len("/announce"):].strip()
    if "|" not in body:
        return (
            "Usage: <code>/announce Title | Message body</code>\n"
            "Example: <code>/announce Maintenance | Portal will be down Saturday 2-4am</code>"
        )
    title, _, content = body.partition("|")
    title = title.strip()
    content = content.strip()
    if not title or not content:
        return "❌ Both title and message are required."

    # Require confirmation for announcements (visible to all users)
    _pending[chat_id] = {
        "action": "announce",
        "payload": {"title": title, "content": content},
        "expires_at": time.time() + _CONFIRM_TTL,
    }
    return (
        f"📢 <b>Confirm Announcement</b>\n\n"
        f"<b>Title:</b> {title}\n"
        f"<b>Message:</b> {content}\n\n"
        f"Type <b>CONFIRM</b> to post, or <b>CANCEL</b> to abort."
    )


async def _cmd_user(chat_id: int, text: str) -> str:
    """
    /user info <email>
    /user disable <email>
    /user enable <email>
    """
    parts = text.split()
    if len(parts) < 3:
        return "Usage: /user &lt;info|disable|enable&gt; &lt;email&gt;"

    action = parts[1].lower()
    email = parts[2].lower()

    if action == "info":
        try:
            db = await get_read_db()
            info = await get_user_info(db, email)
            if "error" in info:
                return f"❌ {info['error']}"
            status = "✅ active" if info.get("is_active") else "🚫 disabled"
            return (
                f"👤 <b>User Info</b>\n\n"
                f"Username: {info.get('username')}\n"
                f"Email: {info.get('email')}\n"
                f"Role: {info.get('role')}\n"
                f"Status: {status}\n"
                f"Auth: {info.get('auth_provider', 'local')}\n"
                f"Joined: {str(info.get('created_at', ''))[:10]}"
            )
        except Exception as e:
            return f"❌ Error: {e}"

    elif action in ("disable", "enable"):
        _pending[chat_id] = {
            "action": f"user_{action}",
            "payload": {"email": email},
            "expires_at": time.time() + _CONFIRM_TTL,
        }
        verb = "DISABLE" if action == "disable" else "RE-ENABLE"
        return (
            f"⚠️ <b>Confirm: {verb} user</b>\n\n"
            f"Email: {email}\n\n"
            f"Type <b>CONFIRM</b> to proceed, or <b>CANCEL</b> to abort."
        )

    return f"❌ Unknown user action: {action}. Use info, disable, or enable."


async def _cmd_nl(text: str) -> str:
    """Answer natural-language questions using live DB stats as context."""
    try:
        db = await get_read_db()
        s = await get_portal_stats(db)
        storage = await get_storage_usage()

        context = f"""
Current MST AI Portal data snapshot:

Users: {s['users'].get('total')} total, {s['users'].get('new_week')} new this week, {s['users'].get('new_month')} new this month
Active users last 7 days: {s.get('active_users_7d')}
Admins: {s['users'].get('admins')}, Content creators: {s['users'].get('content_creators')}, Disabled: {s['users'].get('disabled')}

Videos: {s['content'].get('videos')}
Courses: {s['content'].get('courses')}
Published articles: {s['content'].get('articles')}
Marketplace components: {s['marketplace'].get('total_components')}, {s['marketplace'].get('new_week')} added this week

Enrollments: {s['enrollments'].get('total')} total, {s['enrollments'].get('new_week')} new this week
Video completions this week: {s['video_progress'].get('completions_week')}
Users with any video progress: {s['video_progress'].get('users_with_progress')}

Page views: {s['page_views'].get('today')} today, {s['page_views'].get('week')} this week
Database size: {s['db_size']}
Video storage: {storage.get('videos', {}).get('files_bytes', 0) // 1024**2} MB
Media storage: {storage.get('media', {}).get('files_bytes', 0) // 1024**2} MB
Pending content-creator requests: {s.get('pending_contribute_requests')}

Top videos this week: {', '.join(f"{v['title']} ({v['views']} views)" for v in s.get('popular_videos_week', []))}
"""
        prompt = (
            "You are an AI assistant for the MST AI Portal admin. "
            "Answer the following question using ONLY the provided data snapshot. "
            "Be concise (1-3 sentences). If the data doesn't contain the answer, say so.\n\n"
            f"Data:\n{context}\n\n"
            f"Question: {text}"
        )
        answer = await call_llm(prompt)
        return f"💬 {answer}"
    except Exception as e:
        log.error(f"Telegram NL query error: {e}")
        return f"❌ Could not process query: {e}"


# ── Confirmation executor ─────────────────────────────────────────────────────

async def _execute_confirmed(pending: dict) -> str:
    action = pending["action"]
    payload = pending["payload"]

    if action == "announce":
        try:
            db = await get_write_db()
            result = await create_announcement(
                db, payload["title"], payload["content"]
            )
            if "error" in result:
                return f"❌ {result['error']}"
            return f"✅ Announcement posted (ID: {str(result.get('id', ''))[:8]}…)"
        except Exception as e:
            return f"❌ Failed to post announcement: {e}"

    elif action == "user_disable":
        try:
            db = await get_write_db()
            result = await disable_user(db, payload["email"])
            if "error" in result:
                return f"❌ {result['error']}"
            return f"🚫 User <b>{result['username']}</b> ({payload['email']}) has been disabled."
        except Exception as e:
            return f"❌ Failed to disable user: {e}"

    elif action == "user_enable":
        try:
            db = await get_write_db()
            result = await enable_user(db, payload["email"])
            if "error" in result:
                return f"❌ {result['error']}"
            return f"✅ User <b>{result['username']}</b> ({payload['email']}) has been re-enabled."
        except Exception as e:
            return f"❌ Failed to enable user: {e}"

    return "❌ Unknown action."
