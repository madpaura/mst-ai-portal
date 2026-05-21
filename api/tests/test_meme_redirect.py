"""Tests for GET /r/{meme_id} meme click-tracking redirect endpoint (issue #117)."""
import sys
import os
import asyncio
import uuid
from unittest.mock import patch, AsyncMock, MagicMock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _run(coro):
    return asyncio.run(coro)


def _make_uuid():
    return str(uuid.uuid4())


def _make_mock_request(
    ip=None, forwarded_for=None, real_ip=None,
    user_agent="TestAgent/1.0",
    referer="https://example.com/",
    cookie=None,
):
    """Build a minimal mock Request for the redirect endpoint."""
    req = MagicMock()
    headers = {}
    if real_ip:
        headers["x-real-ip"] = real_ip
    if forwarded_for:
        headers["x-forwarded-for"] = forwarded_for
    if user_agent:
        headers["user-agent"] = user_agent
    if referer:
        headers["referer"] = referer

    req.headers = MagicMock()
    req.headers.get = lambda key, default="": headers.get(key.lower(), default)
    req.client = MagicMock()
    req.client.host = ip or "127.0.0.1"
    req.cookies = {}
    if cookie:
        req.cookies["mst_token"] = cookie
    return req


# ── Cycle 1: redirect_meme function exists and has correct signature ──────────

class TestRedirectMemeStructure:
    """redirect_meme is an async function exported from memes.router."""

    def test_redirect_meme_is_coroutinefunction(self):
        import inspect
        from memes.router import redirect_meme
        assert inspect.iscoroutinefunction(redirect_meme)

    def test_redirect_router_has_r_route(self):
        """redirect_router contains GET /r/{meme_id} route."""
        from memes.router import redirect_router
        paths_and_methods = [(r.path, r.methods) for r in redirect_router.routes]
        assert any(p == "/r/{meme_id}" and "GET" in m for p, m in paths_and_methods)

    def test_redirect_route_has_no_auth_dependency(self):
        """GET /r/{meme_id} must not depend on get_current_user or require_admin."""
        from memes.router import redirect_router
        from auth.dependencies import get_current_user, require_admin
        route = next(r for r in redirect_router.routes if r.path == "/r/{meme_id}")
        dep_calls = [d.call for d in route.dependant.dependencies]
        assert get_current_user not in dep_calls, "redirect must not require auth"
        assert require_admin not in dep_calls, "redirect must not require admin"


# ── Cycle 2: unknown meme_id → 404, no DB insert ─────────────────────────────

class TestRedirectMemeNotFound:
    """Unknown meme_id returns 404 and does NOT write to meme_clicks."""

    def test_404_on_unknown_meme(self):
        """fetchrow returns None → HTTPException(404)."""
        from fastapi import HTTPException
        from memes.router import redirect_meme

        meme_id = _make_uuid()
        req = _make_mock_request()

        mock_db = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=None)

        async def run():
            with patch("memes.router.get_db", AsyncMock(return_value=mock_db)):
                with patch("memes.router.asyncio") as mock_asyncio:
                    try:
                        await redirect_meme(meme_id, req)
                        assert False, "Expected HTTPException(404)"
                    except HTTPException as e:
                        assert e.status_code == 404
                        return mock_asyncio

        mock_asyncio = _run(run())
        # create_task must NOT be called when meme is not found
        mock_asyncio.create_task.assert_not_called()

    def test_no_db_write_on_404(self):
        """When meme is not found, db.execute is never called."""
        from fastapi import HTTPException
        from memes.router import redirect_meme

        meme_id = _make_uuid()
        req = _make_mock_request()

        mock_db = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=None)

        async def run():
            with patch("memes.router.get_db", AsyncMock(return_value=mock_db)):
                try:
                    await redirect_meme(meme_id, req)
                except HTTPException:
                    pass

        _run(run())
        mock_db.execute.assert_not_called()


# ── Cycle 3: valid meme with link_url → 302 redirect ─────────────────────────

class TestRedirectMemeWithLinkUrl:
    """Valid meme with link_url set → HTTP 302 to link_url."""

    def _make_meme_row(self, link_url="https://example.com/product"):
        row = MagicMock()
        row.__getitem__ = lambda self, key: {
            "id": uuid.UUID(_make_uuid()),
            "link_url": link_url,
        }[key]
        row.get = lambda key, default=None: {
            "link_url": link_url,
        }.get(key, default)
        return row

    def test_302_redirect_to_link_url(self):
        """Returns RedirectResponse(status_code=302) pointing to link_url."""
        from starlette.responses import RedirectResponse
        from memes.router import redirect_meme

        meme_id = _make_uuid()
        target = "https://example.com/product"
        req = _make_mock_request()

        mock_row = {"id": uuid.UUID(meme_id), "link_url": target}
        mock_db = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=mock_row)

        async def run():
            with patch("memes.router.get_db", AsyncMock(return_value=mock_db)):
                with patch("memes.router.asyncio") as mock_asyncio:
                    mock_asyncio.create_task = MagicMock()
                    resp = await redirect_meme(meme_id, req)
                    return resp

        resp = _run(run())
        assert isinstance(resp, RedirectResponse)
        assert resp.status_code == 302
        assert resp.headers["location"] == target

    def test_create_task_called_with_link_url(self):
        """asyncio.create_task is called once (fire-and-forget DB write)."""
        from memes.router import redirect_meme

        meme_id = _make_uuid()
        target = "https://example.com/product"
        req = _make_mock_request()

        mock_row = {"id": uuid.UUID(meme_id), "link_url": target}
        mock_db = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=mock_row)

        async def run():
            with patch("memes.router.get_db", AsyncMock(return_value=mock_db)):
                with patch("memes.router.asyncio") as mock_asyncio:
                    mock_asyncio.create_task = MagicMock()
                    await redirect_meme(meme_id, req)
                    return mock_asyncio

        mock_asyncio = _run(run())
        mock_asyncio.create_task.assert_called_once()


