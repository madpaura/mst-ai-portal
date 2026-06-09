"""Load engine: a closed-model concurrency ramp with breaking-point detection.

Model: N concurrent *virtual users* (VUs), each looping — pick a work unit
(a full user journey or a single weighted endpoint), execute it, optionally
think, repeat. Breaking point ramps N upward stage by stage; the resulting
request throughput and latency are measured. The knee is the highest VU count
that still meets the SLOs (error rate + p95). This matches how the question is
usually asked: "how many concurrent users can the portal sustain?"
"""
from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from . import catalog as cat
from . import hls as hlsmod
from . import scenarios as scn
from .auth import IdentityPool
from .client import do_request, make_client


@dataclass
class LoadConfig:
    base_url: str
    mode: str = "breakpoint"          # breakpoint | steady | latency | soak
    # concurrency ramp (breakpoint)
    start_vus: int = 25
    step_vus: int = 25
    max_vus: int = 1000
    stage_seconds: float = 30.0
    # steady / soak / latency
    vus: int = 50
    duration: float = 120.0
    # SLOs for breaking-point evaluation
    max_error_rate: float = 0.02      # 2%
    max_p95_ms: float = 1500.0
    stop_on_breach: bool = True
    breach_grace_stages: int = 1      # extra stages past first breach (maps degradation)
    # traffic shape
    scenario_ratio: float = 0.6       # fraction of work units that are full journeys
    include_hls: bool = True
    hls_segments: int = 6
    think: float = 0.0                # mean think-time between steps/units (s); 0 = full throttle
    # safety / perf
    max_connections: int = 1000
    request_timeout: float = 30.0
    http2: bool = False
    verify_tls: bool = True
    count_4xx_as_error: bool = False
    seed: Optional[int] = None


@dataclass
class StageResult:
    index: int
    vus: int
    requests: int
    errors: int
    error_rate: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    achieved_rps: float
    passed: bool


