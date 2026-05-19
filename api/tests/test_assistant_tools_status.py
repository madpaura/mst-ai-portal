"""Tests for content/admin role-gated status tools (issue #111)."""
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock


def _run(coro):
    return asyncio.run(coro)


def _make_db(rows=None, row=None, val=None):
    db = MagicMock()
    db.fetch = AsyncMock(return_value=rows or [])
    db.fetchrow = AsyncMock(return_value=row)
    db.fetchval = AsyncMock(return_value=val)
    return db


# ── get_my_articles ───────────────────────────────────────────────────────────

class TestGetMyArticles:
    def test_content_user_gets_own_articles(self):
        from assistant.tools import get_my_articles
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "title": "My Article", "slug": "my-article",
            "category": "ai", "status": "published", "created_at": "2025-01-01",
        }[k]
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_my_articles(user_id="u1", user_role="content"))
        assert result["found"] is True
        assert len(result["articles"]) == 1
        # verify query was scoped to user
        call_args = db.fetch.call_args
        assert "u1" in call_args.args or "u1" in str(call_args)

    def test_no_articles_returns_found_false(self):
        from assistant.tools import get_my_articles
        db = _make_db(rows=[])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_my_articles(user_id="u1", user_role="content"))
        assert result["found"] is False

    def test_user_role_cannot_call_get_my_articles(self):
        from assistant.tools import get_tools_for_role
        names = {t["function"]["name"] for t in get_tools_for_role("user")}
        assert "get_my_articles" not in names


# ── get_my_publish_requests ───────────────────────────────────────────────────

class TestGetMyPublishRequests:
    def test_returns_pending_requests(self):
        from assistant.tools import get_my_publish_requests
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "id": "pr1", "target_type": "video", "target_title": "My Video",
            "status": "pending", "note": None, "created_at": "2025-01-01", "reviewed_at": None,
        }[k]
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_my_publish_requests(user_id="u1", user_role="content"))
        assert result["found"] is True
        assert result["requests"][0]["status"] == "pending"

    def test_empty_returns_found_false(self):
        from assistant.tools import get_my_publish_requests
        db = _make_db(rows=[])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_my_publish_requests(user_id="u1", user_role="content"))
        assert result["found"] is False


# ── get_publish_request_status ────────────────────────────────────────────────

class TestGetPublishRequestStatus:
    def test_returns_own_request_status(self):
        from assistant.tools import get_publish_request_status
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "id": "pr1", "target_type": "video", "target_title": "My Video",
            "status": "approved", "note": "Looks good",
            "created_at": "2025-01-01", "reviewed_at": "2025-01-02",
            "requested_by": "u1",
        }[k]
        row.get = lambda k, d=None: {"reviewer_name": None}.get(k, d)
        db = _make_db(row=row)
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_publish_request_status("pr1", user_id="u1", user_role="content"))
        assert result["found"] is True
        assert result["status"] == "approved"

    def test_cannot_view_another_users_request(self):
        from assistant.tools import get_publish_request_status
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "id": "pr1", "target_type": "video", "target_title": "Other's Video",
            "status": "pending", "note": None,
            "created_at": "2025-01-01", "reviewed_at": None,
            "requested_by": "other-user",
        }[k]
        row.get = lambda k, d=None: {}.get(k, d)
        db = _make_db(row=row)
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_publish_request_status("pr1", user_id="u1", user_role="content"))
        assert result.get("found") is False or "error" in result

    def test_not_found(self):
        from assistant.tools import get_publish_request_status
        db = _make_db(row=None)
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_publish_request_status("no-id", user_id="u1", user_role="content"))
        assert result["found"] is False


# ── get_video_job_status ──────────────────────────────────────────────────────

class TestGetVideoJobStatus:
    def _job_row(self, video_id="v1", job_type="transcript", status="processing", owner_id="u1"):
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "job_type": job_type, "status": status,
            "created_at": "2025-01-01", "completed_at": None,
            "error": None, "video_title": "My Video",
        }[k]
        return row

    def test_content_user_sees_own_video_jobs(self):
        from assistant.tools import get_video_job_status
        db = _make_db(rows=[self._job_row()])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_video_job_status(user_id="u1", user_role="content"))
        assert result["found"] is True
        assert result["jobs"][0]["status"] == "processing"
        # query must include user_id scope for content role
        call_args = db.fetch.call_args
        assert "u1" in str(call_args)

    def test_admin_sees_all_jobs(self):
        from assistant.tools import get_video_job_status
        db = _make_db(rows=[self._job_row(owner_id="other")])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_video_job_status(user_id="admin1", user_role="admin"))
        assert result["found"] is True

    def test_empty_returns_found_false(self):
        from assistant.tools import get_video_job_status
        db = _make_db(rows=[])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_video_job_status(user_id="u1", user_role="content"))
        assert result["found"] is False