# ── Cycle 4: valid meme with link_url=None → redirect to "/" ─────────────────

class TestRedirectMemeNoLinkUrl:
    """Valid meme with link_url=None → HTTP 302 to '/'."""

    def test_302_redirect_to_root_when_no_link_url(self):
        from starlette.responses import RedirectResponse
        from memes.router import redirect_meme

        meme_id = _make_uuid()
        req = _make_mock_request()

        mock_row = {"id": uuid.UUID(meme_id), "link_url": None}
        mock_db = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=mock_row)

        async def run():
            with patch("memes.router.get_db", AsyncMock(return_value=mock_db)):
                with patch("memes.router.asyncio") as mock_asyncio:
                    mock_asyncio.create_task = MagicMock()
                    resp = await redirect_meme(meme_id, req)
                    return resp

        resp = _run(run())
        assert isinstance(resp, RedirectResponse)
        assert resp.status_code == 302
        assert resp.headers["location"] == "/"

    def test_create_task_still_called_when_no_link_url(self):
        """Fire-and-forget DB write happens even when link_url is None."""
        from memes.router import redirect_meme

        meme_id = _make_uuid()
        req = _make_mock_request()

        mock_row = {"id": uuid.UUID(meme_id), "link_url": None}
        mock_db = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=mock_row)

        async def run():
            with patch("memes.router.get_db", AsyncMock(return_value=mock_db)):
                with patch("memes.router.asyncio") as mock_asyncio:
                    mock_asyncio.create_task = MagicMock()
                    await redirect_meme(meme_id, req)
                    return mock_asyncio

        mock_asyncio = _run(run())
        mock_asyncio.create_task.assert_called_once()


# ── Cycle 5: unauthenticated → user_id=NULL ───────────────────────────────────

class TestRedirectMemeUserIdCapture:
    """user_id is NULL when no cookie is present; populated when cookie is valid."""

    def test_unauthenticated_sets_user_id_none(self):
        """No JWT cookie → _log_click called with user_id=None."""
        from memes.router import redirect_meme, _log_click

        meme_id = _make_uuid()
        req = _make_mock_request(cookie=None)  # no cookie

        mock_row = {"id": uuid.UUID(meme_id), "link_url": "https://example.com"}
        mock_db = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=mock_row)

        captured_calls = []

        async def fake_log_click(db, meme_id, user_id, ip, ua, referrer):
            captured_calls.append({"user_id": user_id})

        async def run():
            with patch("memes.router.get_db", AsyncMock(return_value=mock_db)):
                with patch("memes.router._log_click", fake_log_click):
                    with patch("memes.router.asyncio") as mock_asyncio:
                        # Capture and immediately invoke the coroutine passed to create_task
                        async def run_task_now(coro):
                            await coro
                        mock_asyncio.create_task = lambda coro: asyncio.ensure_future(coro)
                        await redirect_meme(meme_id, req)
                        # Allow tasks to run
                        await asyncio.sleep(0)

        _run(run())
        assert len(captured_calls) == 1
        assert captured_calls[0]["user_id"] is None

    def test_authenticated_sets_user_id(self):
        """Valid JWT cookie → user_id is populated in _log_click call."""
        from memes.router import redirect_meme, _log_click
        from auth.service import create_access_token

        meme_id = _make_uuid()
        user_id = _make_uuid()
        token = create_access_token(user_id, "user")
        req = _make_mock_request(cookie=token)

        mock_row = {"id": uuid.UUID(meme_id), "link_url": "https://example.com"}
        mock_db = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=mock_row)

        captured_calls = []

        async def fake_log_click(db, meme_id, uid, ip, ua, referrer):
            captured_calls.append({"user_id": uid})

        async def run():
            with patch("memes.router.get_db", AsyncMock(return_value=mock_db)):
                with patch("memes.router._log_click", fake_log_click):
                    with patch("memes.router.asyncio") as mock_asyncio:
                        mock_asyncio.create_task = lambda coro: asyncio.ensure_future(coro)
                        await redirect_meme(meme_id, req)
                        await asyncio.sleep(0)

        _run(run())
        assert len(captured_calls) == 1
        assert captured_calls[0]["user_id"] == user_id

    def test_invalid_jwt_sets_user_id_none(self):
        """Malformed JWT cookie → user_id=None (no exception)."""
        from memes.router import redirect_meme, _log_click

        meme_id = _make_uuid()
        req = _make_mock_request(cookie="not.a.valid.jwt.token")

        mock_row = {"id": uuid.UUID(meme_id), "link_url": "https://example.com"}
        mock_db = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=mock_row)

        captured_calls = []

        async def fake_log_click(db, meme_id, uid, ip, ua, referrer):
            captured_calls.append({"user_id": uid})

        async def run():
            with patch("memes.router.get_db", AsyncMock(return_value=mock_db)):
                with patch("memes.router._log_click", fake_log_click):
                    with patch("memes.router.asyncio") as mock_asyncio:
                        mock_asyncio.create_task = lambda coro: asyncio.ensure_future(coro)
                        await redirect_meme(meme_id, req)
                        await asyncio.sleep(0)

        _run(run())
        assert len(captured_calls) == 1
        assert captured_calls[0]["user_id"] is None


