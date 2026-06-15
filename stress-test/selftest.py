#!/usr/bin/env python3
"""Offline self-test: validates the full pipeline against an in-process mock
portal (httpx.MockTransport) — no network, no real server.

Run:  python selftest.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import httpx

from loadtest.auth import AuthConfig, IdentityPool, mint_token, COOKIE_NAME
from loadtest.catalog import Discovery, CATALOG, build_request
from loadtest.client import make_client, do_request
from loadtest.engine import Engine, LoadConfig
from loadtest.metrics import Histogram, Aggregator, Sample
from loadtest import hls as hlsmod
from loadtest import report as rpt


SECRET = "test-secret"

# ── mock portal ───────────────────────────────────────────────────────────────
_VIDEOS = [{"id": "v1", "slug": "intro-to-ai", "status": "ready",
            "hls_path": "/streams/v1/hls/master.m3u8"},
           {"id": "v2", "slug": "llm-basics", "status": "ready",
            "hls_path": "/streams/v2/hls/master.m3u8"}]
_MASTER = ("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n480p/index.m3u8\n"
           "#EXT-X-STREAM-INF:BANDWIDTH=2000000\n720p/index.m3u8\n")
_MEDIA = ("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg0.ts\n"
          "#EXTINF:6.0,\nseg1.ts\n#EXTINF:6.0,\nseg2.ts\n#EXT-X-ENDLIST\n")


def _handler(request: httpx.Request) -> httpx.Response:
    p = request.url.path
    if p == "/health":
        return httpx.Response(200, json={"status": "ok", "db": {"ok": True}})
    if p == "/auth/admin/users":
        # require an admin cookie to mimic the real RBAC
        cookie = request.headers.get("cookie", "")
        if COOKIE_NAME not in cookie:
            return httpx.Response(401, json={"detail": "no auth"})
        return httpx.Response(200, json=[{"id": f"u{i}", "role": "user"} for i in range(8)]
                              + [{"id": "admin1", "role": "admin"}])
    if p == "/video/videos":
        return httpx.Response(200, json=_VIDEOS)
    if p == "/video/courses":
        return httpx.Response(200, json=[{"id": "c1", "slug": "ai-track"}])
    if p == "/articles":
        return httpx.Response(200, json=[{"id": "a1", "slug": "ml-guide"}])
    if p == "/api/solutions/cards":
        return httpx.Response(200, json=[{"id": "s1"}, {"id": "s2"}])
    if p == "/api/solutions/news":
        return httpx.Response(200, json=[{"id": "n1"}])
    if p == "/forge/components":
        return httpx.Response(200, json=[{"id": "f1", "slug": "cool-skill"}])
    if p == "/memes/groups":
        return httpx.Response(200, json=[{"id": "m1", "slug": "funny"}])
    if p.endswith("master.m3u8"):
        return httpx.Response(200, text=_MASTER)
    if p.endswith("index.m3u8"):
        return httpx.Response(200, text=_MEDIA)
    if p.endswith(".ts"):
        return httpx.Response(200, content=b"\x00" * 2048)
    if p == "/search" or p == "/search/suggest":
        return httpx.Response(200, json={"results": []})
    if p.startswith("/auth/me"):
        return httpx.Response(200, json={"id": "u1", "username": "x", "role": "user",
                                         "display_name": "X", "created_at": "now"})
    # generic OK for the rest of the read-only catalog
    return httpx.Response(200, json={"ok": True})


def transport():
    return httpx.MockTransport(_handler)


# ── unit checks ───────────────────────────────────────────────────────────────
def check_metrics():
    h = Histogram()
    for v in range(1, 1001):
        h.record(float(v))
    p50 = h.percentile(50)
    assert 480 < p50 < 520, f"p50 off: {p50}"
    assert h.percentile(99) > h.percentile(95) > h.percentile(50)
    agg = Aggregator()
    for i in range(100):
        agg.record(Sample("x", "GET", 200, True, 10.0 + i, 100, 1000.0 + i * 0.01, stage=1))
    s = agg.overall_summary()
    assert s["requests"] == 100 and s["errors"] == 0
    print("  ✓ metrics histogram + aggregator")


def check_auth_roundtrip():
    import jwt
    cfg = AuthConfig(jwt_secret=SECRET)
    tok = mint_token(cfg, "u1", "admin")
    payload = jwt.decode(tok, SECRET, algorithms=["HS256"])
    assert payload["sub"] == "u1" and payload["role"] == "admin"
    print("  ✓ JWT mint/decode roundtrip")


def check_hls_parse():
    uris = hlsmod._parse_uris(_MASTER)
    assert uris == ["480p/index.m3u8", "720p/index.m3u8"], uris
    resolved = hlsmod._resolve("/streams/v1/hls/master.m3u8", "720p/index.m3u8")
    assert resolved == "/streams/v1/hls/720p/index.m3u8", resolved
    seg = hlsmod._resolve("/streams/v1/hls/720p/index.m3u8", "seg0.ts")
    assert seg == "/streams/v1/hls/720p/seg0.ts", seg
    print("  ✓ HLS manifest parse + relative resolve")


async def check_pipeline():
    client = make_client("http://mock", verify_tls=False, http2=False,
                         timeout=10, max_connections=50, transport=transport())
    # discovery + pool
    pool = await IdentityPool(AuthConfig(jwt_secret=SECRET, admin_user_id="admin1")).bootstrap(client)
    assert len(pool) >= 8, f"pool too small: {len(pool)}"
    disc = await Discovery().run(client)
    assert disc.pools["video_slug"], "no videos discovered"
    assert len(disc.videos) == 2
    # one authed request works
    s = await do_request(client, "auth.me", "/auth/me",
                         cookie=pool.next().cookie_header)
    assert s.ok and s.status == 200
    # build_request fills placeholders
    ep = next(e for e in CATALOG if e.key == "video.detail")
    path, q = build_request(ep, disc)
    assert path.startswith("/video/videos/") and "{" not in path
    await client.aclose()
    print(f"  ✓ pipeline: pool={len(pool)} identities, discovery, authed request, path build")


async def check_engine_breakpoint():
    cfg = LoadConfig(
        base_url="http://mock", mode="breakpoint",
        start_vus=10, step_vus=10, max_vus=30, stage_seconds=1.0,
        max_connections=100, include_hls=True,
        hls_segments=3, scenario_ratio=0.6, seed=7,
    )
    disc = await Discovery().run(
        make_client("http://mock", verify_tls=False, http2=False, timeout=5,
                    max_connections=10, transport=transport()))
    pool = await IdentityPool(AuthConfig(jwt_secret=SECRET, admin_user_id="admin1")).bootstrap(
        make_client("http://mock", verify_tls=False, http2=False, timeout=5,
                    max_connections=10, transport=transport()))
    engine = Engine(cfg, pool, disc)
    # inject mock transport into the engine's client
    engine.client = make_client("http://mock", verify_tls=False, http2=False,
                                timeout=10, max_connections=cfg.max_connections,
                                transport=transport())
    assert engine.endpoints, "no endpoints active"
    assert engine.hls_masters, "no HLS masters"
    results = await engine.run()
    await engine.client.aclose()
    assert results["overall"]["requests"] > 0
    assert results["stages"], "no stages recorded"
    assert any(l.startswith("hls.") for l in results["by_label"]), "HLS not exercised"
    # write + reload reports
    d = tempfile.mkdtemp()
    base = os.path.join(d, "selftest")
    rpt.write_json(results, base + ".json")
    rpt.write_csv(results, base + ".csv")
    rpt.write_html(results, base + ".html")
    assert os.path.getsize(base + ".html") > 1000
    with open(base + ".json") as f:
        json.load(f)
    print(f"  ✓ engine breakpoint run: {results['overall']['requests']} reqs, "
          f"{len(results['stages'])} stages, reports OK ({d})")


def check_serialization_merge():
    from loadtest.metrics import Aggregator, Sample
    # two aggregators, merge, compare against a combined one
    a = Aggregator(); b = Aggregator(); both = Aggregator()
    for i in range(500):
        s = Sample("ep", "GET", 200, True, 5.0 + (i % 50), 100, 1000.0 + i * 0.001, stage=1)
        a.record(s); both.record(s)
    for i in range(500):
        s = Sample("ep", "GET", 500, False, 200.0 + (i % 50), 100, 1000.5 + i * 0.001, stage=1, error="http_500")
        b.record(s); both.record(s)
    # round-trip a through dict
    a2 = Aggregator.from_dict(json.loads(json.dumps(a.to_dict())))
    assert a2.total == a.total and a2.errors == a.errors
    a2.merge(b)
    assert a2.total == both.total == 1000
    assert a2.errors == both.errors == 500
    # merged percentiles must match the directly-combined aggregator
    mp_ = a2.labels["ep"].hist.percentile(95)
    bp_ = both.labels["ep"].hist.percentile(95)
    assert abs(mp_ - bp_) < 1.0, (mp_, bp_)
    print(f"  ✓ aggregator serialize + merge (p95 merged={mp_:.1f} == combined={bp_:.1f})")


def check_multi_split():
    from loadtest.multi import split_counts, total_breakpoint_schedule
    from loadtest.engine import LoadConfig
    assert split_counts(100, 4) == [25, 25, 25, 25]
    assert split_counts(10, 3) == [4, 3, 3] and sum(split_counts(10, 3)) == 10
    cfg = LoadConfig(base_url="x", start_vus=20, step_vus=20, max_vus=80)
    assert total_breakpoint_schedule(cfg) == [20, 40, 60, 80]
    # per-stage split sums back to the total at every stage
    n = 3
    for v in total_breakpoint_schedule(cfg):
        assert sum(split_counts(v, n)) == v
    print("  ✓ multi-worker VU split + schedule")


async def amain():
    print("Running self-tests against in-process mock portal…")
    check_metrics()
    check_auth_roundtrip()
    check_hls_parse()
    check_serialization_merge()
    check_multi_split()
    await check_pipeline()
    await check_engine_breakpoint()
    print("\nALL SELF-TESTS PASSED ✅")


if __name__ == "__main__":
    asyncio.run(amain())