class Engine:
    def __init__(self, cfg: LoadConfig, pool: Optional[IdentityPool],
                 disc: cat.Discovery, *, on_tick: Optional[Callable] = None) -> None:
        from .metrics import Aggregator
        self.cfg = cfg
        self.pool = pool
        self.disc = disc
        self.agg = Aggregator()
        self.on_tick = on_tick
        self.client = None
        self.inflight = 0                 # requests currently in flight
        self._stop = False
        self.stage = 0
        self.stage_results: List[StageResult] = []
        self.hls_masters: List[str] = []
        self.status: Dict = {"phase": "init", "stage": 0, "vus": 0,
                             "inflight": 0, "rps": 0.0, "err_rate": 0.0,
                             "p95": 0.0, "total": 0}
        if cfg.seed is not None:
            random.seed(cfg.seed)

        self.endpoints = [e for e in cat.CATALOG if disc.available(e)
                          and (not e.auth or (pool and len(pool)))]
        self._ep_by_key = {e.key: e for e in cat.CATALOG}
        self._ep_weights = [e.weight for e in self.endpoints]
        self.scenarios = list(scn.SCENARIOS)
        if cfg.include_hls:
            self.hls_masters = hlsmod.ready_video_hls_paths(disc.videos)
        if not self.hls_masters:
            for s in self.scenarios:
                s.steps = [st for st in s.steps if st != scn.HLS]
        self._scn_weights = [s.weight for s in self.scenarios]

    # ── lifecycle ────────────────────────────────────────────────────────────
    async def __aenter__(self):
        self.client = make_client(
            self.cfg.base_url, verify_tls=self.cfg.verify_tls, http2=self.cfg.http2,
            timeout=self.cfg.request_timeout, max_connections=self.cfg.max_connections,
        )
        return self

    async def __aexit__(self, *exc):
        if self.client:
            await self.client.aclose()

    # ── workload primitives ──────────────────────────────────────────────────
    def _cookie(self) -> Optional[str]:
        if self.pool and len(self.pool):
            return self.pool.next().cookie_header
        return None

    async def _hit_endpoint(self, ep: cat.Endpoint, cookie: Optional[str]) -> None:
        built = cat.build_request(ep, self.disc)
        if built is None:
            return
        path, query = built
        self.inflight += 1
        try:
            s = await do_request(
                self.client, ep.key, path, query=query,
                cookie=cookie if ep.auth else None, stage=self.stage,
                count_4xx_as_error=self.cfg.count_4xx_as_error,
            )
        finally:
            self.inflight -= 1
        self.agg.record(s, inflight=self.inflight)

    async def _run_single(self) -> None:
        ep = random.choices(self.endpoints, weights=self._ep_weights, k=1)[0]
        await self._hit_endpoint(ep, self._cookie())

    async def _run_scenario(self) -> None:
        sc = random.choices(self.scenarios, weights=self._scn_weights, k=1)[0]
        cookie = self._cookie()
        for step in sc.steps:
            if self._stop:
                break
            if step == scn.HLS:
                if not self.hls_masters:
                    continue
                master = random.choice(self.hls_masters)
                self.inflight += 1
                try:
                    samples = await hlsmod.stream_session(
                        self.client, master, segments=self.cfg.hls_segments, stage=self.stage)
                finally:
                    self.inflight -= 1
                for s in samples:
                    self.agg.record(s, inflight=self.inflight)
            else:
                ep = self._ep_by_key.get(step)
                if ep is None or not self.disc.available(ep):
                    continue
                if ep.auth and not cookie:
                    continue
                await self._hit_endpoint(ep, cookie)
            if self.cfg.think > 0:
                await asyncio.sleep(random.expovariate(1.0 / self.cfg.think))

    async def _unit(self) -> None:
        if self.scenarios and random.random() < self.cfg.scenario_ratio:
            await self._run_scenario()
        else:
            await self._run_single()

    async def _vu(self, stage_stop: asyncio.Event) -> None:
        """One virtual user: loop work units until the stage ends."""
        while not stage_stop.is_set() and not self._stop:
            try:
                await self._unit()
            except Exception:
                pass  # a single failed unit must not kill the VU
            if self.cfg.think > 0 and not stage_stop.is_set():
                await asyncio.sleep(random.expovariate(1.0 / self.cfg.think))

    # ── stage execution ──────────────────────────────────────────────────────
    async def _run_stage(self, vus: int, seconds: float, window: float) -> StageResult:
        stage_stop = asyncio.Event()
        workers = [asyncio.create_task(self._vu(stage_stop)) for _ in range(vus)]
        loop = asyncio.get_event_loop()
        end = loop.time() + seconds
        while loop.time() < end and not self._stop:
            await asyncio.sleep(min(1.0, max(0.05, end - loop.time())))
            self._emit_tick(vus)
        stage_stop.set()
        await asyncio.gather(*workers, return_exceptions=True)
        return self._evaluate_stage(self.stage, vus, window)

    def _emit_tick(self, vus: int) -> None:
        recent = self._recent_window(3.0)
        self.status.update(
            stage=self.stage, vus=vus, inflight=self.inflight,
            total=self.agg.total, rps=recent["rps"],
            err_rate=recent["err_rate"], p95=recent["p95"],
        )
        if self.on_tick:
            self.on_tick(self.status)

    def _recent_window(self, secs: float) -> Dict:
        now = int(time.time())
        reqs = errs = 0
        for t in range(now - int(secs), now + 1):
            b = self.agg.timeline.get(t)
            if b:
                reqs += b.requests
                errs += b.errors
        rps = reqs / secs if secs else 0.0
        err_rate = errs / reqs if reqs else 0.0
        h = self.agg.stage_hist.get(self.stage)
        return {"rps": round(rps, 1), "err_rate": round(err_rate, 4),
                "p95": round(h.percentile(95), 1) if h else 0.0}

    def _evaluate_stage(self, idx: int, vus: int, window: float) -> StageResult:
        s = self.agg.stage_summary(idx)
        passed = (s["error_rate"] <= self.cfg.max_error_rate
                  and s["p95_ms"] <= self.cfg.max_p95_ms)
        achieved = s["requests"] / window if window else 0.0
        return StageResult(
            index=idx, vus=vus, requests=s["requests"], errors=s["errors"],
            error_rate=s["error_rate"], p50_ms=s["p50_ms"], p95_ms=s["p95_ms"],
            p99_ms=s["p99_ms"], achieved_rps=round(achieved, 1), passed=passed,
        )

    # ── modes ────────────────────────────────────────────────────────────────
    async def run(self) -> Dict:
        if self.cfg.mode == "breakpoint":
            await self._run_breakpoint()
        else:
            await self._run_steady()
        return self.build_results()

    async def _run_steady(self) -> None:
        self.stage = 1
        self.status["phase"] = self.cfg.mode
        self.stage_results.append(
            await self._run_stage(self.cfg.vus, self.cfg.duration, self.cfg.duration))

    async def _run_breakpoint(self) -> None:
        self.status["phase"] = "breakpoint"
        breaches = 0
        vus = self.cfg.start_vus
        idx = 0
        while vus <= self.cfg.max_vus and not self._stop:
            idx += 1
            self.stage = idx
            res = await self._run_stage(vus, self.cfg.stage_seconds, self.cfg.stage_seconds)
            self.stage_results.append(res)
            if not res.passed:
                breaches += 1
                if self.cfg.stop_on_breach and breaches > self.cfg.breach_grace_stages:
                    break
            vus += self.cfg.step_vus

    # ── results ──────────────────────────────────────────────────────────────
    def _breaking_point(self) -> Dict:
        last_pass = None
        first_fail = None
        for r in self.stage_results:
            if r.passed:
                last_pass = r
            elif first_fail is None:
                first_fail = r
        return {
            "sustainable_vus": last_pass.vus if last_pass else None,
            "sustainable_rps": last_pass.achieved_rps if last_pass else None,
            "first_breach_vus": first_fail.vus if first_fail else None,
            "breach_reason": (
                None if first_fail is None else
                ("error_rate" if first_fail.error_rate > self.cfg.max_error_rate
                 else "latency_p95")
            ),
        }

    def build_results(self) -> Dict:
        return {
            "config": self.cfg.__dict__,
            "overall": self.agg.overall_summary(),
            "by_label": {k: v.summary() for k, v in sorted(self.agg.labels.items())},
            "stages": [r.__dict__ for r in self.stage_results],
            "breaking_point": self._breaking_point() if self.cfg.mode == "breakpoint" else None,
            "timeline": self.agg.timeline_rows(),
            "identities": len(self.pool) if self.pool else 0,
            "hls_videos": len(self.hls_masters),
            "endpoints_active": [e.key for e in self.endpoints],
        }
