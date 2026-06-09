"""MST AI Portal stress-test toolkit.

A self-contained, asyncio-based load generator for the portal's read-only
endpoints, plus a breaking-point ramp controller and rich HTML/JSON/CSV reports.

Modules:
  auth      — mint mst_token JWTs from JWT_SECRET, bootstrap a real user-id pool
  catalog   — the read-only endpoint catalog + discovery of real ids/slugs
  client    — async HTTP worker + per-request timing
  metrics   — latency histograms, percentiles, per-second timeline, aggregation
  hls       — HLS streaming-load simulation (manifest + segment fan-out)
  scenarios — weighted user-journey definitions
  engine    — concurrency / arrival-rate control, ramp + breaking-point logic
  report    — HTML / JSON / CSV writers and the terminal summary
  dashboard — live terminal dashboard during a run
"""

__version__ = "1.0.0"
