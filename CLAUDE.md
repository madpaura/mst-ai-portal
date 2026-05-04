# MST AI Portal — Claude Code Guide

## Project overview

Corporate AI learning and tools portal. Three main sections:
- **Ignite** — HLS video library with courses, chapters, transcripts, CC, auto-mode LLM pipeline
- **Solutions** — solution card showcase (SW/HW/Other categories, filterable)
- **Forge** — scheduled content/digest automation, RSS ingestion, newsletter emails

Stack: FastAPI (Python) + React 19 (TypeScript) + PostgreSQL + Nginx + Docker Compose.

---

## Repo layout

```
mst-ai-portal/
├── api/                    # FastAPI backend
│   ├── main.py             # App factory, router mounts, lifespan (runs alembic on startup)
│   ├── config.py           # Pydantic Settings (reads .env)
│   ├── database.py         # asyncpg pool helpers (get_db, init_db)
│   ├── alembic/versions/   # Migrations — always add a new file, never edit old ones
│   ├── auth/               # JWT + SAML + LDAP auth
│   ├── video/              # Ignite video CRUD, auto-mode, course management
│   ├── worker/             # transcoder.py, auto_processor.py (run as separate containers)
│   ├── solutions/          # Solution cards + news feed CRUD
│   ├── articles/           # Knowledge articles
│   ├── forge/              # Scheduler, digest, sync worker
│   ├── settings/           # SMTP, admin settings, probe endpoint
│   ├── analytics/          # Page-view tracking
│   └── email_utils/        # SMTP helpers, digest templates
├── react-portal/           # Vite + React frontend
│   └── src/
│       ├── pages/          # AdminVideos, AdminSolutions, Solutions, Ignite, …
│       ├── components/     # HlsPlayer, Navbar, IgniteSidebar, …
│       ├── api/client.ts   # Typed fetch wrapper (api.get/post/put/delete)
│       └── index.css       # Tailwind + custom animations
├── transcript-service/     # Standalone FastAPI service — Whisper inference over SSE
├── db/init.sql             # Schema for fresh installs
├── docker-compose.yml      # Core services (db, backend, worker, auto-processor, frontend)
├── docker-compose.gpu.yml  # GPU override for worker (NVENC)
├── docker-compose.transcript.yml     # CPU Whisper service
├── docker-compose.transcript.gpu.yml # GPU Whisper service
└── .env.example            # All environment variables with comments
```

---

## Running locally (without Docker)

```bash
# Backend
cd api
pip install -r requirements.txt
alembic upgrade head
uvicorn main:app --reload --port 9800

# Auto-processor worker (separate terminal)
python worker/auto_processor.py

# Transcoder worker (separate terminal)
python worker/transcoder.py

# Frontend
cd react-portal
npm install
npm run dev          # dev server on :5173, proxies /backend → :9800
```

## Running with Docker

```bash
cp .env.example .env   # then edit .env
./setup.sh deploy      # builds images, detects GPU, starts compose stack
```

Or manually:
```bash
docker compose up -d --build
```

GPU variants: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d`

---

## Key environment variables

See `.env.example` for the full list with inline docs. Critical ones:

| Variable | Default | Notes |
|---|---|---|
| `AUTH_MODE` | `open` | `open` \| `ldap` \| `saml` |
| `JWT_SECRET` | *(insecure)* | Must be changed in production |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | For LLM auto-mode |
| `FFMPEG_HWACCEL` | `auto` | `auto` detects NVIDIA GPU, `none` forces CPU |
| `TRANSCRIPT_MOCK` | `false` | Set `true` to skip Whisper for testing |
| `AUTO_PROCESSOR_CONCURRENCY` | `4` | Parallel job workers |
| `TRANSCRIPT_PORT` | `9100` | Whisper service port |
| `VITE_API_URL` | `http://localhost:9800` | Build-time baked into frontend |

---

## Backend conventions

### Database access
Use `db = await get_db()` to get the asyncpg connection pool. All queries are raw SQL:
```python
row  = await db.fetchrow("SELECT * FROM videos WHERE id = $1", video_id)
rows = await db.fetch("SELECT * FROM videos ORDER BY sort_order")
val  = await db.fetchval("SELECT COUNT(*) FROM videos WHERE course_id = $1", cid)
await db.execute("UPDATE videos SET title=$2 WHERE id=$1", video_id, new_title)
```

### Adding a migration
Create `api/alembic/versions/NNNN_description.py`. Use the highest existing number + 1. Migrations run automatically on backend startup via `alembic upgrade head`. Always use `IF NOT EXISTS` / `IF EXISTS` guards so migrations are idempotent:
```python
op.execute("ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar TEXT DEFAULT 'x'")
```

### Routers
All admin endpoints live under `/admin` prefix. Public endpoints mount without prefix. Authentication:
- `require_admin` — role=admin only
- `require_content` — role=content or admin
- No dependency — public

### Auto-mode pipeline (video processing)
`worker/auto_processor.py` polls `auto_jobs` table with `SELECT ... FOR UPDATE SKIP LOCKED`. Job kinds: `transcript`, `metadata`, `chapters`, `howto`. Multiple concurrent workers via `asyncio.gather`. Transcript is fetched over SSE from the transcript-service at `http://transcript-service:9100`.

