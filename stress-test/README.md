# MST AI Portal — Stress Test Suite

A self-contained, asyncio-based **read-only** load generator for the portal.
It authenticates virtual users against a **SAML/ADFS-protected** deployment by
minting the same `mst_token` JWT the portal would issue — no IdP round-trip, no
browser automation, no synthetic users in the database. It ramps offered load to
find the **breaking point**, simulates **HLS video streaming**, exercises
realistic **user journeys**, and writes a rich **HTML / JSON / CSV** report plus
a live terminal dashboard.

Run it from any machine that can reach the portal.

---

## Why JWT minting (and why it's safe)

Every authenticated request the portal serves is gated only on a JWT — the
`mst_token` cookie (or `Authorization: Bearer`) — signed with `JWT_SECRET` and
resolved to a user row by its `sub` claim. The ADFS browser-redirect + Windows
login flow **cannot be scripted at scale**, and you don't need it: you're load
testing the *portal*, not ADFS. So the suite mints valid JWTs locally.

Because `get_current_user` looks the `sub` up in the `users` table, the `sub`
must be a **real** user id. In read-only mode the suite never creates users — it
mints one admin token and reads the existing pool via `GET /auth/admin/users`
(a pure read), then cycles those identities across virtual users.

**Read-only guarantee:** the endpoint catalog contains only non-mutating GETs.
Analytics page-view/event writes, meme click-redirects, the Forge download
counter, and all progress/notes/likes writes are deliberately excluded. Safe to
point at production.

---

## Install

```bash
cd stress-test
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

---

## Quick start

```bash
export JWT_SECRET='the-portals-jwt-secret'

# 1) Smoke check — connectivity, auth bootstrap, discovery, 5s probe
./stressctl.py check --base-url https://portal.corp --admin-user-id <a-real-admin-user-id>

# 2) Breaking-point ramp (default mode)
./stressctl.py run  --base-url https://portal.corp --admin-user-id <admin-id> --name nightly

# 3) Public-only steady soak (no auth)
./stressctl.py run  --base-url https://portal.corp --no-auth --mode steady --rps 80 --duration 300
```

Reports land in `reports/<name>.{html,json,csv}`. Open the HTML in any browser.

---

## Authenticating the virtual users

Pick whichever identity source you have. All require `--jwt-secret` (or env
`JWT_SECRET`) unless you go `--no-auth`.

| Flag | What it does |
|---|---|
| `--admin-user-id <id>` | Mint a bootstrap admin token from this real id, list the user pool via `/auth/admin/users`, cycle those identities. **Recommended.** |
| `--bootstrap-cookie <mst_token>` | Use a captured `mst_token` (e.g. copied from your browser after a real ADFS login). Its `sub` seeds discovery; if it's an admin, the full pool is fetched. |
| `--user-ids id1,id2,...` | Use an explicit list of real user ids as identities. |
| `--no-auth` | Skip all authenticated endpoints; hit public routes only. |
| `--no-discover-pool` | Don't expand the pool via `/auth/admin/users`; use only what you passed. |

> Finding a user id: log in once, then `GET /auth/me`, or read it from the
> `sub` of your browser's `mst_token` cookie.

---

## Modes

| `--mode` | Purpose | Key flags |
|---|---|---|
| `breakpoint` *(default)* | Ramp offered load until SLOs breach; report max sustainable rps | `--start-rps --step-rps --max-rps --stage-seconds --max-error-rate --max-p95-ms` |
| `steady` | Hold a fixed rate for a fixed time | `--rps --duration` |
| `latency` | Low-load latency profiling (p50/p95/p99) | `--rps --duration` (defaults 10 rps / 60 s) |
| `soak` | Long steady run to surface leaks / pool exhaustion | `--rps --duration` (default 1800 s) |

**Breaking point** is found with an *open model*: the pacer offers `target_rps`
work units per second regardless of server speed, so when the portal saturates,
latency and in-flight count climb. A stage *passes* when
`error_rate ≤ --max-error-rate` **and** `p95 ≤ --max-p95-ms`. The highest passing
stage is the sustainable load; the first failing stage is the breach.

---

## Traffic shape

- `--scenario-ratio 0.5` — half the work units are full user journeys
  (browse → open video → stream), half are single weighted endpoint hits.
- `--no-hls` — disable HLS streaming load. By default a streamable video is
  discovered and its master manifest → variant → `.ts` segments are fetched.
- `--hls-segments 6` — segments pulled per streaming session.
- `--think-scale 0` — multiply scenario think-times (0 = full throttle, 1 = realistic pauses).

## Safety / performance knobs

- `--max-inflight 2000` — ceiling on concurrent in-flight units (protects the
  load box; work shed at the ceiling is counted and signals saturation).
- `--max-connections 1000` — HTTP connection-pool size.
- `--request-timeout 30` · `--insecure` (skip TLS verify) · `--http2`.

> **Driving very high load (≈10k):** raise the file-descriptor limit on the load
> box (`ulimit -n 65535`), increase `--max-connections`, and consider running
> several `stressctl` processes across machines against the same target, then
> merging their JSON reports.

---

## Output

- **Live dashboard** — offered vs actual rps, error %, stage p95, in-flight, shed.
- **HTML report** — KPI cards, breaking-point banner, timeline charts (rps /
  latency / errors / in-flight), per-stage table, p95-by-endpoint bars,
  per-endpoint latency & error table, error breakdown. Self-contained (inline
  SVG, no CDN).
- **JSON** — full machine-readable results (re-render with `report` subcommand).
- **CSV** — per-endpoint latency/error table for spreadsheets.

```bash
./stressctl.py report --json reports/nightly.json   # rebuild HTML/CSV from JSON
```

---

## What it exercises

Ignite (video list/detail/courses/chapters/attachments/howto/likes, HLS
streaming), Solutions (landing/cards/news/capabilities), Articles, Forge
components, Memes, Search (`/search`, `/search/suggest`), `/health`, and
authenticated reads (`/auth/me`, `/video/progress|bookmarks|playlists|my-courses`,
`/articles/my`, `/assistant/enabled`).
