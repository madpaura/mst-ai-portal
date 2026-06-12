# MST AI Portal

Corporate AI learning and tools portal — video courses, solutions showcase, component marketplace, news feed, and site-wide search. Deployed as a self-contained Docker stack.

---

## Features at a glance

- **Ignite** — HLS video library with courses, chapters, AI-generated transcripts, closed captions, auto-metadata pipeline, and per-creator content isolation; **browse/discovery UI** with featured hero, discover modes (Trending, Top Rated, Recently Added), custom playlists, bookmarks, and in-page fuzzy search
- **Solutions** — filterable solution card showcase (SW / HW / Other)
- **Marketplace** — agent, skill, and MCP server registry with GitHub sync, type-aware install guides, zip download, contributor submission workflow, version history, and lifecycle management (MANIFEST.json, artifact deletion)
- **Discover** — Articles, Memes (with click analytics), News feed with RSS/ingest support
- **Search** — site-wide full-text + fuzzy typo-tolerant search across all content types
- **AI Assistant** — floating chat widget with 21 portal-aware tools, multi-provider LLM (Ollama/OpenAI/Anthropic), admin-configurable system prompt
- **Publish Authority** — content creator submit-for-review workflow with email approve/decline
- **Admin panel** — content management, analytics, digest scheduling, SMTP, and portal settings
- **Auth** — local (`open`), LDAP, or SAML 2.0 / ADFS
- **Themes** — Default (glass/neon) and Simple (GitHub-inspired flat), token-driven CSS variable system

See [features.md](features.md) for a detailed feature breakdown.

---

## Quick start (Docker)

### 1. Prerequisites

- Docker 24+ with Docker Compose v2
- 20 GB+ free disk space
- NVIDIA GPU + `nvidia-container-toolkit` (optional — enables GPU transcoding and faster Whisper)

### 2. Clone and configure

```bash
git clone <repository-url>
cd mst-ai-portal
cp .env.example .env
# Edit .env — at minimum change JWT_SECRET and POSTGRES_PASSWORD
```

### 3. Deploy

```bash
./setup.sh deploy
```

`setup.sh` checks prerequisites, detects a GPU, selects the right Compose files, builds images, and starts the stack.

### 4. Access

| Service | URL |
|---|---|
| Portal | http://localhost:9810 |
| Backend API | http://localhost:9800 |
| API docs | http://localhost:9800/docs |
| Admin panel | http://localhost:9810/admin/videos |
| Transcript service | http://localhost:9100 |

Default login: **admin / admin** (change immediately in production)

---

## Setup script reference

```bash
./setup.sh check       # Verify prerequisites (default)
./setup.sh deploy      # Build and start all containers
./setup.sh down        # Stop all containers
./setup.sh logs <svc>  # Follow logs: backend | worker | auto-processor | transcript-service | frontend | db
./setup.sh migrate     # Run Alembic migrations inside the running backend
./setup.sh setup-gpu   # Install nvidia-container-toolkit for GPU transcoding
```

---

## Architecture

```
mst-ai-portal/
├── api/                    # FastAPI backend (Python)
│   ├── main.py             # App factory, router mounts, lifespan migrations
│   ├── config.py           # Pydantic Settings (reads .env)
│   ├── database.py         # asyncpg pool helpers
│   ├── alembic/versions/   # Incremental DB migrations (run on startup)
│   ├── auth/               # JWT + SAML + LDAP
│   ├── video/              # Ignite video CRUD, auto-mode pipeline, creator isolation
│   ├── worker/             # transcoder.py, auto_processor.py
│   ├── solutions/          # Solution card CRUD
│   ├── articles/           # Knowledge articles
│   ├── forge/              # Marketplace / Forge CRUD + GitHub sync worker
│   ├── search/             # Site-wide full-text + fuzzy trigram search
│   ├── assistant/          # AI chat widget: SSE streaming, 21 tools, multi-provider LLM
│   ├── publish/            # Publish Authority submit/review workflow
│   ├── settings/           # SMTP, admin settings, probe endpoint
│   ├── analytics/          # Page-view tracking
│   └── email_utils/        # SMTP helpers, digest templates
├── react-portal/           # Vite + React 19 frontend (TypeScript)
│   └── src/
│       ├── pages/          # Page components
│       ├── components/     # Shared components (Navbar, HlsPlayer, SearchBar…)
│       ├── api/client.ts   # Typed fetch wrapper
│       └── index.css       # Tailwind + custom utilities
├── transcript-service/     # Standalone FastAPI — Whisper inference over SSE
├── db/init.sql             # Schema for fresh installs
├── scripts/                # Backup, restore, migrate, nginx, watcher helpers
├── docker-compose.yml          # Core stack (db, redis, backend, worker, auto-processor, frontend)
├── docker-compose.gpu.yml      # GPU override for worker (NVENC)
├── docker-compose.hostnet.yml  # Host networking override (Linux, no Docker bridge)
├── docker-compose.prod.yml     # Production hardening overrides
├── docker-compose.transcript.yml     # CPU Whisper service
├── docker-compose.transcript.gpu.yml # GPU Whisper service
└── .env.example                # All environment variables with comments
```

