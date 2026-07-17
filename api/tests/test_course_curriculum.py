"""Tests for the course curriculum admin API (issue #239, PR 1).

Covers publish gating, item validation, video-duration inheritance,
reorder validation and row→schema mapping.
"""
import sys
import os
import asyncio
import json
import uuid
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


def _fake_db(*, fetchrow=None, fetchval=None, fetch=None):
    db = MagicMock()
    db.fetchrow = AsyncMock(side_effect=fetchrow if isinstance(fetchrow, list) else None,
                            return_value=None if isinstance(fetchrow, list) else fetchrow)
    db.fetchval = AsyncMock(side_effect=fetchval if isinstance(fetchval, list) else None,
                            return_value=None if isinstance(fetchval, list) else fetchval)
    db.fetch = AsyncMock(return_value=fetch or [])
    db.execute = AsyncMock(return_value=None)
    return db


ADMIN = {"id": _uuid(), "role": "admin"}


# ── Structure ─────────────────────────────────────────────────────────────────

class TestRouterStructure:
    def test_curriculum_endpoints_exist(self):
        import inspect
        from video import course_admin_router as m
        for fn in (
            m.admin_get_curriculum, m.admin_create_module, m.admin_update_module,
            m.admin_delete_module, m.admin_reorder_modules, m.admin_create_item,
            m.admin_update_item, m.admin_delete_item, m.admin_reorder_items,
            m.admin_publish_curriculum, m.admin_upload_course_cover, m.admin_get_course,
        ):
            assert inspect.iscoroutinefunction(fn)

    def test_routes_registered(self):
        from video.course_admin_router import router
        paths = {r.path for r in router.routes}
        assert "/courses/{course_id}/curriculum" in paths
        assert "/courses/{course_id}/curriculum/modules" in paths
        assert "/curriculum/modules/{module_id}/items" in paths
        assert "/courses/{course_id}/curriculum/publish" in paths

    def test_migration_chain(self):
        import importlib
        mod = importlib.import_module("alembic.versions.0029_course_curriculum") if False else None
        # migrations aren't a package — read the file instead
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "alembic", "versions", "0029_course_curriculum.py")
        src = open(path).read()
        assert "revision = '0029'" in src
        assert "down_revision = '0028'" in src
        assert "IF NOT EXISTS" in src


# ── Schema mapping ────────────────────────────────────────────────────────────

class TestRowMapping:
    def test_course_response_new_fields_default(self):
        from video.schemas import CourseResponse
        c = CourseResponse(id="x", title="t", slug="s", sort_order=0)
        assert c.tags == [] and c.objectives == []
        assert c.level is None and c.curriculum_published is False

    def test_parse_links_accepts_json_string_and_list(self):
        from video.course_admin_router import _parse_links
        as_str = _parse_links(json.dumps([{"label": "Repo", "url": "https://x"}]))
        as_list = _parse_links([{"label": "Repo", "url": "https://x"}])
        assert as_str[0].label == "Repo" and as_list[0].url == "https://x"
        assert _parse_links(None) == []

    def test_item_resp_maps_row(self):
        from video.course_admin_router import _item_resp
        row = FakeRow(
            id=uuid.UUID(_uuid()), module_id=uuid.UUID(_uuid()), item_type="video",
            title="Intro", description=None, duration_min=42,
            video_id=uuid.UUID(_uuid()), video_slug="intro", video_title="Intro vid",
            external_url=None, links='[]', sort_order=0,
        )
        item = _item_resp(row)
        assert item.item_type == "video" and item.duration_min == 42
        assert item.video_slug == "intro" and item.links == []

    def test_course_resp_reads_metadata(self):
        from video.course_admin_router import _course_resp
        row = FakeRow(
            id=uuid.UUID(_uuid()), title="T", slug="t", description=None, sort_order=1,
            is_featured=False, level="Beginner", tags=["llm"], cover_image=None,
            objectives=["a", "b"], prerequisites=None, curriculum_published=True,
        )
        c = _course_resp(row, video_count=3)
        assert c.level == "Beginner" and c.tags == ["llm"]
        assert c.objectives == ["a", "b"] and c.curriculum_published is True
        assert c.video_count == 3


# ── Publish gating ────────────────────────────────────────────────────────────

