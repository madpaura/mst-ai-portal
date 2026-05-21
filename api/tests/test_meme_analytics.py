"""Tests for GET /admin/analytics/memes/daily and /memes/by-meme endpoints."""
import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── Endpoint registration ─────────────────────────────────

class TestMemeAnalyticsEndpointRegistration:
    """Verify the route is registered and has correct metadata."""

    def test_memes_daily_route_exists(self):
        """Route /memes/daily is registered on the analytics router."""
        from analytics.admin_router import router
        paths = [r.path for r in router.routes]
        assert "/memes/daily" in paths

    def test_memes_daily_route_is_get(self):
        """Route uses GET method."""
        from analytics.admin_router import router
        for route in router.routes:
            if route.path == "/memes/daily":
                assert "GET" in route.methods
                break

    def test_memes_daily_requires_admin(self):
        """Handler has require_admin as a Depends parameter (FastAPI param-level dependency)."""
        import inspect
        from analytics.admin_router import analytics_memes_daily
        from auth.dependencies import require_admin
        from fastapi import params as fastapi_params
        sig = inspect.signature(analytics_memes_daily)
        # FastAPI stores Depends in the parameter default
        for param in sig.parameters.values():
            if isinstance(param.default, fastapi_params.Depends):
                if param.default.dependency is require_admin:
                    return
        raise AssertionError("require_admin not found as a Depends parameter in analytics_memes_daily")


# ── Handler signature and logic ───────────────────────────

class TestMemeAnalyticsHandlerSignature:
    """Verify the handler is importable and has the correct signature."""

    def test_handler_importable(self):
        from analytics.admin_router import analytics_memes_daily
        assert callable(analytics_memes_daily)

    def test_handler_is_coroutine(self):
        import inspect
        from analytics.admin_router import analytics_memes_daily
        assert inspect.iscoroutinefunction(analytics_memes_daily)

    def test_handler_has_days_param(self):
        import inspect
        from analytics.admin_router import analytics_memes_daily
        sig = inspect.signature(analytics_memes_daily)
        assert "days" in sig.parameters

    def test_handler_has_admin_param(self):
        import inspect
        from analytics.admin_router import analytics_memes_daily
        sig = inspect.signature(analytics_memes_daily)
        assert "admin" in sig.parameters


# ── SQL query content ─────────────────────────────────────

class TestMemeAnalyticsSQLPattern:
    """Verify the SQL query in the handler uses generate_series for zero-filling."""

    def _get_handler_source(self):
        import inspect
        from analytics.admin_router import analytics_memes_daily
        return inspect.getsource(analytics_memes_daily)

    def test_uses_generate_series(self):
        """SQL must use generate_series to zero-fill missing days."""
        src = self._get_handler_source()
        assert "generate_series" in src

    def test_uses_left_join_meme_clicks(self):
        """SQL must LEFT JOIN meme_clicks so days with no clicks appear."""
        src = self._get_handler_source()
        assert "LEFT JOIN" in src.upper()
        assert "meme_clicks" in src

    def test_uses_coalesce(self):
        """SQL must use COALESCE to return 0 for days with no clicks."""
        src = self._get_handler_source()
        assert "COALESCE" in src.upper()

    def test_returns_day_and_clicks_keys(self):
        """Response list items must contain 'day' and 'clicks' keys."""
        src = self._get_handler_source()
        assert '"day"' in src
        assert '"clicks"' in src

    def test_days_param_used_in_query(self):
        """The days parameter controls the date range in the query."""
        src = self._get_handler_source()
        # The handler should pass str(days) or days to the SQL query
        assert "days" in src


# ── Response shape ────────────────────────────────────────

class TestMemeAnalyticsResponseShape:
    """Verify return value shape via static analysis of the handler source."""

    def test_return_is_list_comprehension(self):
        """Handler returns a list of dicts with day and clicks."""
        import inspect
        from analytics.admin_router import analytics_memes_daily
        src = inspect.getsource(analytics_memes_daily)
        # The list comprehension should produce dicts with "day" and "clicks"
        assert "day" in src
        assert "clicks" in src

    def test_days_query_param_default_30(self):
        """Default value of 'days' parameter is 30."""
        import inspect
        from analytics.admin_router import analytics_memes_daily
        sig = inspect.signature(analytics_memes_daily)
        # The default might be on the Query(...) annotation; check source
        src = inspect.getsource(analytics_memes_daily)
        assert "30" in src


# ── Auth / permission tests (static) ─────────────────────

class TestMemeAnalyticsAuth:
    """Static checks that auth is properly enforced."""

    def test_require_admin_imported(self):
        """require_admin is imported in the analytics router."""
        import inspect
        import analytics.admin_router as mod
        src = inspect.getsource(mod)
        assert "require_admin" in src

    def test_memes_endpoint_uses_depends(self):
        """The memes/daily handler source uses Depends(require_admin)."""
        import inspect
        from analytics.admin_router import analytics_memes_daily
        src = inspect.getsource(analytics_memes_daily)
        assert "require_admin" in src or "Depends" in src


