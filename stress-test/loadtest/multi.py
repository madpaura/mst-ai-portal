"""Multi-process load generation (--load-workers).

One asyncio process is GIL-bound to a single core (~hundreds of rps). To
saturate a fast target from one machine, fork N generator processes, split the
virtual users across them, and merge their results. Merging happens at the
histogram-bucket level, so combined percentiles are exact — not averages of
per-process summaries.
"""
from __future__ import annotations

import asyncio
import json
import multiprocessing as mp
import os
import tempfile
from dataclasses import replace
from typing import Dict, List, Optional

from .auth import AuthConfig, IdentityPool
from .catalog import Discovery
from .client import make_client
from .engine import Engine, LoadConfig, assemble_results
from .metrics import Aggregator


def total_breakpoint_schedule(cfg: LoadConfig) -> List[int]:
    sched, v = [], cfg.start_vus
    while v <= cfg.max_vus:
        sched.append(v)
        v += cfg.step_vus
    return sched


def split_counts(total: int, n: int) -> List[int]:
    """Split `total` VUs across `n` workers, distributing the remainder."""
    base, rem = divmod(total, n)
    return [base + (1 if w < rem else 0) for w in range(n)]


# ── child process ─────────────────────────────────────────────────────────────
def _child_entry(args: dict) -> None:
    asyncio.run(_child_async(args))


async def _child_async(args: dict) -> None:
    cfg = LoadConfig(**args["cfg"])
    authcfg = AuthConfig(**args["auth"]) if args.get("auth") else None
    setup_client = make_client(cfg.base_url, verify_tls=cfg.verify_tls,
                               http2=cfg.http2, timeout=cfg.request_timeout,
                               max_connections=20)
    pool = None
    try:
        if authcfg and authcfg.jwt_secret and not args.get("no_auth"):
            try:
                pool = await IdentityPool(authcfg).bootstrap(setup_client)
            except Exception:
                pool = None
        cookie = pool.identities[0].cookie_header if pool and len(pool) else None
        disc = await Discovery().run(setup_client, identity_cookie=cookie)
    finally:
        await setup_client.aclose()

    engine = Engine(cfg, pool, disc)
    async with engine:
        await engine.run()

    out = {
        "agg": engine.agg.to_dict(),
        "identities": len(pool) if pool else 0,
        "hls": len(engine.hls_masters),
        "endpoints": [e.key for e in engine.endpoints],
    }
    with open(args["out_path"], "w") as f:
        json.dump(out, f)


# ── parent orchestration ──────────────────────────────────────────────────────
def run_multi(cfg: LoadConfig, auth_dict: Optional[dict], n_workers: int,
              *, no_auth: bool) -> Dict:
    if cfg.mode == "breakpoint":
        totals = total_breakpoint_schedule(cfg)
        per_child = [[split_counts(v, n_workers)[w] for v in totals]
                     for w in range(n_workers)]
        stage_vus = {i + 1: v for i, v in enumerate(totals)}
    else:
        counts = split_counts(cfg.vus, n_workers)
        per_child = [counts[w] for w in range(n_workers)]
        stage_vus = {1: cfg.vus}

    tmpdir = tempfile.mkdtemp(prefix="stress_multi_")
    procs, outs = [], []
    ctx = mp.get_context("spawn")  # safe across platforms; avoids fork+asyncio quirks
    for w in range(n_workers):
        child_cfg = replace(cfg, stop_on_breach=False)
        if cfg.mode == "breakpoint":
            child_cfg = replace(child_cfg, vus_schedule=per_child[w])
        else:
            child_cfg = replace(child_cfg, vus=per_child[w])
        out_path = os.path.join(tmpdir, f"w{w}.json")
        outs.append(out_path)
        args = {"auth": auth_dict, "cfg": child_cfg.__dict__,
                "no_auth": no_auth, "out_path": out_path}
        p = ctx.Process(target=_child_entry, args=(args,), daemon=False)
        p.start()
        procs.append(p)

    for p in procs:
        p.join()

    merged = Aggregator()
    identities = hls = 0
    endpoints: set = set()
    found = 0
    for out_path in outs:
        if not os.path.exists(out_path):
            continue
        found += 1
        with open(out_path) as f:
            d = json.load(f)
        merged.merge(Aggregator.from_dict(d["agg"]))
        identities = max(identities, d.get("identities", 0))  # same pool per child
        hls = max(hls, d.get("hls", 0))
        endpoints |= set(d.get("endpoints", []))

    results = assemble_results(
        cfg, merged, stage_vus, identities=identities,
        hls_videos=hls, endpoints_active=sorted(endpoints),
    )
    results["load_workers"] = n_workers
    results["load_workers_reported"] = found
    return results
