"""Report writers: JSON, CSV, a self-contained HTML report, and a terminal summary.

The HTML report embeds inline SVG charts (no external JS/CDN) so it renders
offline on any machine.
"""
from __future__ import annotations

import csv
import html
import json
import time
from typing import Dict, List, Optional


# ── JSON ──────────────────────────────────────────────────────────────────────
def write_json(results: Dict, path: str) -> None:
    with open(path, "w") as f:
        json.dump(results, f, indent=2, default=str)


# ── CSV (per-endpoint table) ──────────────────────────────────────────────────
def write_csv(results: Dict, path: str) -> None:
    cols = ["label", "requests", "ok", "errors", "error_rate", "min_ms", "mean_ms",
            "p50_ms", "p90_ms", "p95_ms", "p99_ms", "max_ms", "mbytes"]
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for label, d in sorted(results["by_label"].items()):
            w.writerow([
                label, d["requests"], d["ok"], d["errors"], d["error_rate"],
                d["min_ms"], d["mean_ms"], d["p50_ms"], d["p90_ms"],
                d["p95_ms"], d["p99_ms"], d["max_ms"],
                round(d.get("bytes", 0) / 1e6, 2),
            ])


# ── SVG helpers ───────────────────────────────────────────────────────────────
def _svg_line(rows: List[dict], key: str, *, color: str, w=900, h=180,
              label: str = "", y_max: Optional[float] = None) -> str:
    if not rows:
        return f'<svg width="{w}" height="{h}"></svg>'
    xs = [r["t"] for r in rows]
    ys = [r.get(key, 0) for r in rows]
    ymax = y_max if y_max else (max(ys) or 1)
    xmax = max(xs) or 1
    pad = 30
    pts = []
    for r in rows:
        x = pad + (r["t"] / xmax) * (w - 2 * pad)
        y = (h - pad) - (r.get(key, 0) / ymax) * (h - 2 * pad)
        pts.append(f"{x:.1f},{y:.1f}")
    polyline = " ".join(pts)
    grid = ""
    for frac in (0.25, 0.5, 0.75, 1.0):
        gy = (h - pad) - frac * (h - 2 * pad)
        grid += (f'<line x1="{pad}" y1="{gy:.0f}" x2="{w-pad}" y2="{gy:.0f}" '
                 f'stroke="#1e293b" stroke-width="1"/>'
                 f'<text x="4" y="{gy+4:.0f}" fill="#64748b" font-size="10">'
                 f'{ymax*frac:.0f}</text>')
    return (f'<svg width="{w}" height="{h}" style="background:#0b1220;border-radius:8px">'
            f'{grid}<polyline points="{polyline}" fill="none" stroke="{color}" '
            f'stroke-width="2"/>'
            f'<text x="{pad}" y="16" fill="#cbd5e1" font-size="12">{html.escape(label)}</text>'
            f'</svg>')


def _svg_bars(items: List[tuple], *, color="#258cf4", w=900, bar_h=18,
              unit="ms") -> str:
    if not items:
        return ""
    vmax = max(v for _, v in items) or 1
    pad_left = 220
    rows_h = len(items) * (bar_h + 6) + 10
    out = [f'<svg width="{w}" height="{rows_h}" style="background:#0b1220;border-radius:8px">']
    y = 8
    for name, v in items:
        bw = (v / vmax) * (w - pad_left - 70)
        out.append(
            f'<text x="8" y="{y+bar_h-4}" fill="#cbd5e1" font-size="11">{html.escape(name)}</text>'
            f'<rect x="{pad_left}" y="{y}" width="{bw:.0f}" height="{bar_h}" '
            f'rx="3" fill="{color}"/>'
            f'<text x="{pad_left+bw+6:.0f}" y="{y+bar_h-4}" fill="#94a3b8" '
            f'font-size="10">{v:.0f}{unit}</text>'
        )
        y += bar_h + 6
    out.append("</svg>")
    return "".join(out)


