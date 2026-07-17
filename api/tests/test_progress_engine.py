"""Tests for the course progress engine and feedback endpoints (issue #239, PR 2).

The progress engine is the logic-dense module: manual ticks merged with
video watch history, course % arithmetic, and the auto-subscribe side
effect on the write path.
"""
import sys
import os
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _run(coro):
    return asyncio.run(coro)


def _uuid():
    return str(uuid.uuid4())


class FakeRow(dict):
    """asyncpg.Record stand-in: mapping access + .get()."""


def _item_row(item_type="exercise", manual=None, video=False):
    return FakeRow(id=uuid.UUID(_uuid()), item_type=item_type,
                   manual_completed=manual, video_completed=video)


USER = {"id": _uuid(), "role": "user"}


# ── Completion merge ──────────────────────────────────────────────────────────

class TestResolveCompletion:
    def _resolve(self, rows):
        from video.progress_engine import resolve_completion
        db = MagicMock()
        db.fetch = AsyncMock(return_value=rows)
        return _run(resolve_completion(db, USER["id"], _uuid()))

    def test_video_auto_completes_from_watch_history(self):
        row = _item_row("video", manual=None, video=True)
        assert self._resolve([row])[str(row["id"])] is True

    def test_unwatched_video_not_complete(self):
        row = _item_row("video", manual=None, video=False)
        assert self._resolve([row])[str(row["id"])] is False

    def test_manual_tick_wins_for_non_video(self):
        row = _item_row("exercise", manual=True)
        assert self._resolve([row])[str(row["id"])] is True

    def test_manual_untick_overrides_watched_video(self):
        """User explicitly unticked a video they watched — manual record wins."""
        row = _item_row("video", manual=False, video=True)
        assert self._resolve([row])[str(row["id"])] is False

    def test_non_video_defaults_incomplete(self):
        row = _item_row("reading", manual=None)
        assert self._resolve([row])[str(row["id"])] is False


# ── Course % arithmetic ───────────────────────────────────────────────────────

class TestCourseProgress:
    def test_pct_math(self):
        from video.progress_engine import compute_pct
        assert compute_pct(3, 12) == 25.0
        assert compute_pct(1, 3) == 33.3
        assert compute_pct(0, 0) == 0

    def test_course_progress_counts(self):
        from video.progress_engine import course_progress
        rows = [
            _item_row("video", video=True),
            _item_row("exercise", manual=True),
            _item_row("video", video=False),
            _item_row("reading"),
        ]
        db = MagicMock()
        db.fetch = AsyncMock(return_value=rows)
        p = _run(course_progress(db, USER["id"], _uuid()))
        assert p["completed"] == 2 and p["total"] == 4 and p["pct"] == 50.0
        assert len(p["completed_item_ids"]) == 2

    def test_empty_curriculum(self):
        from video.progress_engine import course_progress
        db = MagicMock()
        db.fetch = AsyncMock(return_value=[])
        p = _run(course_progress(db, USER["id"], _uuid()))
        assert p == {"completed": 0, "total": 0, "pct": 0, "completed_item_ids": []}


# ── Suggested week ────────────────────────────────────────────────────────────

class TestSuggestedWeek:
    def test_first_week(self):
        from video.progress_engine import suggested_week
        enrolled = datetime.now(timezone.utc) - timedelta(days=2)
        assert suggested_week(enrolled, 4) == 1

    def test_second_week(self):
        from video.progress_engine import suggested_week
        enrolled = datetime.now(timezone.utc) - timedelta(days=9)
        assert suggested_week(enrolled, 4) == 2

    def test_clamped_to_plan_length(self):
        from video.progress_engine import suggested_week
        enrolled = datetime.now(timezone.utc) - timedelta(days=365)
        assert suggested_week(enrolled, 4) == 4

    def test_not_enrolled(self):
        from video.progress_engine import suggested_week
        assert suggested_week(None, 4) is None


# ── Write path: auto-subscribe ────────────────────────────────────────────────

class TestSetItemProgress:
    def _db(self, item_course=None, enroll_result="INSERT 0 1"):
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=item_course)
        db.execute = AsyncMock(side_effect=[enroll_result, None, None, None])
        return db

    def test_first_tick_auto_enrolls(self):
        from video.progress_engine import set_item_progress
        cid = uuid.UUID(_uuid())
        db = self._db(FakeRow(id=uuid.UUID(_uuid()), course_id=cid), "INSERT 0 1")
        result = _run(set_item_progress(db, USER["id"], _uuid(), True))
        assert result["auto_enrolled"] is True
        assert result["course_id"] == str(cid)
        # enrollment insert + enroll analytics + progress upsert + item analytics
        assert db.execute.await_count == 4

    def test_already_enrolled_no_side_effect(self):
        from video.progress_engine import set_item_progress
        cid = uuid.UUID(_uuid())
        db = self._db(FakeRow(id=uuid.UUID(_uuid()), course_id=cid), "INSERT 0 0")
        result = _run(set_item_progress(db, USER["id"], _uuid(), True))
        assert result["auto_enrolled"] is False
        # enrollment no-op + progress upsert + item analytics (no enroll event)
        assert db.execute.await_count == 3

    def test_unknown_item(self):
        from video.progress_engine import set_item_progress
        db = self._db(None)
        result = _run(set_item_progress(db, USER["id"], _uuid(), True))
        assert result["course_id"] is None
        db.execute.assert_not_awaited()


# ── Feedback endpoint rules ───────────────────────────────────────────────────

class TestFeedback:
    def test_feedback_requires_enrollment(self):
        from video.course_router import submit_feedback
        from video.schemas import CourseFeedbackSubmit
        course = FakeRow(id=uuid.UUID(_uuid()), title="T", slug="t", sort_order=0)
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=course)
        db.fetchval = AsyncMock(return_value=None)  # not enrolled
        with patch("video.course_router.get_db", AsyncMock(return_value=db)):
            with pytest.raises(HTTPException) as exc:
                _run(submit_feedback("t", CourseFeedbackSubmit(rating=5), USER))
        assert exc.value.status_code == 403

    def test_feedback_upserts_for_enrolled(self):
        from video.course_router import submit_feedback
        from video.schemas import CourseFeedbackSubmit
        course = FakeRow(id=uuid.UUID(_uuid()), title="T", slug="t", sort_order=0)
        saved = FakeRow(rating=4, comment="good", updated_at=datetime.now(timezone.utc))
        db = MagicMock()
        db.fetchrow = AsyncMock(side_effect=[course, saved])
        db.fetchval = AsyncMock(return_value=1)  # enrolled
        with patch("video.course_router.get_db", AsyncMock(return_value=db)):
            resp = _run(submit_feedback("t", CourseFeedbackSubmit(rating=4, comment="good"), USER))
        assert resp.rating == 4 and resp.comment == "good"
        upsert_sql = db.fetchrow.await_args_list[1].args[0]
        assert "ON CONFLICT (user_id, course_id)" in upsert_sql

    def test_rating_bounds_enforced_by_schema(self):
        from video.schemas import CourseFeedbackSubmit
        with pytest.raises(Exception):
            CourseFeedbackSubmit(rating=0)
        with pytest.raises(Exception):
            CourseFeedbackSubmit(rating=6)

    def test_unpublished_course_404(self):
        from video.course_router import get_course_detail
        db = MagicMock()
        db.fetchrow = AsyncMock(return_value=None)
        with patch("video.course_router.get_db", AsyncMock(return_value=db)):
            with pytest.raises(HTTPException) as exc:
                _run(get_course_detail("hidden", None))
        assert exc.value.status_code == 404