class TestPublishGate:
    def test_publish_empty_curriculum_rejected(self):
        from video.course_admin_router import admin_publish_curriculum
        from video.schemas import CurriculumPublishRequest
        course_row = FakeRow(id=uuid.UUID(_uuid()), title="T", slug="t", sort_order=0)
        db = _fake_db(fetchrow=course_row, fetchval=0)
        with patch("video.course_admin_router.get_db", AsyncMock(return_value=db)):
            with pytest.raises(HTTPException) as exc:
                _run(admin_publish_curriculum(
                    str(course_row["id"]), CurriculumPublishRequest(published=True), ADMIN))
        assert exc.value.status_code == 400
        db.execute.assert_not_awaited()

    def test_unpublish_always_allowed(self):
        from video.course_admin_router import admin_publish_curriculum
        from video.schemas import CurriculumPublishRequest
        cid = uuid.UUID(_uuid())
        course_row = FakeRow(
            id=cid, title="T", slug="t", description=None, sort_order=0,
            is_featured=False, video_count=0, curriculum_published=False,
        )
        db = _fake_db(fetchrow=[course_row, course_row], fetchval=0)
        with patch("video.course_admin_router.get_db", AsyncMock(return_value=db)), \
             patch("video.course_admin_router.cache") as mock_cache:
            mock_cache.bump_version = AsyncMock()
            resp = _run(admin_publish_curriculum(
                str(cid), CurriculumPublishRequest(published=False), ADMIN))
        assert resp.curriculum_published is False
        db.execute.assert_awaited()

    def test_publish_missing_course_404(self):
        from video.course_admin_router import admin_publish_curriculum
        from video.schemas import CurriculumPublishRequest
        db = _fake_db(fetchrow=None)
        with patch("video.course_admin_router.get_db", AsyncMock(return_value=db)):
            with pytest.raises(HTTPException) as exc:
                _run(admin_publish_curriculum(
                    _uuid(), CurriculumPublishRequest(published=True), ADMIN))
        assert exc.value.status_code == 404


# ── Item validation + duration inheritance ────────────────────────────────────

class TestItemRules:
    def test_create_item_rejects_bad_type(self):
        from video.course_admin_router import admin_create_item
        from video.schemas import CourseItemCreate
        db = _fake_db(fetchrow=FakeRow(id=uuid.UUID(_uuid())))
        with patch("video.course_admin_router.get_db", AsyncMock(return_value=db)):
            with pytest.raises(HTTPException) as exc:
                _run(admin_create_item(
                    _uuid(), CourseItemCreate(item_type="quiz", title="X"), ADMIN))
        assert exc.value.status_code == 400

    def test_create_video_item_requires_video(self):
        from video.course_admin_router import admin_create_item
        from video.schemas import CourseItemCreate
        db = _fake_db(fetchrow=FakeRow(id=uuid.UUID(_uuid())))
        with patch("video.course_admin_router.get_db", AsyncMock(return_value=db)):
            with pytest.raises(HTTPException) as exc:
                _run(admin_create_item(
                    _uuid(), CourseItemCreate(item_type="video", title="X"), ADMIN))
        assert exc.value.status_code == 400

    def test_duration_inherited_from_video(self):
        """duration_min unset + linked video of 310s → ceil(310/60) = 6 min."""
        from video.course_admin_router import _resolve_item_fields
        db = _fake_db(fetchval=310)
        fields = _run(_resolve_item_fields(db, {"video_id": _uuid(), "duration_min": None}))
        assert fields["duration_min"] == 6

    def test_explicit_duration_wins_over_video(self):
        from video.course_admin_router import _resolve_item_fields
        db = _fake_db(fetchval=310)
        fields = _run(_resolve_item_fields(db, {"video_id": _uuid(), "duration_min": 90}))
        assert fields["duration_min"] == 90

    def test_links_serialized_to_json(self):
        from video.course_admin_router import _resolve_item_fields
        from video.schemas import ItemLink
        db = _fake_db()
        fields = _run(_resolve_item_fields(
            db, {"links": [ItemLink(label="Repo", url="https://x")]}))
        assert json.loads(fields["links"]) == [{"label": "Repo", "url": "https://x"}]


# ── Reorder validation ────────────────────────────────────────────────────────

class TestReorder:
    def test_module_reorder_rejects_mismatched_ids(self):
        from video.course_admin_router import admin_reorder_modules
        from video.schemas import ReorderRequest
        real_id = _uuid()
        db = _fake_db(fetch=[FakeRow(id=uuid.UUID(real_id))])
        with patch("video.course_admin_router.get_db", AsyncMock(return_value=db)):
            with pytest.raises(HTTPException) as exc:
                _run(admin_reorder_modules(
                    _uuid(), ReorderRequest(ids=[_uuid()]), ADMIN))
        assert exc.value.status_code == 400

    def test_item_reorder_accepts_exact_ids(self):
        from video.course_admin_router import admin_reorder_items
        from video.schemas import ReorderRequest
        a, b = _uuid(), _uuid()
        db = _fake_db(fetch=[FakeRow(id=uuid.UUID(a)), FakeRow(id=uuid.UUID(b))])
        with patch("video.course_admin_router.get_db", AsyncMock(return_value=db)), \
             patch("video.course_admin_router.cache") as mock_cache:
            mock_cache.bump_version = AsyncMock()
            resp = _run(admin_reorder_items(_uuid(), ReorderRequest(ids=[b, a]), ADMIN))
        assert resp == {"message": "Items reordered"}
        assert db.execute.await_count == 2
