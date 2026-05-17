"""Tests for P2-medium fixes (#67, #68, #76)."""
import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── #67: async subprocess helpers ────────────────────────────────────────────

class TestAsyncHelpers:
    """_run_probe_async and _run_remotion_async exist and have correct signatures."""

    def test_run_probe_async_exists(self):
        import inspect
        from video.admin_router import _run_probe_async
        assert inspect.iscoroutinefunction(_run_probe_async)

    def test_run_remotion_async_exists(self):
        import inspect
        from video.admin_router import _run_remotion_async
        assert inspect.iscoroutinefunction(_run_remotion_async)

    def test_run_ffmpeg_async_still_exists(self):
        import inspect
        from video.admin_router import _run_ffmpeg_async
        assert inspect.iscoroutinefunction(_run_ffmpeg_async)

    def test_run_probe_async_pipes_stdout(self):
        """Confirm _run_probe_async source uses PIPE for stdout (not DEVNULL)."""
        import inspect
        from video.admin_router import _run_probe_async
        src = inspect.getsource(_run_probe_async)
        assert "subprocess.PIPE" in src or "PIPE" in src
        assert "stdout=asyncio.subprocess.PIPE" in src

    def test_run_remotion_async_pipes_both(self):
        """Confirm _run_remotion_async source captures both stdout and stderr."""
        import inspect
        from video.admin_router import _run_remotion_async
        src = inspect.getsource(_run_remotion_async)
        assert "stdout=asyncio.subprocess.PIPE" in src
        assert "stderr=asyncio.subprocess.PIPE" in src


# ── #68: UUID path param validation ──────────────────────────────────────────

class TestUUIDPathValidation:
    """UUIDPath annotation and pattern are correct."""

    def test_uuid_path_alias_defined(self):
        from video.router import UUIDPath, _UUID_PATTERN
        assert UUIDPath is not None
        assert _UUID_PATTERN is not None

    def test_uuid_pattern_accepts_valid_uuid(self):
        import re
        from video.router import _UUID_PATTERN
        valid = "550e8400-e29b-41d4-a716-446655440000"
        assert re.match(_UUID_PATTERN, valid)

    def test_uuid_pattern_rejects_short_id(self):
        import re
        from video.router import _UUID_PATTERN
        assert not re.match(_UUID_PATTERN, "abc123")

    def test_uuid_pattern_rejects_slug(self):
        import re
        from video.router import _UUID_PATTERN
        assert not re.match(_UUID_PATTERN, "my-video-slug")

    def test_uuid_pattern_rejects_sql_injection(self):
        import re
        from video.router import _UUID_PATTERN
        assert not re.match(_UUID_PATTERN, "1' OR '1'='1")


# ── #76: article content sanitization ────────────────────────────────────────

class TestArticleSanitize:
    def test_sanitize_strips_script_tags(self):
        from articles.router import _sanitize
        result = _sanitize("<p>Hello</p><script>alert('xss')</script>")
        assert "<script>" not in result
        assert "Hello" in result

    def test_sanitize_strips_onerror_attr(self):
        from articles.router import _sanitize
        result = _sanitize('<img src="x" onerror="alert(1)" />')
        assert "onerror" not in result

    def test_sanitize_allows_safe_markup(self):
        from articles.router import _sanitize
        html = "<h2>Section</h2><p>Text with <strong>bold</strong></p><ul><li>item</li></ul>"
        result = _sanitize(html)
        assert "<h2>" in result
        assert "<strong>" in result
        assert "<ul>" in result

    def test_sanitize_allows_links(self):
        from articles.router import _sanitize
        result = _sanitize('<a href="https://example.com">link</a>')
        assert "example.com" in result

    def test_sanitize_strips_javascript_href(self):
        from articles.router import _sanitize
        result = _sanitize('<a href="javascript:alert(1)">click</a>')
        assert "javascript:" not in result

    def test_sanitize_allows_code_blocks(self):
        from articles.router import _sanitize
        result = _sanitize("<pre><code>print('hello')</code></pre>")
        assert "<pre>" in result
        assert "<code>" in result

    def test_sanitize_function_importable(self):
        from articles.router import _sanitize
        from articles.admin_router import _sanitize as admin_sanitize
        # Both should produce the same result (admin re-uses the same function)
        html = "<p>Test <script>evil()</script></p>"
        assert _sanitize(html) == admin_sanitize(html)