def _badge(text: str, ok: bool) -> str:
    color = "#22c55e" if ok else "#ef4444"
    return (f'<span style="background:{color}22;color:{color};padding:2px 10px;'
            f'border-radius:999px;font-size:12px;font-weight:600">{html.escape(text)}</span>')


# ── HTML ──────────────────────────────────────────────────────────────────────
def write_html(results: Dict, path: str, *, title: str = "MST AI Portal — Stress Test Report") -> None:
    ov = results["overall"]
    cfg = results["config"]
    bp = results.get("breaking_point")
    stages = results.get("stages", [])
    timeline = results.get("timeline", [])
    by_label = results["by_label"]

    # KPI cards
    kpis = [
        ("Total requests", f'{ov["requests"]:,}'),
        ("Throughput", f'{ov["throughput_rps"]:.0f} req/s'),
        ("Error rate", f'{ov["error_rate"]*100:.2f}%'),
        ("p50 / p95 / p99", f'{ov["p50_ms"]:.0f} / {ov["p95_ms"]:.0f} / {ov["p99_ms"]:.0f} ms'),
        ("Max latency", f'{ov["max_ms"]:.0f} ms'),
        ("Data transferred", f'{ov["mbytes"]:.1f} MB'),
        ("Duration", f'{ov["duration_s"]:.0f} s'),
        ("Identities", f'{results.get("identities", 0)}'),
    ]
    kpi_html = "".join(
        f'<div class="kpi"><div class="kpi-v">{html.escape(v)}</div>'
        f'<div class="kpi-l">{html.escape(k)}</div></div>'
        for k, v in kpis
    )

    # Breaking point banner
    bp_html = ""
    if bp:
        vus = bp.get("sustainable_vus")
        rps = bp.get("sustainable_rps")
        breach = bp.get("first_breach_vus")
        reason = bp.get("breach_reason")
        bp_html = (
            '<div class="card"><h2>Breaking point</h2>'
            f'<p style="font-size:15px">Max <b>sustainable</b> concurrency '
            f'(error ≤ {cfg["max_error_rate"]*100:.1f}% and p95 ≤ {cfg["max_p95_ms"]:.0f}ms): '
            f'<b style="color:#22c55e">{vus if vus is not None else "—"} concurrent users</b>'
            + (f' (~{rps:.0f} req/s)' if rps else '')
            + (f' &nbsp;·&nbsp; first breach at <b style="color:#ef4444">{breach} users</b> '
               f'(<i>{reason}</i>)' if breach else ' &nbsp;·&nbsp; <b>no breach reached</b>')
            + '</p></div>'
        )

    # Stage table
    stage_rows = ""
    for s in stages:
        stage_rows += (
            f'<tr><td>{s["index"]}</td><td>{s["vus"]}</td>'
            f'<td>{s["achieved_rps"]:.0f}</td><td>{s["requests"]:,}</td>'
            f'<td>{s["error_rate"]*100:.2f}%</td><td>{s["p50_ms"]:.0f}</td>'
            f'<td>{s["p95_ms"]:.0f}</td><td>{s["p99_ms"]:.0f}</td>'
            f'<td>{_badge("PASS" if s["passed"] else "BREACH", s["passed"])}</td></tr>'
        )
    stage_table = ""
    if stages:
        stage_table = (
            '<div class="card"><h2>Ramp stages</h2><table><thead><tr>'
            '<th>#</th><th>Concurrent users</th><th>Throughput rps</th><th>Requests</th>'
            '<th>Errors</th><th>p50</th><th>p95</th><th>p99</th><th>SLO</th>'
            '</tr></thead><tbody>' + stage_rows + '</tbody></table></div>'
        )

    # Charts
    rps_chart = _svg_line(timeline, "rps", color="#258cf4", label="Requests / second")
    err_chart = _svg_line(timeline, "errors", color="#ef4444", label="Errors / second")
    lat_chart = _svg_line(timeline, "avg_ms", color="#f59e0b", label="Avg latency (ms)")
    inflight_chart = _svg_line(timeline, "inflight", color="#a855f7", label="In-flight units")

    # Per-endpoint bars (p95) and error table
    p95_items = sorted(((k, d["p95_ms"]) for k, d in by_label.items()),
                       key=lambda x: -x[1])
    p95_bars = _svg_bars(p95_items, color="#258cf4", unit="ms")

    # Per-endpoint table
    ep_rows = ""
    for label, d in sorted(by_label.items(), key=lambda x: -x[1]["requests"]):
        errcolor = "#ef4444" if d["error_rate"] > cfg["max_error_rate"] else "#94a3b8"
        ep_rows += (
            f'<tr><td>{html.escape(label)}</td><td>{d["requests"]:,}</td>'
            f'<td style="color:{errcolor}">{d["error_rate"]*100:.2f}%</td>'
            f'<td>{d["p50_ms"]:.0f}</td><td>{d["p95_ms"]:.0f}</td>'
            f'<td>{d["p99_ms"]:.0f}</td><td>{d["max_ms"]:.0f}</td>'
            f'<td>{d.get("mbytes", round(d.get("bytes",0)/1e6,2))}</td></tr>'
        )
    ep_table = (
        '<div class="card"><h2>Per-endpoint latency &amp; errors</h2>'
        '<table><thead><tr><th>Endpoint</th><th>Requests</th><th>Error %</th>'
        '<th>p50</th><th>p95</th><th>p99</th><th>Max</th><th>MB</th></tr></thead>'
        '<tbody>' + ep_rows + '</tbody></table></div>'
    )

    # Error breakdown
    err_kinds: Dict[str, int] = {}
    for d in by_label.values():
        for k, v in d.get("error_kinds", {}).items():
            err_kinds[k] = err_kinds.get(k, 0) + v
    err_html = ""
    if err_kinds:
        rows = "".join(f'<tr><td>{html.escape(k)}</td><td>{v:,}</td></tr>'
                       for k, v in sorted(err_kinds.items(), key=lambda x: -x[1]))
        err_html = ('<div class="card"><h2>Error breakdown</h2><table><thead><tr>'
                    '<th>Kind</th><th>Count</th></tr></thead><tbody>' + rows +
                    '</tbody></table></div>')

    cfg_html = "".join(
        f'<tr><td>{html.escape(str(k))}</td><td>{html.escape(str(v))}</td></tr>'
        for k, v in cfg.items()
    )

    generated = time.strftime("%Y-%m-%d %H:%M:%S")
    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<style>
  body{{font-family:Inter,system-ui,Segoe UI,sans-serif;background:#070b11;color:#e2e8f0;margin:0;padding:32px}}
  h1{{font-size:24px;margin:0 0 4px}} h2{{font-size:16px;margin:0 0 14px;color:#93c5fd}}
  .sub{{color:#64748b;font-size:13px;margin-bottom:24px}}
  .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}}
  .kpi{{background:#0e1726;border:1px solid #1e293b;border-radius:10px;padding:16px}}
  .kpi-v{{font-size:20px;font-weight:700;color:#fff}} .kpi-l{{font-size:12px;color:#64748b;margin-top:4px}}
  .card{{background:#0e1726;border:1px solid #1e293b;border-radius:12px;padding:20px;margin-bottom:20px}}
  .charts{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}
  table{{width:100%;border-collapse:collapse;font-size:13px}}
  th,td{{text-align:left;padding:7px 10px;border-bottom:1px solid #16202e}}
  th{{color:#64748b;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}}
  tr:hover td{{background:#111c2c}} svg{{max-width:100%}}
  @media(max-width:800px){{.charts{{grid-template-columns:1fr}}}}
</style></head><body>
<h1>{html.escape(title)}</h1>
<div class="sub">Target: {html.escape(str(cfg["base_url"]))} &nbsp;·&nbsp; mode: <b>{html.escape(str(cfg["mode"]))}</b>
 &nbsp;·&nbsp; generated {generated} &nbsp;·&nbsp; read-only suite</div>
<div class="grid">{kpi_html}</div>
{bp_html}
<div class="card"><h2>Load timeline</h2><div class="charts">
  {rps_chart}{lat_chart}{err_chart}{inflight_chart}
</div></div>
{stage_table}
<div class="card"><h2>p95 latency by endpoint</h2>{p95_bars}</div>
{ep_table}
{err_html}
<div class="card"><h2>Run configuration</h2><table><tbody>{cfg_html}</tbody></table></div>
<div class="sub">MST AI Portal · stress-test suite · all endpoints are read-only GETs</div>
</body></html>"""
    with open(path, "w") as f:
        f.write(doc)


# ── Terminal summary (rich) ───────────────────────────────────────────────────
def terminal_summary(results: Dict, console) -> None:
    from rich.table import Table
    from rich.panel import Panel
    from rich import box

    ov = results["overall"]
    bp = results.get("breaking_point")

    head = (
        f"[bold]Requests[/] {ov['requests']:,}   "
        f"[bold]Throughput[/] {ov['throughput_rps']:.0f} rps   "
        f"[bold]Errors[/] {ov['errors']:,} ({ov['error_rate']*100:.2f}%)   "
        f"[bold]Data[/] {ov['mbytes']:.1f} MB   "
        f"[bold]Dur[/] {ov['duration_s']:.0f}s\n"
        f"[bold]Latency ms[/]  p50 {ov['p50_ms']:.0f}   p90 {ov['p90_ms']:.0f}   "
        f"p95 {ov['p95_ms']:.0f}   p99 {ov['p99_ms']:.0f}   max {ov['max_ms']:.0f}"
    )
    console.print(Panel(head, title="Overall", border_style="cyan"))

    if bp:
        vus = bp.get("sustainable_vus")
        rps = bp.get("sustainable_rps")
        b = bp.get("first_breach_vus")
        msg = f"Sustainable concurrency: [bold green]{vus if vus is not None else '—'} users[/]"
        if rps:
            msg += f" ([green]~{rps:.0f} rps[/])"
        if b:
            msg += f"   ·   first breach @ [bold red]{b} users[/] ([i]{bp.get('breach_reason')}[/])"
        else:
            msg += "   ·   no breach reached within ramp"
        console.print(Panel(msg, title="Breaking point", border_style="magenta"))

    if results.get("stages"):
        t = Table(title="Ramp stages", box=box.SIMPLE_HEAVY, header_style="dim")
        for c in ("#", "users", "rps", "reqs", "err%", "p50", "p95", "p99", "SLO"):
            t.add_column(c, justify="right")
        for st in results["stages"]:
            slo = "[green]PASS[/]" if st["passed"] else "[red]BREACH[/]"
            t.add_row(str(st["index"]), str(st["vus"]), f"{st['achieved_rps']:.0f}",
                      f"{st['requests']:,}", f"{st['error_rate']*100:.2f}",
                      f"{st['p50_ms']:.0f}", f"{st['p95_ms']:.0f}",
                      f"{st['p99_ms']:.0f}", slo)
        console.print(t)

    t = Table(title="Top endpoints by traffic", box=box.SIMPLE_HEAVY, header_style="dim")
    for c in ("endpoint", "reqs", "err%", "p50", "p95", "p99", "max"):
        t.add_column(c, justify="right")
    t.columns[0].justify = "left"
    items = sorted(results["by_label"].items(), key=lambda x: -x[1]["requests"])[:15]
    for label, d in items:
        errstyle = "red" if d["error_rate"] > 0.02 else "white"
        t.add_row(label, f"{d['requests']:,}",
                  f"[{errstyle}]{d['error_rate']*100:.2f}[/]",
                  f"{d['p50_ms']:.0f}", f"{d['p95_ms']:.0f}",
                  f"{d['p99_ms']:.0f}", f"{d['max_ms']:.0f}")
    console.print(t)