# ── Cycle 6: _log_click captures correct fields ───────────────────────────────

class TestLogClickFields:
    """_log_click inserts the correct fields into meme_clicks."""

    def test_log_click_inserts_correct_fields(self):
        """_log_click calls db.execute with all required fields."""
        from memes.router import _log_click

        meme_id = _make_uuid()
        user_id = _make_uuid()
        ip = "1.2.3.4"
        ua = "Mozilla/5.0"
        referrer = "https://email.example.com/"

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock()

        async def run():
            await _log_click(mock_db, meme_id, user_id, ip, ua, referrer)

        _run(run())

        mock_db.execute.assert_called_once()
        call_args = mock_db.execute.call_args
        sql = call_args[0][0]
        params = call_args[0][1:]

        # Verify it's an INSERT into meme_clicks
        assert "INSERT INTO meme_clicks" in sql
        assert "meme_id" in sql

        # Verify the actual values passed
        assert meme_id in params or str(meme_id) in [str(p) for p in params]
        assert user_id in params or str(user_id) in [str(p) for p in params]
        assert ip in params
        assert ua in params
        assert referrer in params

    def test_log_click_handles_none_referrer(self):
        """_log_click runs without error when referrer is None."""
        from memes.router import _log_click

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock()

        async def run():
            await _log_click(mock_db, _make_uuid(), None, "127.0.0.1", "agent", None)

        _run(run())
        mock_db.execute.assert_called_once()


# ── Cycle 7: IP extraction follows tracker.py _client_ip pattern ─────────────

class TestClientIpExtraction:
    """IP address is extracted using x-real-ip > x-forwarded-for > client.host."""

    def test_x_real_ip_takes_priority(self):
        """x-real-ip header is preferred over x-forwarded-for and client.host."""
        from memes.router import redirect_meme

        meme_id = _make_uuid()
        req = _make_mock_request(
            ip="10.0.0.1",
            forwarded_for="20.0.0.1",
            real_ip="30.0.0.1",
        )

        mock_row = {"id": uuid.UUID(meme_id), "link_url": "https://example.com"}
        mock_db = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=mock_row)

        captured_ips = []

        async def fake_log_click(db, mid, uid, ip, ua, referrer):
            captured_ips.append(ip)

        async def run():
            with patch("memes.router.get_db", AsyncMock(return_value=mock_db)):
                with patch("memes.router._log_click", fake_log_click):
                    with patch("memes.router.asyncio") as mock_asyncio:
                        mock_asyncio.create_task = lambda coro: asyncio.ensure_future(coro)
                        await redirect_meme(meme_id, req)
                        await asyncio.sleep(0)

        _run(run())
        assert captured_ips == ["30.0.0.1"]

    def test_x_forwarded_for_used_when_no_real_ip(self):
        """x-forwarded-for first IP is used when x-real-ip absent."""
        from memes.router import redirect_meme

        meme_id = _make_uuid()
        req = _make_mock_request(ip="10.0.0.1", forwarded_for="20.0.0.1, 99.0.0.1")

        mock_row = {"id": uuid.UUID(meme_id), "link_url": "https://example.com"}
        mock_db = AsyncMock()
        mock_db.fetchrow = AsyncMock(return_value=mock_row)

        captured_ips = []

        async def fake_log_click(db, mid, uid, ip, ua, referrer):
            captured_ips.append(ip)

        async def run():
            with patch("memes.router.get_db", AsyncMock(return_value=mock_db)):
                with patch("memes.router._log_click", fake_log_click):
                    with patch("memes.router.asyncio") as mock_asyncio:
                        mock_asyncio.create_task = lambda coro: asyncio.ensure_future(coro)
                        await redirect_meme(meme_id, req)
                        await asyncio.sleep(0)

        _run(run())
        assert captured_ips == ["20.0.0.1"]
