"""Live terminal dashboard rendered while a load run is in progress."""
from __future__ import annotations

import asyncio
import time
from typing import List


_SPARK = " ▁▂▃▄▅▆▇█"


def _sparkline(values: List[float], width: int = 40) -> str:
    if not values:
        return ""
    vals = values[-width:]
    vmax = max(vals) or 1
    return "".join(_SPARK[min(len(_SPARK) - 1, int(v / vmax * (len(_SPARK) - 1)))] for v in vals)


async def live_dashboard(engine, stop_event: asyncio.Event, console) -> None:
    """Render engine.status at ~4 Hz until stop_event is set."""
    from rich.live import Live
    from rich.table import Table
    from rich.panel import Panel
    from rich.console import Group

    rps_hist: List[float] = []
    start = time.time()

    def render():
        s = engine.status
        rps_hist.append(s.get("rps", 0.0))
        spark = _sparkline(rps_hist)
        elapsed = int(time.time() - start)

        t = Table.grid(padding=(0, 2))
        t.add_column(justify="right", style="dim")
        t.add_column()
        phase = s.get("phase", "")
        stage = s.get("stage", 0)
        t.add_row("phase", f"[cyan]{phase}[/]  stage [bold]{stage}[/]  ·  elapsed {elapsed}s")
        t.add_row("users", f"[bold]{s.get('vus',0)}[/] concurrent")
        t.add_row("throughput", f"[bold green]{s.get('rps',0):.0f}[/] rps   {spark}")
        err = s.get("err_rate", 0.0)
        ecolor = "red" if err > engine.cfg.max_error_rate else "green"
        t.add_row("errors", f"[{ecolor}]{err*100:.2f}%[/]")
        p95 = s.get("p95", 0.0)
        pcolor = "red" if p95 > engine.cfg.max_p95_ms else "yellow"
        t.add_row("p95", f"[{pcolor}]{p95:.0f} ms[/]  (stage)")
        t.add_row("in-flight", f"{s.get('inflight',0)} requests")
        t.add_row("total", f"{s.get('total',0):,} reqs")
        return Panel(t, title="MST AI Portal — live load", border_style="cyan")

    with Live(render(), console=console, refresh_per_second=4, transient=False) as live:
        while not stop_event.is_set():
            live.update(render())
            await asyncio.sleep(0.25)
        live.update(render())
