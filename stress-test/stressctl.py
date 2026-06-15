#!/usr/bin/env python3
"""stressctl — stress-test CLI for the MST AI Portal.

Read-only load generator for a SAML/ADFS-protected portal. Authenticates virtual
users by minting mst_token JWTs from JWT_SECRET (no IdP round-trip, no DB writes),
ramps offered load to find the breaking point, and writes HTML/JSON/CSV reports.

Examples
  # Smoke check: connectivity, auth bootstrap, endpoint discovery
  ./stressctl.py check --base-url https://portal.corp --jwt-secret "$JWT_SECRET" \
      --admin-user-id 1a2b...

  # Breaking-point ramp (default): 20→600 rps, 30s stages, stop on SLO breach
  ./stressctl.py run --base-url https://portal.corp --jwt-secret "$JWT_SECRET" \
      --admin-user-id 1a2b... --name run1

  # Public-only, no auth, fixed steady load for 5 minutes
  ./stressctl.py run --base-url https://portal.corp --no-auth \
      --mode steady --rps 80 --duration 300

  # Regenerate report from a saved JSON
  ./stressctl.py report --json reports/run1.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time

# Make `loadtest` importable when run from anywhere
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from loadtest.auth import AuthConfig, IdentityPool          # noqa: E402
from loadtest.catalog import Discovery                       # noqa: E402
from loadtest.client import make_client                      # noqa: E402
from loadtest.engine import Engine, LoadConfig               # noqa: E402
from loadtest import report as rpt                           # noqa: E402


def _console():
    from rich.console import Console
    return Console()


# ── argument parsing ──────────────────────────────────────────────────────────
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="stressctl",
        description="Read-only stress-test suite for the MST AI Portal.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_conn(sp):
        g = sp.add_argument_group("connection")
        g.add_argument("--base-url", required=True,
                       help="Portal API base URL, e.g. https://portal.corp or http://host:9800")
        g.add_argument("--insecure", action="store_true", help="Disable TLS verification")
        g.add_argument("--http2", action="store_true", help="Enable HTTP/2 (requires h2)")
        g.add_argument("--request-timeout", type=float, default=30.0)

    def add_auth(sp):
        g = sp.add_argument_group("auth (mint mst_token JWTs)")
        g.add_argument("--jwt-secret", default=os.environ.get("JWT_SECRET"),
                       help="Portal JWT_SECRET (or set env JWT_SECRET)")
        g.add_argument("--jwt-algorithm", default=os.environ.get("JWT_ALGORITHM", "HS256"))
        g.add_argument("--jwt-expire-hours", type=int, default=24)
        g.add_argument("--user-ids", default="",
                       help="Comma-separated real user ids to use as identities")
        g.add_argument("--admin-user-id", default=None,
                       help="A real admin user id; used to mint a bootstrap token and "
                            "list the user pool via GET /auth/admin/users (read-only)")
        g.add_argument("--bootstrap-cookie", default=None,
                       help="A captured mst_token value (its 'sub' seeds discovery)")
        g.add_argument("--no-discover-pool", action="store_true",
                       help="Do not expand the identity pool via /auth/admin/users")
        g.add_argument("--pool-limit", type=int, default=50)
        g.add_argument("--no-auth", action="store_true",
                       help="Public endpoints only; skip all authenticated requests")

    # run
    r = sub.add_parser("run", help="Run a load test", formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    add_conn(r); add_auth(r)
    g = r.add_argument_group("mode (concurrency = virtual users)")
    g.add_argument("--mode", choices=["breakpoint", "steady", "latency", "soak"], default="breakpoint")
    g.add_argument("--start-vus", type=int, default=25, help="breakpoint: starting concurrency")
    g.add_argument("--step-vus", type=int, default=25, help="breakpoint: concurrency added per stage")
    g.add_argument("--max-vus", type=int, default=1000, help="breakpoint: max concurrency to try")
    g.add_argument("--stage-seconds", type=float, default=30.0)
    g.add_argument("--max-error-rate", type=float, default=0.02, help="SLO: max error rate")
    g.add_argument("--max-p95-ms", type=float, default=1500.0, help="SLO: max p95 latency")
    g.add_argument("--no-stop-on-breach", action="store_true")
    g.add_argument("--breach-grace-stages", type=int, default=1)
    g.add_argument("--vus", type=int, default=50, help="steady/soak/latency concurrency")
    g.add_argument("--duration", type=float, default=120.0, help="steady/soak/latency seconds")
    t = r.add_argument_group("traffic")
    t.add_argument("--scenario-ratio", type=float, default=0.6,
                   help="Fraction of work units that are full user journeys")
    t.add_argument("--no-hls", action="store_true", help="Disable HLS streaming load")
    t.add_argument("--hls-segments", type=int, default=6)
    t.add_argument("--think", type=float, default=0.0,
                   help="Mean think-time between steps in seconds (0 = full throttle)")
    s = r.add_argument_group("safety / perf")
    s.add_argument("--max-connections", type=int, default=1000)
    s.add_argument("--count-4xx-as-error", action="store_true")
    s.add_argument("--seed", type=int, default=None)
    s.add_argument("--load-workers", type=int, default=1,
                   help="Fork N generator processes (bypass the GIL) and merge "
                        "results. VUs are split across them. >1 disables the live dashboard.")
    o = r.add_argument_group("output")
    o.add_argument("--out-dir", default="reports")
    o.add_argument("--name", default=None, help="Report file prefix (default: timestamp)")
    o.add_argument("--no-dashboard", action="store_true")

    # check
    c = sub.add_parser("check", help="Smoke check: connectivity, auth, discovery + 5s probe",
                       formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    add_conn(c); add_auth(c)
    c.add_argument("--probe-seconds", type=float, default=5.0)
    c.add_argument("--probe-vus", type=int, default=10)

    # report
    rp = sub.add_parser("report", help="Regenerate HTML/CSV from a saved JSON result")
    rp.add_argument("--json", required=True, help="Path to a results JSON written by `run`")
    rp.add_argument("--out-dir", default=None)
    return p


# ── helpers ───────────────────────────────────────────────────────────────────
def _auth_cfg(args) -> AuthConfig:
    return AuthConfig(
        jwt_secret=args.jwt_secret or "",
        algorithm=args.jwt_algorithm,
        expire_hours=args.jwt_expire_hours,
        user_ids=[u.strip() for u in args.user_ids.split(",") if u.strip()],
        admin_user_id=args.admin_user_id,
        bootstrap_cookie=args.bootstrap_cookie,
        discover_pool=not args.no_discover_pool,
        pool_limit=args.pool_limit,
    )


async def _setup(args, console, *, want_auth: bool):
    """Connectivity check, identity bootstrap, and discovery. Returns (pool, disc)."""
    client = make_client(args.base_url, verify_tls=not args.insecure,
                         http2=args.http2, timeout=args.request_timeout,
                         max_connections=20)
    pool = None
    try:
        # 1) connectivity
        console.print(f"[dim]→ checking {args.base_url}/health …[/]")
        try:
            r = await client.get("/health", timeout=15.0)
            ok = r.status_code == 200
            body = r.json() if "json" in r.headers.get("content-type", "") else {}
            console.print(f"   health: [{'green' if ok else 'red'}]{r.status_code}[/] "
                          f"db={body.get('db',{}).get('ok')}")
        except Exception as e:
            console.print(f"[red]   cannot reach portal: {e}[/]")
            raise SystemExit(2)

        # 2) identity pool
        if want_auth and not args.no_auth:
            if not args.jwt_secret:
                console.print("[yellow]   no --jwt-secret → running public-only[/]")
            else:
                try:
                    pool = await IdentityPool(_auth_cfg(args)).bootstrap(client)
                    console.print(f"   identities: [green]{len(pool)}[/] minted "
                                  f"(pool source resolved)")
                except Exception as e:
                    console.print(f"[yellow]   auth bootstrap failed ({e}); public-only[/]")
                    pool = None
        else:
            console.print("   auth: [dim]disabled (public endpoints only)[/]")

        # 3) discovery
        cookie = pool.identities[0].cookie_header if pool and len(pool) else None
        disc = await Discovery().run(client, identity_cookie=cookie)
        found = {k: len(v) for k, v in disc.pools.items() if v}
        console.print(f"   discovered: {found or '∅'}  ·  videos w/ HLS: "
                      f"{len([v for v in disc.videos if v.get('hls_path')])}")
        return pool, disc
    finally:
        await client.aclose()


def _load_cfg(args) -> LoadConfig:
    mode = args.mode
    vus, duration = args.vus, args.duration
    if mode == "latency":
        vus = args.vus if args.vus != 50 else 5
        duration = args.duration if args.duration != 120.0 else 60.0
    if mode == "soak":
        duration = args.duration if args.duration != 120.0 else 1800.0
    return LoadConfig(
        base_url=args.base_url, mode=mode,
        start_vus=args.start_vus, step_vus=args.step_vus, max_vus=args.max_vus,
        stage_seconds=args.stage_seconds, vus=vus, duration=duration,
        max_error_rate=args.max_error_rate, max_p95_ms=args.max_p95_ms,
        stop_on_breach=not args.no_stop_on_breach,
        breach_grace_stages=args.breach_grace_stages,
        scenario_ratio=args.scenario_ratio, include_hls=not args.no_hls,
        hls_segments=args.hls_segments, think=args.think,
        max_connections=args.max_connections,
        request_timeout=args.request_timeout, http2=args.http2,
        verify_tls=not args.insecure, count_4xx_as_error=args.count_4xx_as_error,
        seed=args.seed,
    )


# ── commands ──────────────────────────────────────────────────────────────────
async def cmd_run(args, console) -> int:
    pool, disc = await _setup(args, console, want_auth=True)
    cfg = _load_cfg(args)

    # Multi-process generation: parent did the setup smoke-check above; children
    # re-bootstrap and run their share. Runs synchronously (own processes).
    if args.load_workers and args.load_workers > 1:
        from loadtest.multi import run_multi
        console.rule(f"[bold]Load run · {cfg.mode} · {args.load_workers} generator processes[/]")
        console.print(f"[dim]→ forking {args.load_workers} workers, splitting VUs across them "
                      f"(live dashboard disabled in multi-process mode)…[/]")
        auth_dict = None if args.no_auth else _auth_cfg(args).__dict__
        results = run_multi(cfg, auth_dict, args.load_workers, no_auth=args.no_auth)
        return _finish_run(results, args, console)

    console.rule(f"[bold]Load run · {cfg.mode}[/]")

    engine = Engine(cfg, pool, disc)
    if not engine.endpoints:
        console.print("[red]No resolvable endpoints discovered — aborting.[/]")
        return 3

    async with engine:
        stop = asyncio.Event()
        dash = None
        if not args.no_dashboard:
            from loadtest.dashboard import live_dashboard
            dash = asyncio.create_task(live_dashboard(engine, stop, console))
        try:
            results = await engine.run()
        finally:
            stop.set()
            if dash:
                await dash

    return _finish_run(results, args, console)


def _finish_run(results, args, console) -> int:
    """Write JSON/CSV/HTML and print the terminal summary."""
    os.makedirs(args.out_dir, exist_ok=True)
    name = args.name or f"stress_{time.strftime('%Y%m%d_%H%M%S')}"
    base = os.path.join(args.out_dir, name)
    rpt.write_json(results, base + ".json")
    rpt.write_csv(results, base + ".csv")
    rpt.write_html(results, base + ".html")

    console.print()
    rpt.terminal_summary(results, console)
    console.print(f"\n[green]Reports written:[/] {base}.html  ·  {base}.json  ·  {base}.csv")
    return 0


async def cmd_check(args, console) -> int:
    pool, disc = await _setup(args, console, want_auth=True)
    cfg = LoadConfig(
        base_url=args.base_url, mode="steady",
        vus=args.probe_vus, duration=args.probe_seconds,
        request_timeout=args.request_timeout, http2=args.http2,
        verify_tls=not args.insecure, seed=1,
    )
    console.rule("[bold]Probe (light load)[/]")
    engine = Engine(cfg, pool, disc)
    if not engine.endpoints:
        console.print("[red]No resolvable endpoints discovered — check the portal has content.[/]")
        return 3
    async with engine:
        results = await engine.run()
    rpt.terminal_summary(results, console)
    console.print("\n[green]Check OK[/] — ready to run a full test.")
    return 0


def cmd_report(args, console) -> int:
    with open(args.json) as f:
        results = json.load(f)
    out_dir = args.out_dir or os.path.dirname(os.path.abspath(args.json))
    base = os.path.join(out_dir, os.path.splitext(os.path.basename(args.json))[0])
    rpt.write_html(results, base + ".html")
    rpt.write_csv(results, base + ".csv")
    rpt.terminal_summary(results, console)
    console.print(f"\n[green]Regenerated:[/] {base}.html  ·  {base}.csv")
    return 0


def main() -> int:
    args = build_parser().parse_args()
    console = _console()
    try:
        if args.cmd == "run":
            return asyncio.run(cmd_run(args, console))
        if args.cmd == "check":
            return asyncio.run(cmd_check(args, console))
        if args.cmd == "report":
            return cmd_report(args, console)
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted.[/]")
        return 130
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