### Docker services

| Container | Purpose |
|---|---|
| `db` | PostgreSQL 16 |
| `redis` | Response cache (TTL-based) |
| `backend` | FastAPI API server |
| `worker` | FFmpeg transcoding worker |
| `auto-processor` | Transcript → metadata/chapters LLM pipeline |
| `frontend` | Nginx serving the built React app |
| `transcript-service` | Whisper speech-to-text (separate compose file) |

---

## Environment variables

See [.env.example](.env.example) for the full annotated list. Critical variables:

| Variable | Default | Notes |
|---|---|---|
| `JWT_SECRET` | *(insecure default)* | **Must change in production** |
| `POSTGRES_PASSWORD` | `portal123` | **Must change in production** |
| `AUTH_MODE` | `open` | `open` \| `ldap` \| `saml` |
| `PORTAL_URL` | `http://localhost:9810` | Public portal URL (SAML callbacks, email links) |
| `PORTAL_BASE_URL` | *(falls back to `PORTAL_URL`)* | Override for "View on Portal" links in emails |
| `EMAIL_SUBJECT_PREFIX` | `MSTAI-TF` | Prepended to every outgoing email subject; blank to disable |
| `VITE_API_URL` | `http://localhost:9800` | Baked into the frontend build; set to `/backend` for same-origin proxy |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | For LLM auto-mode and AI assistant |
| `FFMPEG_HWACCEL` | `auto` | `auto` detects NVIDIA, `none` forces CPU |
| `TRANSCRIPT_MOCK` | `false` | `true` skips Whisper for testing |
| `LOG_LEVEL` | `INFO` | `DEBUG` \| `INFO` \| `WARNING` \| `ERROR` — applied to all services |
| `HOST_NETWORK` | `false` | `true` enables host networking (Linux only; use when Docker bridge causes issues) |
| `REDIS_ENABLED` | `true` | Set `false` for local dev without Redis |

---

## Local development (without Docker)

```bash
./run.sh init     # Create Python venv, install deps, init DB
./run.sh start    # Start backend + frontend + worker
./run.sh stop     # Stop all
./run.sh status   # Show running processes
./run.sh logs backend
```

This uses a local Python venv and Vite dev server (not Docker). The database still needs to be running (via Docker or native PostgreSQL).

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/backup.sh` | Backup DB + videos + media + config; supports rsync/scp/rclone remote transfer |
| `scripts/restore.sh` | Restore from a backup directory |
| `scripts/migrate.sh` | Live server-to-server migration with automatic rollback |
| `scripts/setup-nginx.sh` | Configure nginx reverse proxy for production |
| `scripts/setup-watcher.sh` | Set up the filesystem watcher for auto video ingestion |

Detailed backup / restore / migration guide: [doc/Backup_Restore_Migration.md](doc/Backup_Restore_Migration.md)

---

## Production checklist

1. Change `JWT_SECRET` and `POSTGRES_PASSWORD` in `.env`
2. Set `VITE_API_URL` to your public domain
3. Run `sudo ./scripts/setup-nginx.sh --rebuild` for nginx reverse proxy
4. Set up TLS (certbot / existing certificate)
5. Install backup cron: `./scripts/backup.sh --schedule`
6. Set `AUTH_MODE=saml` or `ldap` if using SSO

See [SETUP.md](SETUP.md) for a full step-by-step guide.
