"""Latency histograms, percentiles, and time-series aggregation.

Memory-bounded: latencies are recorded into a geometric-bucket histogram rather
than stored individually, so a multi-million-request run stays at a few MB.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional


# ── Geometric-bucket histogram ────────────────────────────────────────────────
# Covers 0.05 ms … ~180 s with ~5% relative bucket width. Percentiles are
# interpolated within the bucket that contains the requested rank.
_MIN_MS = 0.05
_MAX_MS = 180_000.0
_GROWTH = 1.05


def _build_bounds() -> List[float]:
    bounds = []
    v = _MIN_MS
    while v < _MAX_MS:
        bounds.append(v)
        v *= _GROWTH
    bounds.append(_MAX_MS)
    return bounds


_BOUNDS = _build_bounds()
_NBUCKETS = len(_BOUNDS)


class Histogram:
    """Fixed-bucket latency histogram (milliseconds)."""

    __slots__ = ("buckets", "count", "total", "minv", "maxv")

    def __init__(self) -> None:
        self.buckets = [0] * _NBUCKETS
        self.count = 0
        self.total = 0.0          # sum of values, for the mean
        self.minv = math.inf
        self.maxv = 0.0

    def record(self, ms: float) -> None:
        if ms < 0:
            ms = 0.0
        # binary search for the first bound >= ms
        lo, hi = 0, _NBUCKETS - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if _BOUNDS[mid] < ms:
                lo = mid + 1
            else:
                hi = mid
        self.buckets[lo] += 1
        self.count += 1
        self.total += ms
        if ms < self.minv:
            self.minv = ms
        if ms > self.maxv:
            self.maxv = ms

    def merge(self, other: "Histogram") -> None:
        for i, c in enumerate(other.buckets):
            if c:
                self.buckets[i] += c
        self.count += other.count
        self.total += other.total
        self.minv = min(self.minv, other.minv)
        self.maxv = max(self.maxv, other.maxv)

    def percentile(self, p: float) -> float:
        """Interpolated percentile (p in 0..100). Returns ms."""
        if self.count == 0:
            return 0.0
        rank = p / 100.0 * self.count
        cumulative = 0
        prev_bound = 0.0
        for i, c in enumerate(self.buckets):
            if c == 0:
                prev_bound = _BOUNDS[i]
                continue
            if cumulative + c >= rank:
                bound = _BOUNDS[i]
                frac = (rank - cumulative) / c
                return prev_bound + (bound - prev_bound) * frac
            cumulative += c
            prev_bound = _BOUNDS[i]
        return self.maxv

    @property
    def mean(self) -> float:
        return self.total / self.count if self.count else 0.0

    @property
    def minimum(self) -> float:
        return 0.0 if self.minv is math.inf else self.minv

    def summary(self) -> dict:
        return {
            "count": self.count,
            "min_ms": round(self.minimum, 2),
            "mean_ms": round(self.mean, 2),
            "p50_ms": round(self.percentile(50), 2),
            "p75_ms": round(self.percentile(75), 2),
            "p90_ms": round(self.percentile(90), 2),
            "p95_ms": round(self.percentile(95), 2),
            "p99_ms": round(self.percentile(99), 2),
            "max_ms": round(self.maxv, 2),
        }


# ── Per-request sample ────────────────────────────────────────────────────────

@dataclass(slots=True)
class Sample:
    label: str
    method: str
    status: int
    ok: bool
    latency_ms: float
    bytes: int
    t_start: float        # epoch seconds
    stage: int = 0
    error: Optional[str] = None


# ── Aggregation by label and over time ────────────────────────────────────────

@dataclass
class LabelStats:
    label: str
    hist: Histogram = field(default_factory=Histogram)
    ok: int = 0
    errors: int = 0
    bytes: int = 0
    status_counts: Dict[int, int] = field(default_factory=dict)
    error_kinds: Dict[str, int] = field(default_factory=dict)
    first_ts: float = 0.0
    last_ts: float = 0.0

    def add(self, s: Sample) -> None:
        self.hist.record(s.latency_ms)
        self.bytes += s.bytes
        self.status_counts[s.status] = self.status_counts.get(s.status, 0) + 1
        if s.ok:
            self.ok += 1
        else:
            self.errors += 1
            kind = s.error or f"http_{s.status}"
            self.error_kinds[kind] = self.error_kinds.get(kind, 0) + 1
        if self.first_ts == 0.0 or s.t_start < self.first_ts:
            self.first_ts = s.t_start
        if s.t_start > self.last_ts:
            self.last_ts = s.t_start

    @property
    def total(self) -> int:
        return self.ok + self.errors

    @property
    def error_rate(self) -> float:
        return self.errors / self.total if self.total else 0.0

    def summary(self) -> dict:
        d = self.hist.summary()
        d.update(
            label=self.label,
            requests=self.total,
            ok=self.ok,
            errors=self.errors,
            error_rate=round(self.error_rate, 4),
            bytes=self.bytes,
            status_counts={str(k): v for k, v in sorted(self.status_counts.items())},
            error_kinds=self.error_kinds,
        )
        return d


@dataclass
class SecondBucket:
    t: int
    requests: int = 0
    errors: int = 0
    latency_sum: float = 0.0
    inflight_max: int = 0

    @property
    def avg_latency(self) -> float:
        return self.latency_sum / self.requests if self.requests else 0.0


class Aggregator:
    """Collects samples into per-label stats and a per-second timeline."""

    def __init__(self) -> None:
        self.labels: Dict[str, LabelStats] = {}
        self.overall = Histogram()
        self.timeline: Dict[int, SecondBucket] = {}
        self.ok = 0
        self.errors = 0
        self.bytes = 0
        self.start_ts: Optional[float] = None
        self.end_ts: Optional[float] = None
        # per-stage rollup for breaking-point analysis
        self.stage_hist: Dict[int, Histogram] = {}
        self.stage_ok: Dict[int, int] = {}
        self.stage_err: Dict[int, int] = {}

    def record(self, s: Sample, inflight: int = 0) -> None:
        ls = self.labels.get(s.label)
        if ls is None:
            ls = self.labels[s.label] = LabelStats(s.label)
        ls.add(s)
        self.overall.record(s.latency_ms)
        self.bytes += s.bytes
        if s.ok:
            self.ok += 1
        else:
            self.errors += 1

        if self.start_ts is None or s.t_start < self.start_ts:
            self.start_ts = s.t_start
        end = s.t_start + s.latency_ms / 1000.0
        if self.end_ts is None or end > self.end_ts:
            self.end_ts = end

        sec = int(s.t_start)
        b = self.timeline.get(sec)
        if b is None:
            b = self.timeline[sec] = SecondBucket(sec)
        b.requests += 1
        b.latency_sum += s.latency_ms
        if not s.ok:
            b.errors += 1
        if inflight > b.inflight_max:
            b.inflight_max = inflight

        sh = self.stage_hist.get(s.stage)
        if sh is None:
            sh = self.stage_hist[s.stage] = Histogram()
            self.stage_ok[s.stage] = 0
            self.stage_err[s.stage] = 0
        sh.record(s.latency_ms)
        if s.ok:
            self.stage_ok[s.stage] += 1
        else:
            self.stage_err[s.stage] += 1

    @property
    def total(self) -> int:
        return self.ok + self.errors

    @property
    def duration(self) -> float:
        if self.start_ts is None or self.end_ts is None:
            return 0.0
        return max(0.0, self.end_ts - self.start_ts)

    @property
    def throughput(self) -> float:
        d = self.duration
        return self.total / d if d else 0.0

    @property
    def error_rate(self) -> float:
        return self.errors / self.total if self.total else 0.0

    def stage_summary(self, stage: int) -> dict:
        h = self.stage_hist.get(stage)
        ok = self.stage_ok.get(stage, 0)
        err = self.stage_err.get(stage, 0)
        total = ok + err
        return {
            "stage": stage,
            "requests": total,
            "ok": ok,
            "errors": err,
            "error_rate": round(err / total, 4) if total else 0.0,
            "p50_ms": round(h.percentile(50), 2) if h else 0.0,
            "p95_ms": round(h.percentile(95), 2) if h else 0.0,
            "p99_ms": round(h.percentile(99), 2) if h else 0.0,
        }

    def overall_summary(self) -> dict:
        d = self.overall.summary()
        d.update(
            requests=self.total,
            ok=self.ok,
            errors=self.errors,
            error_rate=round(self.error_rate, 4),
            duration_s=round(self.duration, 2),
            throughput_rps=round(self.throughput, 2),
            bytes=self.bytes,
            mbytes=round(self.bytes / 1e6, 2),
        )
        return d

    def timeline_rows(self) -> List[dict]:
        if not self.timeline:
            return []
        t0 = min(self.timeline)
        rows = []
        for t in range(t0, max(self.timeline) + 1):
            b = self.timeline.get(t)
            if b is None:
                rows.append({"t": t - t0, "rps": 0, "errors": 0, "avg_ms": 0.0, "inflight": 0})
            else:
                rows.append({
                    "t": t - t0,
                    "rps": b.requests,
                    "errors": b.errors,
                    "avg_ms": round(b.avg_latency, 2),
                    "inflight": b.inflight_max,
                })
        return rows