### LLM prompts
All prompts live in `api/video/llm_prompts.py`. They return strict JSON. Always call `parse_json_strict()` on LLM output. Chapter post-processing is done in `_enforce_chapters()` in `auto_processor.py`.

---

## Frontend conventions

### API calls
Use the typed wrapper in `src/api/client.ts`:
```typescript
const data = await api.get<MyType>('/admin/some-endpoint');
await api.post('/admin/some-endpoint', payload);
await api.put(`/admin/items/${id}`, payload);
await api.delete(`/admin/items/${id}`);
```
Authentication is via httpOnly cookie — no Bearer header needed.

### Stale poll / stale closure pattern
When a component polls for status on a selected item, always guard against navigation away mid-poll using a `useRef`:
```typescript
const activeItemIdRef = useRef<string | null>(null);

const startPoll = (id: string) => {
  const poll = async () => {
    if (activeItemIdRef.current !== id) { clearInterval(timer); return; }
    const data = await api.get(...);
    if (activeItemIdRef.current !== id) return;  // check again after await
    setState(data);
  };
  const timer = setInterval(poll, 4000);
  poll();
};

const selectItem = (item) => {
  activeItemIdRef.current = item.id;  // must set before starting poll
  setState(null);
  // ...
};
```
This pattern is applied in `AdminVideos.tsx` for both `autoStatusPollRef` and `transcriptProgressPollRef`.

### HLS player (HlsPlayer.tsx)
- Accepts `hlsPath`, `captionsUrl`, `chapters`, `onTimeUpdate`, `autoPlay`
- CC track: fetched as blob URL (CORS workaround). Always add `key={blobCaptionsUrl}` to `<track>` so it force-remounts when the video changes.
- Exposes a `ref` handle with `getCurrentTime()`, `seekTo()`, `getDuration()`.

### Styling
Tailwind CSS. Dark mode via `dark:` prefix. Primary colour = `text-primary` / `bg-primary` (blue). Glass-card pattern: `glass-card` class. Material Symbols Outlined for icons (`<span className="material-symbols-outlined">icon_name</span>`).

---

## Workers

| Container | Command | Purpose |
|---|---|---|
| `worker` | `python worker/transcoder.py` | Polls `jobs` table, runs ffmpeg transcode/trim/cut |
| `auto-processor` | `python worker/auto_processor.py` | Transcript → metadata/chapters/howto LLM pipeline |
| `transcript-service` | uvicorn in its own container | Whisper inference, SSE streaming, job queue |

Workers communicate with the DB directly (asyncpg). The auto-processor communicates with transcript-service over HTTP (`TRANSCRIPT_SERVICE_URL` env or derived from `TRANSCRIPT_PORT`).

---

## FFmpeg notes

- **Transcode**: full re-encode to HLS with quality ladder (1080p/720p/480p)
- **Trim / Cut**: use `-c copy` with input seek (`-ss` before `-i`) for near-instant operation — no re-encode
- GPU acceleration: NVENC when `FFMPEG_HWACCEL=auto` and GPU is present; falls back to libx264
- `_run_ffmpeg_async()` in `api/video/admin_router.py` wraps ffmpeg as a non-blocking subprocess

---

## Auth modes

| Mode | Notes |
|---|---|
| `open` | Local username/password. Default admin seeded from `SEED_DEFAULT_ADMIN` |
| `ldap` | Bind against LDAP with `LDAP_URL` + `LDAP_BASE_DN` |
| `saml` | ADFS / SAML 2.0. Configure `SAML_*` vars. AD group → role mapping via `SAML_GROUP_ROLE_MAP` |

JWT is stored in an httpOnly cookie (not localStorage). Frontend never touches it directly.

---

## Roles

| Role | Access |
|---|---|
| `user` | View published content, Ignite, Solutions, Forge |
| `content` | Upload videos, create articles, manage courses |
| `admin` | Everything including settings, analytics, digest, delete |

---

## Common tasks

### Add a new admin page
1. Create `react-portal/src/pages/AdminFoo.tsx`
2. Add route in `App.tsx` under `/admin/foo`
3. Add nav link in `AdminLayout.tsx`
4. Create `api/foo/admin_router.py` + mount in `main.py` under `/admin`

### Add a DB column
1. Write `api/alembic/versions/NNNN_add_foo_column.py` with `IF NOT EXISTS` guard
2. Update the Pydantic schema in the relevant `schemas.py` or `admin_schemas.py`
3. Update the `_row_to_*` helper to read the new column
4. Update INSERT/UPDATE field lists in the router

### Add a solution card field
- Schema: `api/solutions/admin_schemas.py` — all three classes (`Response`, `Create`, `Update`)
- Router: `_row_to_card()`, INSERT columns/values, UPDATE field list in `api/solutions/admin_router.py`
- Frontend interface: `SolutionCard` in both `Solutions.tsx` and `AdminSolutions.tsx`