# ── get_my_artifacts ─────────────────────────────────────────────────────────

class TestGetMyArtifacts:
    def test_content_user_sees_own_artifacts(self):
        from assistant.tools import get_my_artifacts
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "id": "a1", "name": "My Agent", "display_name": "My Agent",
            "artifact_type": "agent", "status": "published", "created_at": "2025-01-01",
        }[k]
        row.get = lambda k, d=None: {"submitted_by_name": None}.get(k, d)
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_my_artifacts(user_id="u1", user_role="content"))
        assert result["found"] is True
        assert result["artifacts"][0]["name"] == "My Agent"
        call_args = db.fetch.call_args
        assert "u1" in str(call_args)

    def test_admin_sees_all_artifacts(self):
        from assistant.tools import get_my_artifacts
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "id": "a1", "name": "Someone's Agent", "display_name": "Someone's Agent",
            "artifact_type": "agent", "status": "pending", "created_at": "2025-01-01",
        }[k]
        row.get = lambda k, d=None: {"submitted_by_name": "other"}.get(k, d)
        db = _make_db(rows=[row])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_my_artifacts(user_id="admin1", user_role="admin"))
        assert result["found"] is True

    def test_empty_returns_found_false(self):
        from assistant.tools import get_my_artifacts
        db = _make_db(rows=[])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_my_artifacts(user_id="u1", user_role="content"))
        assert result["found"] is False


# ── get_artifact_status ───────────────────────────────────────────────────────

class TestGetArtifactStatus:
    def test_returns_artifact_status(self):
        from assistant.tools import get_artifact_status
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "id": "a1", "name": "My Agent", "display_name": "My Agent",
            "artifact_type": "agent", "status": "pending", "created_at": "2025-01-01",
        }[k]
        row.get = lambda k, d=None: {
            "submitted_by_id": "u1", "github_url": None, "reject_reason": None,
        }.get(k, d)
        db = _make_db(row=row)
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_artifact_status("my-agent", user_id="u1", user_role="content"))
        assert result["found"] is True
        assert result["status"] == "pending"

    def test_not_found(self):
        from assistant.tools import get_artifact_status
        db = _make_db(row=None)
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(get_artifact_status("ghost", user_id="u1", user_role="content"))
        assert result["found"] is False


# ── list_videos_pending_publish ───────────────────────────────────────────────

class TestListVideosPendingPublish:
    def _row(self, title="Unpublished Video", video_id="v1"):
        row = MagicMock()
        row.__getitem__ = lambda s, k: {
            "title": title, "slug": title.lower().replace(" ", "-"),
            "category": "ai", "uploaded_by": "user1", "thumbnail": None,
        }[k]
        return row

    def test_content_user_sees_own_unpublished(self):
        from assistant.tools import list_videos_pending_publish
        db = _make_db(rows=[self._row()])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(list_videos_pending_publish(user_id="u1", user_role="content"))
        assert result["found"] is True
        assert len(result["results"]) == 1
        # query must include user_id scope for content role
        call_args = db.fetch.call_args
        assert "u1" in str(call_args)

    def test_admin_sees_all_unpublished(self):
        from assistant.tools import list_videos_pending_publish
        db = _make_db(rows=[self._row("Video A"), self._row("Video B", "v2")])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(list_videos_pending_publish(user_id="admin1", user_role="admin"))
        assert result["found"] is True
        assert len(result["results"]) == 2

    def test_empty_returns_found_false(self):
        from assistant.tools import list_videos_pending_publish
        db = _make_db(rows=[])
        with patch("assistant.tools.get_db", AsyncMock(return_value=db)):
            result = _run(list_videos_pending_publish(user_id="u1", user_role="content"))
        assert result["found"] is False

    def test_user_role_cannot_call_list_videos_pending_publish(self):
        from assistant.tools import get_tools_for_role
        names = {t["function"]["name"] for t in get_tools_for_role("user")}
        assert "list_videos_pending_publish" not in names