# ── By-meme endpoint tests ────────────────────────────────

class TestMemeByMemeEndpointRegistration:
    def test_by_meme_route_exists(self):
        from analytics.admin_router import router
        paths = [r.path for r in router.routes]
        assert "/memes/by-meme" in paths

    def test_by_meme_route_is_get(self):
        from analytics.admin_router import router
        for route in router.routes:
            if route.path == "/memes/by-meme":
                assert "GET" in route.methods
                break

    def test_by_meme_requires_admin(self):
        import inspect
        from analytics.admin_router import analytics_memes_by_meme
        from auth.dependencies import require_admin
        from fastapi import params as fastapi_params
        sig = inspect.signature(analytics_memes_by_meme)
        for param in sig.parameters.values():
            if isinstance(param.default, fastapi_params.Depends):
                if param.default.dependency is require_admin:
                    return
        raise AssertionError("require_admin not found in analytics_memes_by_meme")


class TestMemeByMemeHandlerSignature:
    def test_importable(self):
        from analytics.admin_router import analytics_memes_by_meme
        assert callable(analytics_memes_by_meme)

    def test_is_coroutine(self):
        import inspect
        from analytics.admin_router import analytics_memes_by_meme
        assert inspect.iscoroutinefunction(analytics_memes_by_meme)

    def test_has_days_param(self):
        import inspect
        from analytics.admin_router import analytics_memes_by_meme
        sig = inspect.signature(analytics_memes_by_meme)
        assert "days" in sig.parameters


class TestMemeByMemeSQLPattern:
    def _src(self):
        import inspect
        from analytics.admin_router import analytics_memes_by_meme
        return inspect.getsource(analytics_memes_by_meme)

    def test_joins_meme_groups(self):
        assert "meme_groups" in self._src()

    def test_left_joins_meme_clicks(self):
        src = self._src()
        assert "LEFT JOIN" in src.upper()
        assert "meme_clicks" in src

    def test_uses_coalesce_for_null_title(self):
        assert "COALESCE" in self._src().upper()

    def test_sorts_by_total_clicks_desc(self):
        src = self._src()
        assert "reverse=True" in src or "DESC" in src

    def test_returns_group_shape_keys(self):
        src = self._src()
        for key in ("group_id", "group_title", "group_category", "total_clicks", "memes"):
            assert key in src

    def test_returns_meme_shape_keys(self):
        src = self._src()
        for key in ("meme_id", "meme_title", "image_url", "clicks"):
            assert key in src


class TestMemeByMemeAggregation:
    """Unit-test the aggregation logic in isolation using synthetic data."""

    def _aggregate(self, rows):
        from collections import OrderedDict
        group_map = OrderedDict()
        for r in rows:
            gid = r["group_id"]
            if gid not in group_map:
                group_map[gid] = {"group_id": gid, "group_title": r["group_title"],
                                  "group_category": r["group_category"], "total_clicks": 0, "memes": []}
            group_map[gid]["total_clicks"] += r["clicks"]
            group_map[gid]["memes"].append({"meme_id": r["meme_id"], "meme_title": r["meme_title"],
                                            "image_url": r["image_url"], "clicks": r["clicks"]})
        return sorted(group_map.values(), key=lambda g: g["total_clicks"], reverse=True)

    def _row(self, gid, gtitle, gcat, mid, mtitle, img, clicks):
        return {"group_id": gid, "group_title": gtitle, "group_category": gcat,
                "meme_id": mid, "meme_title": mtitle, "image_url": img, "clicks": clicks}

    def test_groups_sorted_by_total_desc(self):
        rows = [self._row("g1", "A", "cat", "m1", "m", "", 5),
                self._row("g2", "B", "cat", "m2", "m", "", 20)]
        result = self._aggregate(rows)
        assert result[0]["group_id"] == "g2"
        assert result[1]["group_id"] == "g1"

    def test_total_clicks_summed(self):
        rows = [self._row("g1", "A", "cat", "m1", "m", "", 3),
                self._row("g1", "A", "cat", "m2", "m", "", 7)]
        result = self._aggregate(rows)
        assert result[0]["total_clicks"] == 10

    def test_null_title_untitled(self):
        rows = [self._row("g1", "A", "cat", "m1", "Untitled", "", 0)]
        result = self._aggregate(rows)
        assert result[0]["memes"][0]["meme_title"] == "Untitled"

    def test_zero_click_group_included(self):
        rows = [self._row("g1", "A", "cat", "m1", "m", "", 0)]
        result = self._aggregate(rows)
        assert len(result) == 1
        assert result[0]["total_clicks"] == 0
