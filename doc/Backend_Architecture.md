# MST AI Portal — Backend Architecture
**Profile:** Self-hosted · Internal enterprise portal · 150–200 concurrent users · Three domains (AI Solutions, Marketplace, Education) · Priority: Low cost, low latency, easy ops, single-team maintainability

---

## High-Level System Architecture

```
                           ┌───────────────────────────┐
                           │      User Browser          │
                           │  (React SPA — Vite build)  │
                           └─────────────┬─────────────┘
                                         │ HTTPS
                                         ▼
                    ┌────────────────────────────────────────┐
                    │          Nginx — Reverse Proxy          │
                    │  TLS termination · Static SPA hosting   │
                    │  HLS video segment serving · API proxy  │
                    │  Rate limiting · CORS · Gzip            │
                    └───┬──────────┬──────────┬──────────┬───┘
                        │          │          │          │
                        ▼          ▼          ▼          ▼
                   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────┐
                   │ Auth   │ │ Core   │ │ Video  │ │ Marketplace│
                   │Service │ │  API   │ │  API   │ │    API     │
                   │(FastAPI│ │(FastAPI│ │(FastAPI│ │  (FastAPI)  │
                   │  /auth)│ │ /api)  │ │/video) │ │  /forge)   │
                   └───┬────┘ └───┬────┘ └───┬────┘ └─────┬──────┘
                       │          │          │             │
                       └──────────┴─────┬────┴─────────────┘
                                        │
                              ┌─────────┴─────────┐
                              ▼                   ▼
                      ┌──────────────┐   ┌────────────────┐
                      │ PostgreSQL   │   │  File Storage   │
                      │  (all data)  │   │  (Local / MinIO)│
                      └──────────────┘   └────────────────┘
                              │
                              ▼
                      ┌──────────────┐
                      │ FFmpeg Worker│
                      │  (transcode  │
                      │   queue)     │
                      └──────────────┘
```

### Design Decisions vs. Reference Docs

Your reference architecture is solid for video serving. Here's where I **agree, extend, and correct**:

| Area | Reference Doc | This Architecture | Rationale |
|---|---|---|---|
| API framework | FastAPI (single service) | FastAPI (modular — 4 logical services, **single process**) | A portal with 3 domains needs clear boundaries. At your scale, run them as route-groups inside one FastAPI app — not separate deployments. Split only when a service needs independent scaling (you're far from that). |
| Queue | PostgreSQL jobs table | **Agree** — PG-backed queue | Eliminates Redis. At <100 videos, a `jobs` table with `SELECT ... FOR UPDATE SKIP LOCKED` is more than sufficient. |
| Storage | Local disk / MinIO | Local disk **phase 1**, MinIO **phase 2** | Start simple. MinIO adds ops overhead for marginal benefit at <100 videos. |
| Redundancy | Tier 2 (active/passive + Keepalived) | **Agree for production.** Tier 1 for dev/staging. | Your failover doc's Tier 2 is the right call. One correction: use `pg_basebackup` + streaming replication *only after* you've validated your backup/restore procedure end-to-end first. Most teams skip this and regret it. |
| Auth | Not addressed | **Added** — LDAP/SSO integration | Internal portal needs corporate auth. This was missing from both reference docs. |
| RAID | RAID 1 | **Agree** for the video volume. No RAID needed for the OS disk if you have backups. | |

---

## Domain Breakdown

The portal serves three distinct domains. Each maps to a set of API endpoints and database tables.

### Domain 1: AI Solutions (Landing / Solutions Page)

**Purpose:** Marketing-style landing page with capability cards, demo video, and CTAs.

**Backend needs:** Minimal. This is mostly static content rendered by the React SPA. The only dynamic elements are:

| Feature | Backend Requirement |
|---|---|
| Capability cards | Static JSON or CMS-like table |
| Demo video player | Served as HLS via Nginx (same pipeline as Ignite videos) |
| "Get Started" / "Dashboard" CTAs | Auth redirect — no dedicated API |
| Contact/feedback form | `POST /api/contact` → insert to PG + optional email notification |

**Endpoints:**
```
GET  /api/solutions/capabilities     → list capability cards (cacheable)
GET  /api/solutions/announcements    → latest release notes / banner text
POST /api/contact                    → submit contact form
```

---

### Domain 2: AI Forge Marketplace

**Purpose:** Internal registry of AI agents, skills, and MCP servers. Users can browse, search, filter, view details, and install/deploy components to their EDA environment.

**Data Model:**
```sql
CREATE TABLE forge_components (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT UNIQUE NOT NULL,          -- url-friendly identifier
    name            TEXT NOT NULL,
    component_type  TEXT NOT NULL CHECK (component_type IN ('agent', 'skill', 'mcp_server')),
    description     TEXT,
    long_description TEXT,                         -- markdown, rendered client-side
    icon            TEXT,                           -- material symbol name
    icon_color      TEXT,                           -- tailwind color class
    version         TEXT NOT NULL,
    install_command TEXT NOT NULL,
    badge           TEXT,                           -- 'verified', 'community', 'open_source'
    author          TEXT,
    downloads       INTEGER DEFAULT 0,
    rating          NUMERIC(3,2) DEFAULT 0,
    tags            TEXT[] DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_forge_type ON forge_components(component_type);
CREATE INDEX idx_forge_tags ON forge_components USING GIN(tags);
CREATE INDEX idx_forge_search ON forge_components USING GIN(
    to_tsvector('english', name || ' ' || COALESCE(description, ''))
);
```

**Endpoints:**
```
GET    /forge/components              → list with filters (?type=agent&badge=verified&q=search)
GET    /forge/components/:slug        → detail view
POST   /forge/components/:slug/install → log install event, return install instructions
GET    /forge/categories              → list categories with counts
GET    /forge/components/:slug/reviews → user reviews
POST   /forge/components/:slug/reviews → submit review (auth required)
```

**Search:** PostgreSQL full-text search via `to_tsvector` / `ts_query`. No need for Elasticsearch at this scale. The GIN index above supports fast free-text search across name + description.

**Install flow:** The "install" is client-side (user copies a CLI command). The backend logs the event for analytics:
```sql
CREATE TABLE forge_install_events (
    id              BIGSERIAL PRIMARY KEY,
    component_id    UUID REFERENCES forge_components(id),
    user_id         UUID REFERENCES users(id),
    installed_at    TIMESTAMPTZ DEFAULT now()
);
```

---

### Domain 3: AI Ignite (Education / Video Platform)

**Purpose:** Internal training video platform with courses, note-taking, progress tracking, and how-to documentation.

This is the most complex domain. I'm building on your video-serving reference doc but extending it significantly for the education features visible in the frontend.

**Data Model:**
```sql
-- Courses / Series
CREATE TABLE courses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    description TEXT,
    is_active   BOOLEAN DEFAULT true,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Videos (belongs to a course)
CREATE TABLE videos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id   UUID REFERENCES courses(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    slug        TEXT UNIQUE NOT NULL,
    description TEXT,
    category    TEXT NOT NULL,               -- 'Code-mate', 'RAG', 'Agents', 'Deep Dive'
    duration_s  INTEGER,                     -- seconds, populated after transcode
    status      TEXT DEFAULT 'processing'    -- processing | ready | error
                CHECK (status IN ('processing', 'ready', 'error')),
    hls_path    TEXT,                        -- /videos/{id}/hls/master.m3u8
    thumbnail   TEXT,                        -- /videos/{id}/thumb.jpg
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Video chapters (timecoded sections)
CREATE TABLE video_chapters (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    start_time  INTEGER NOT NULL,            -- seconds from start
    sort_order  INTEGER DEFAULT 0
);

-- User progress tracking
CREATE TABLE user_video_progress (
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    watched_seconds INTEGER DEFAULT 0,
    completed       BOOLEAN DEFAULT false,
    last_position   INTEGER DEFAULT 0,       -- resume position in seconds
    updated_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, video_id)
);

-- User notes (timestamped, per video)
CREATE TABLE user_notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    timestamp_s INTEGER NOT NULL,            -- video timestamp in seconds
    content     TEXT NOT NULL,
    screenshot  TEXT,                        -- optional screenshot path
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- How-to guides (linked to videos)
CREATE TABLE howto_guides (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,                -- markdown
    version     TEXT DEFAULT '1.0',
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);
```

**Endpoints:**
```
# Course & Video browsing
GET    /video/courses                         → list courses
GET    /video/courses/:slug                   → course detail with video list
GET    /video/videos/:slug                    → video detail + chapters + HLS path
GET    /video/videos/:slug/chapters           → chapter list

# Progress tracking
GET    /video/progress                        → user's overall progress (all videos)
GET    /video/progress/:video_slug            → progress for specific video
PUT    /video/progress/:video_slug            → update watch position / mark complete
        Body: { "last_position": 150, "watched_seconds": 150 }

# Notes
GET    /video/videos/:slug/notes              → user's notes for a video
POST   /video/videos/:slug/notes              → create note
        Body: { "timestamp_s": 150, "content": "..." }
PUT    /video/notes/:id                       → update note
DELETE /video/notes/:id                       → delete note

# Screenshots (note attachments)
POST   /video/notes/:id/screenshot            → upload screenshot (multipart)

# How-to guides
GET    /video/videos/:slug/howto              → get guide content

# Video upload & management (admin)
POST   /video/upload                          → upload raw video (multipart, chunked)
GET    /video/jobs                            → list transcode jobs + status
```

**Video Serving — Nginx Direct (not through FastAPI):**

This is critical and aligns with your reference doc. Video segments **never touch the Python process**:

```nginx
server {
    listen 80;
    server_name portal.internal.corp;

    # SPA — serve React build
    location / {
        root /srv/portal/dist;
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /auth/ {
        proxy_pass http://127.0.0.1:8000;
    }

    location /forge/ {
        proxy_pass http://127.0.0.1:8000;
    }

    location /video/ {
        proxy_pass http://127.0.0.1:8000;
    }

    # HLS video segments — served directly by Nginx
    location /streams/ {
        alias /srv/videos/;
        sendfile on;
        tcp_nopush on;
        tcp_nodelay on;

        # .m3u8 manifests — small text, cacheable
        location ~* \.m3u8$ {
            add_header Cache-Control "public, max-age=1";
            add_header Content-Type "application/vnd.apple.mpegurl";
        }

        # .ts segments — large binary, aggressive caching
        location ~* \.ts$ {
            add_header Cache-Control "public, max-age=31536000, immutable";
            add_header Content-Type "video/mp2t";
        }
    }

    # Uploaded screenshots / thumbnails
    location /media/ {
        alias /srv/media/;
        expires 7d;
    }
}
```

---

## Cross-Cutting: Authentication & Authorization

Your reference docs didn't address auth. For an internal portal, this is non-negotiable.

**Approach:** Configurable auth provider — **Open mode** for development, **LDAP/SSO** for production. Controlled via environment variable.

```
AUTH_MODE=open      → No login required, auto-creates a dev admin user
AUTH_MODE=ldap      → Corporate LDAP/SSO authentication
```

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT UNIQUE NOT NULL,       -- login identifier
    email           TEXT UNIQUE,
    display_name    TEXT NOT NULL,
    initials        TEXT,                       -- for avatar fallback (e.g., "JD")
    password_hash   TEXT,                       -- only used in open/dev mode
    role            TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    employee_id     TEXT,                       -- from LDAP (nullable for open mode)
    last_login      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,                 -- SHA-256 of JWT
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);
```

**Auth Flow — Open/Dev Mode:**
```
1. On first run, auto-seed an admin user (admin/admin)
2. POST /auth/login with username + password
3. Backend validates, creates JWT (HS256, 24-hour expiry for dev convenience)
4. JWT returned in response body (stored in localStorage for dev simplicity)
5. Frontend sends Authorization: Bearer <token> header
```

**Auth Flow — LDAP/Production Mode:**
```
1. User clicks "Sign In"
2. Redirect to corporate SSO / LDAP auth page
3. On success, backend creates JWT (HS256, 8-hour expiry)
4. JWT stored in httpOnly secure cookie (NOT localStorage)
5. Every API request includes cookie → middleware validates JWT
6. On token expiry → redirect to SSO re-auth
```

**Endpoints:**
```
POST   /auth/login                → accept credentials (open mode) or initiate SSO (ldap mode)
POST   /auth/callback             → SSO callback (ldap mode only)
POST   /auth/logout               → invalidate session
GET    /auth/me                   → current user profile
PUT    /auth/me                   → update display name / initials
```

**Role-Based Access:**

| Role | Solutions | Marketplace | Ignite Videos | Admin Panel |
|---|---|---|---|---|
| `user` | ✅ View | ✅ Browse | ✅ Watch + Notes | ❌ |
| `admin` | ✅ | ✅ + Manage catalog | ✅ | ✅ Full admin (video upload, catalog CRUD, user management) |

---

## Transcoding Pipeline

Aligned with your reference doc, with corrections:

```
Upload Flow:
┌──────────┐     ┌───────────┐     ┌──────────────┐     ┌───────────┐
│  Admin    │────▶│ POST      │────▶│ Save raw to  │────▶│ Insert    │
│  uploads  │     │ /video/   │     │ /srv/videos/ │     │ job into  │
│  video    │     │ upload    │     │ {id}/raw/    │     │ PG queue  │
└──────────┘     └───────────┘     └──────────────┘     └─────┬─────┘
                                                              │
                                                              ▼
                                                    ┌──────────────────┐
                                                    │   FFmpeg Worker   │
                                                    │  (polls every 5s) │
                                                    └────────┬─────────┘
                                                             │
                                           ┌─────────────────┼─────────────────┐
                                           ▼                 ▼                 ▼
                                     ┌──────────┐     ┌──────────┐     ┌──────────┐
                                     │  360p    │     │  720p    │     │  1080p   │
                                     │  HLS     │     │  HLS     │     │  HLS     │
                                     └──────────┘     └──────────┘     └──────────┘
                                                             │
                                                             ▼
                                                    ┌──────────────────┐
                                                    │ Generate master  │
                                                    │ .m3u8 manifest   │
                                                    │ + thumbnail      │
                                                    │ → update videos  │
                                                    │   table: ready   │
                                                    └──────────────────┘
```

**Job Queue Table (correction from reference doc — add retry logic):**
```sql
CREATE TABLE transcode_jobs (
    id          BIGSERIAL PRIMARY KEY,
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    status      TEXT DEFAULT 'pending'
                CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts    INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error       TEXT,
    started_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_jobs_pending ON transcode_jobs(status) WHERE status = 'pending';
```

**Worker Polling Query (atomic claim with skip-locked):**
```sql
UPDATE transcode_jobs
SET status = 'processing', started_at = now(), attempts = attempts + 1
WHERE id = (
    SELECT id FROM transcode_jobs
    WHERE status = 'pending' AND attempts < max_attempts
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

**Correction from reference doc:** The reference doc doesn't mention retry logic or failure handling. A failed FFmpeg transcode (e.g., corrupt source file) should:
1. Increment `attempts`
2. Log the error to the `error` column
3. Only mark `failed` after `max_attempts` exhausted
4. Surface the error in the admin UI

**FFmpeg commands (multi-bitrate):**
```bash
# 360p
ffmpeg -i raw/original.mp4 \
  -vf scale=-2:360 -c:v libx264 -crf 28 -preset fast \
  -c:a aac -b:a 96k \
  -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "hls/360p/seg_%03d.ts" \
  hls/360p/index.m3u8

# 720p
ffmpeg -i raw/original.mp4 \
  -vf scale=-2:720 -c:v libx264 -crf 23 -preset fast \
  -c:a aac -b:a 128k \
  -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "hls/720p/seg_%03d.ts" \
  hls/720p/index.m3u8

# 1080p
ffmpeg -i raw/original.mp4 \
  -vf scale=-2:1080 -c:v libx264 -crf 22 -preset fast \
  -c:a aac -b:a 192k \
  -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "hls/1080p/seg_%03d.ts" \
  hls/1080p/index.m3u8

# Thumbnail
ffmpeg -i raw/original.mp4 -ss 5 -vframes 1 -q:v 2 thumb.jpg

# Master manifest (generated programmatically)
```

**Master manifest (`master.m3u8`):**
```m3u8
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/index.m3u8
```

---

## File Storage Layout

```
/srv/
├── portal/
│   └── dist/                    ← React production build (served by Nginx)
├── videos/
│   └── {video_uuid}/
│       ├── raw/
│       │   └── original.mp4
│       ├── hls/
│       │   ├── 360p/
│       │   │   ├── index.m3u8
│       │   │   └── seg_000.ts, seg_001.ts, ...
│       │   ├── 720p/
│       │   │   ├── index.m3u8
│       │   │   └── seg_000.ts, seg_001.ts, ...
│       │   ├── 1080p/
│       │   │   ├── index.m3u8
│       │   │   └── seg_000.ts, seg_001.ts, ...
│       │   └── master.m3u8
│       └── thumb.jpg
├── media/
│   └── screenshots/             ← note screenshot attachments
│       └── {note_uuid}.jpg
└── backups/                     ← rsync target (separate disk/mount)
```

---

## FastAPI Application Structure

Single FastAPI application with modular routers. **Not microservices** — that's premature for your scale.

```
api/
├── main.py                      ← FastAPI app, CORS, middleware
├── config.py                    ← settings (env vars, paths)
├── database.py                  ← async PG connection pool (asyncpg)
├── auth/
│   ├── router.py                ← /auth/* endpoints
│   ├── middleware.py             ← JWT validation middleware
│   ├── ldap.py                  ← LDAP/SSO integration
│   └── schemas.py
├── solutions/
│   ├── router.py                ← /api/solutions/* endpoints
│   └── schemas.py
├── forge/
│   ├── router.py                ← /forge/* endpoints
│   ├── service.py               ← business logic (search, install tracking)
│   └── schemas.py
├── video/
│   ├── router.py                ← /video/* endpoints
│   ├── service.py               ← business logic
│   ├── upload.py                ← chunked upload handling
│   └── schemas.py
├── worker/
│   ├── transcoder.py            ← FFmpeg worker process
│   └── queue.py                 ← PG queue claim/complete logic
└── models/
    └── tables.py                ← SQLAlchemy / raw SQL table definitions
```

**main.py sketch:**
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from auth.router import router as auth_router
from auth.middleware import AuthMiddleware
from solutions.router import router as solutions_router
from forge.router import router as forge_router
from video.router import router as video_router

app = FastAPI(title="MST AI Portal API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://portal.internal.corp"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthMiddleware)

app.include_router(auth_router,      prefix="/auth",  tags=["auth"])
app.include_router(solutions_router,  prefix="/api",   tags=["solutions"])
app.include_router(forge_router,      prefix="/forge", tags=["forge"])
app.include_router(video_router,      prefix="/video", tags=["video"])
```

**Database connection (asyncpg for performance):**
```python
import asyncpg
from config import settings

pool: asyncpg.Pool = None

async def init_db():
    global pool
    pool = await asyncpg.create_pool(
        settings.DATABASE_URL,
        min_size=5,
        max_size=20,
    )

async def get_db() -> asyncpg.Pool:
    return pool
```

---

## Progress Tracking — How It Works End-to-End

This powers the progress bars visible in the Ignite header and sidebar.

```
Browser (HLS.js player)
    │
    │ Every 10 seconds while playing:
    │ PUT /video/progress/{video_slug}
    │ Body: { "last_position": 340, "watched_seconds": 340 }
    │
    ▼
FastAPI endpoint
    │
    │ UPSERT into user_video_progress
    │ If watched_seconds >= (duration_s * 0.9) → mark completed = true
    │
    ▼
PostgreSQL (user_video_progress table)

On page load:
    GET /video/progress → aggregate query:
    SELECT
        COUNT(*) FILTER (WHERE completed) as completed_count,
        COUNT(*) as total_count,
        category,
        COUNT(*) FILTER (WHERE completed) as cat_completed,
        COUNT(*) as cat_total
    FROM videos v
    LEFT JOIN user_video_progress p ON p.video_id = v.id AND p.user_id = $1
    GROUP BY category;
```

**Auto-resume:** When a user opens a video, the frontend calls `GET /video/progress/:slug` and seeks the HLS player to `last_position`.

---

## Caching Strategy

At 200 users, aggressive caching isn't required, but smart caching reduces load and improves perceived performance:

| Resource | Cache Location | TTL | Strategy |
|---|---|---|---|
| React SPA (JS/CSS) | Nginx + browser | 1 year | Immutable hashed filenames (Vite default) |
| `.m3u8` manifests | Nginx + browser | 1 second | Short TTL — manifest is small |
| `.ts` segments | Nginx + browser | 1 year | Immutable — segments never change |
| `/forge/components` | FastAPI in-memory | 60 seconds | `functools.lru_cache` or `cachetools.TTLCache` |
| `/api/solutions/*` | FastAPI in-memory | 5 minutes | Rarely changes |
| `/video/progress` | No cache | — | User-specific, always fresh |

For API responses, use ETags + `Cache-Control` headers rather than a dedicated cache layer (Redis). At your scale, in-process TTL caches are sufficient.

---

## Docker Compose — Full Stack

```yaml
version: "3.9"

services:
  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/certs:/etc/nginx/certs:ro
      - portal-dist:/srv/portal/dist:ro
      - video-data:/srv/videos:ro
      - media-data:/srv/media:ro
    depends_on:
      - api

  api:
    build: ./api
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://portal:${DB_PASSWORD}@db:5432/mst_portal
      VIDEO_STORAGE_PATH: /srv/videos
      MEDIA_STORAGE_PATH: /srv/media
      JWT_SECRET: ${JWT_SECRET}
      LDAP_URL: ${LDAP_URL}
      LDAP_BASE_DN: ${LDAP_BASE_DN}
    volumes:
      - video-data:/srv/videos
      - media-data:/srv/media
    expose:
      - "8000"
    depends_on:
      db:
        condition: service_healthy

  worker:
    build: ./api
    restart: unless-stopped
    command: python -m worker.transcoder
    environment:
      DATABASE_URL: postgresql://portal:${DB_PASSWORD}@db:5432/mst_portal
      VIDEO_STORAGE_PATH: /srv/videos
    volumes:
      - video-data:/srv/videos
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: mst_portal
      POSTGRES_USER: portal
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pg-data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/01_init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U portal -d mst_portal"]
      interval: 5s
      timeout: 3s
      retries: 5

  uptime-kuma:
    image: louislam/uptime-kuma:1
    restart: unless-stopped
    volumes:
      - kuma-data:/app/data
    ports:
      - "3001:3001"

volumes:
  pg-data:
  video-data:
  media-data:
  portal-dist:
  kuma-data:
```

**Correction from reference doc:** The reference doc mounts `./videos` as a bind mount. For production, use **named Docker volumes** or a dedicated mount point on the RAID 1 array. Bind mounts to project directories are fragile and risk accidental deletion during deploys.

---

## Redundancy & Failover Alignment

Aligning with your Redundancy doc (Tier 2 recommended):

| Layer | Implementation | Notes |
|---|---|---|
| Process restart | `restart: unless-stopped` on all services | Handles 90% of incidents |
| Disk | RAID 1 on `/srv/videos` mount | Protects video library |
| DB backup | Daily `pg_dump` via cron | 7 daily + 4 weekly retention |
| Video backup | Daily rsync to backup server | Incremental — fast after first run |
| Server failover | Keepalived floating IP + warm standby | Tier 2 per your doc |
| DB replication | PG streaming replication to standby | Auto-promote on primary failure |
| Monitoring | Uptime Kuma + Netdata | Alerts via Slack/email |

**One correction:** Your redundancy doc suggests NFS as an option for shared storage. **Do not use NFS** for video files served by Nginx with `sendfile`. NFS and `sendfile` interact poorly — the kernel sends stale data from the page cache. Use rsync replication instead.

---

## Security Considerations

| Concern | Mitigation |
|---|---|
| Auth bypass | All API routes behind JWT middleware; Nginx blocks direct access to `/srv/` |
| File upload abuse | Max upload size in Nginx (`client_max_body_size 5G`); validate MIME type server-side; only admins can upload |
| SQL injection | Parameterized queries via asyncpg (no string interpolation) |
| XSS | React auto-escapes by default; no `dangerouslySetInnerHTML` in production |
| CSRF | `SameSite=Strict` on auth cookies; Origin header validation |
| Secrets | All secrets via env vars, never in code; `.env` file excluded from git |
| Rate limiting | Nginx `limit_req_zone` on `/auth/login` (10 req/min per IP) |
| Internal-only access | Nginx `allow 10.0.0.0/8; deny all;` — restrict to internal network |

---

## Database Migration Strategy

Use **Alembic** (Python) for schema migrations. Version-controlled, reversible, team-friendly.

```bash
# Initialize
alembic init migrations

# Create migration after schema change
alembic revision --autogenerate -m "add user_notes table"

# Apply
alembic upgrade head

# Rollback
alembic downgrade -1
```

Store migration files in git alongside the API code. Run `alembic upgrade head` as part of the deploy script.

---

## Deployment Workflow

```
Developer pushes to main branch
         │
         ▼
   CI/CD (optional — GitLab CI or simple shell script)
         │
         ├── npm run build (React SPA → dist/)
         ├── docker compose build
         ├── alembic upgrade head
         └── docker compose up -d
```

**For your scale, a simple deploy script is sufficient:**
```bash
#!/bin/bash
set -euo pipefail

cd /opt/mst-portal

# Pull latest code
git pull origin main

# Build React frontend
cd react-portal && npm ci && npm run build
cp -r dist/ /srv/portal/dist/

# Apply DB migrations
cd ../api && alembic upgrade head

# Rebuild and restart services
cd .. && docker compose build api worker
docker compose up -d

echo "Deploy complete ✅"
```

---

## Performance Targets

| Metric | Target | How |
|---|---|---|
| API response (p95) | <100ms | asyncpg + in-memory caching |
| Video start latency | <2s | Nginx `sendfile` + HLS.js preload |
| Page load (SPA) | <1.5s | Vite code splitting + Nginx gzip |
| Transcode throughput | ~1x realtime per quality tier | FFmpeg `-preset fast` on 4+ cores |
| Concurrent viewers | 200 | Nginx handles this natively |

---

## Admin: Video Content Management

Admin-only page for uploading, managing, and enriching video content. This is the **content authoring workflow** — the counterpart to the viewer-facing Ignite page.

### Admin Video Management — Features

| Feature | Description |
|---|---|
| **Video Upload** | Drag-and-drop or file picker. Chunked upload for large files (up to 5 GB). Shows upload progress. |
| **Transcode Status** | Real-time status of transcoding jobs (pending → processing → ready / error). Retry failed jobs. |
| **Video Preview** | Preview the transcoded HLS stream directly in the admin panel before publishing. |
| **Chapter Editor** | Add/edit/delete timecoded chapters. Drag to reorder. Auto-detect chapter boundaries (future). |
| **Notes Seeding** | Admin can pre-populate "starter notes" that all users see (e.g., key takeaways). |
| **How-To Editor** | Markdown editor for the how-to guide linked to each video. Live preview. |
| **Quality Settings** | Per-video override: select which quality tiers to transcode (360p, 720p, 1080p). Default: all three. |
| **Thumbnail** | Auto-generated at 5s mark. Admin can override by uploading a custom thumbnail or picking a timestamp. |
| **Metadata** | Title, description, category, sort order, course assignment. |
| **Publish/Unpublish** | Videos are unpublished by default after upload. Admin explicitly publishes when ready. |
| **Delete** | Soft-delete (mark inactive) with option to hard-delete (remove files from disk). |

### Data Model Additions

```sql
-- Video quality settings (per-video override)
CREATE TABLE video_quality_settings (
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    quality     TEXT NOT NULL CHECK (quality IN ('360p', '720p', '1080p')),
    enabled     BOOLEAN DEFAULT true,
    crf         INTEGER DEFAULT 23,            -- FFmpeg CRF value (lower = better quality)
    PRIMARY KEY (video_id, quality)
);

-- Seed notes (admin-created, visible to all users)
CREATE TABLE seed_notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id    UUID REFERENCES videos(id) ON DELETE CASCADE,
    timestamp_s INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Add publish status to videos table
ALTER TABLE videos ADD COLUMN is_published BOOLEAN DEFAULT false;
ALTER TABLE videos ADD COLUMN custom_thumbnail TEXT;  -- override auto-generated thumb
```

### Admin Video API Endpoints

```
# Video CRUD
GET    /admin/videos                      → list all videos (incl. unpublished, with job status)
POST   /admin/videos                      → create video record + upload raw file (multipart/chunked)
GET    /admin/videos/:id                  → full detail (metadata + chapters + howto + quality + job status)
PUT    /admin/videos/:id                  → update metadata (title, description, category, course, sort_order)
DELETE /admin/videos/:id                  → soft-delete (set is_active=false)
DELETE /admin/videos/:id/permanent        → hard-delete (remove DB record + all files from disk)

# Publishing
POST   /admin/videos/:id/publish         → set is_published=true
POST   /admin/videos/:id/unpublish       → set is_published=false

# Preview
GET    /admin/videos/:id/preview         → returns HLS path even for unpublished videos

# Upload & Transcoding
POST   /admin/videos/:id/upload          → upload/replace raw video file
POST   /admin/videos/:id/retranscode     → re-enqueue transcode job (e.g., after quality settings change)
GET    /admin/videos/:id/job-status      → current transcode job status + progress

# Chapters
GET    /admin/videos/:id/chapters        → list chapters
POST   /admin/videos/:id/chapters        → create chapter { title, start_time, sort_order }
PUT    /admin/chapters/:chapter_id       → update chapter
DELETE /admin/chapters/:chapter_id       → delete chapter
PUT    /admin/videos/:id/chapters/reorder → bulk reorder { chapter_ids: [...] }

# How-To Guide
GET    /admin/videos/:id/howto           → get guide (markdown)
PUT    /admin/videos/:id/howto           → create/update guide { title, content (markdown) }

# Quality Settings
GET    /admin/videos/:id/quality         → current quality settings
PUT    /admin/videos/:id/quality         → update { qualities: [{quality: "720p", enabled: true, crf: 23}] }

# Thumbnail
POST   /admin/videos/:id/thumbnail      → upload custom thumbnail (multipart)
POST   /admin/videos/:id/thumbnail/auto  → regenerate from timestamp { timestamp_s: 30 }

# Seed Notes
GET    /admin/videos/:id/seed-notes      → list seed notes
POST   /admin/videos/:id/seed-notes      → create seed note { timestamp_s, content }
PUT    /admin/seed-notes/:id             → update
DELETE /admin/seed-notes/:id             → delete

# Courses
GET    /admin/courses                     → list all courses
POST   /admin/courses                     → create course { title, slug, description }
PUT    /admin/courses/:id                 → update course
DELETE /admin/courses/:id                 → delete course (fails if videos are assigned)
```

### Admin Video UI — Page Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Admin Header  [ Videos | Marketplace | ← Back to Portal ]         │
├──────────────────────┬──────────────────────────────────────────────┤
│                      │                                              │
│  Video List          │  Selected Video Detail                       │
│  ┌────────────────┐  │  ┌────────────────────────────────────────┐  │
│  │ 🔍 Search      │  │  │  Video Preview Player                 │  │
│  ├────────────────┤  │  │  [▶ HLS preview]                      │  │
│  │ + Upload New   │  │  └────────────────────────────────────────┘  │
│  ├────────────────┤  │                                              │
│  │ ● Setup & Usa… │  │  Tabs: [Metadata] [Chapters] [How-To]       │
│  │   Ready ✅     │  │        [Quality] [Seed Notes]               │
│  │ ○ Prompt Eng…  │  │                                              │
│  │   Processing ⏳│  │  ┌────────────────────────────────────────┐  │
│  │ ○ Function Ca… │  │  │  Active Tab Content                   │  │
│  │   Draft 📝     │  │  │  (form fields, editors, etc.)         │  │
│  └────────────────┘  │  └────────────────────────────────────────┘  │
│                      │                                              │
│                      │  [Publish] [Delete] [Re-transcode]           │
└──────────────────────┴──────────────────────────────────────────────┘
```

---

## Admin: Marketplace Catalog Management

Admin-only page for creating and managing the AI Forge catalog. Since this is a **catalog/directory** (not a live package registry), the admin creates entries manually.

### Admin Marketplace Management — Features

| Feature | Description |
|---|---|
| **Create Component** | Form to add a new agent, skill, or MCP server entry with all metadata. |
| **Edit Component** | Update any field — name, description, version, install command, badge, etc. |
| **Markdown Description** | Long description field supports markdown, rendered in detail view. |
| **Icon Picker** | Select from Material Symbols library + choose color theme. |
| **Badge Assignment** | Set verification badge: Verified, Community, Open Source, or none. |
| **Activate/Deactivate** | Toggle visibility without deleting. |
| **Ordering** | Set sort order or let it default to popularity (download count). |
| **Bulk Import** | (Future) Import catalog from JSON/YAML file. |

### Admin Marketplace API Endpoints

```
# Component CRUD (admin only)
GET    /admin/forge/components            → list all (incl. inactive)
POST   /admin/forge/components            → create component
        Body: { slug, name, component_type, description, long_description,
                icon, icon_color, version, install_command, badge, author, tags }
GET    /admin/forge/components/:id        → full detail
PUT    /admin/forge/components/:id        → update component
DELETE /admin/forge/components/:id        → soft-delete (set is_active=false)

# Activation
POST   /admin/forge/components/:id/activate    → set is_active=true
POST   /admin/forge/components/:id/deactivate  → set is_active=false
```

### Admin Marketplace UI — Page Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Admin Header  [ Videos | Marketplace | ← Back to Portal ]         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Marketplace Catalog Management                                     │
│  ┌──────────────────────────────────────────────────────┐           │
│  │ [+ Add Component]  🔍 Search...   Filter: [All ▾]   │           │
│  ├──────────────────────────────────────────────────────┤           │
│  │ Icon │ Name            │ Type   │ Version │ Badge │ Status │    │
│  │──────│─────────────────│────────│─────────│───────│────────│    │
│  │ 🏗️  │ RTL Verify Agent│ Agent  │ v2.4.1  │ ✅    │ Active │    │
│  │ 🧠  │ UVM Testbench   │ Skill  │ v1.0.8  │ —     │ Active │    │
│  │ 🔄  │ Jira-to-Spec    │ MCP    │ v3.2.0  │ —     │ Draft  │    │
│  └──────────────────────────────────────────────────────┘           │
│                                                                     │
│  ── Edit Component Form (slide-out or modal) ──                     │
│  ┌──────────────────────────────────────────────────────┐           │
│  │ Name: [____________]  Slug: [____________]           │           │
│  │ Type: [Agent ▾]       Version: [____________]        │           │
│  │ Description: [_________________________________]     │           │
│  │ Long Description (Markdown): [large textarea]        │           │
│  │ Icon: [picker]  Color: [picker]  Badge: [dropdown]   │           │
│  │ Install Command: [____________]                      │           │
│  │ Tags: [chip] [add tag]                               │           │
│  │                                                      │           │
│  │ [Save]  [Cancel]  [Deactivate]                       │           │
│  └──────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## What's Intentionally Out of Scope

| Feature | Reason |
|---|---|
| Kubernetes | Overkill for 200 users, adds massive ops burden |
| Microservices (separate deployments) | One team, one server, one process. Split later if needed. |
| Elasticsearch | PG full-text search is sufficient for <1000 marketplace components |
| Redis | PG queue + in-process caches eliminate this dependency |
| CDN | Self-hosted, internal network — no CDN needed |
| DRM | Internal-only content — network restriction is sufficient |
| WebSocket/SSE for progress | Polling every 10s is fine for 200 users |
| GraphQL | REST is simpler and sufficient for this API surface |

---

## Summary: Complete API Surface

```
Auth (5):
  POST   /auth/login
  POST   /auth/callback
  POST   /auth/logout
  GET    /auth/me
  PUT    /auth/me

Solutions (3):
  GET    /api/solutions/capabilities
  GET    /api/solutions/announcements
  POST   /api/contact

Forge — Public (4):
  GET    /forge/components
  GET    /forge/components/:slug
  POST   /forge/components/:slug/install
  GET    /forge/categories

Video — Public (11):
  GET    /video/courses
  GET    /video/courses/:slug
  GET    /video/videos/:slug
  GET    /video/videos/:slug/chapters
  GET    /video/progress
  GET    /video/progress/:video_slug
  PUT    /video/progress/:video_slug
  GET    /video/videos/:slug/notes
  POST   /video/videos/:slug/notes
  PUT    /video/notes/:id
  DELETE /video/notes/:id

Admin — Video Management (22):
  GET    /admin/videos
  POST   /admin/videos
  GET    /admin/videos/:id
  PUT    /admin/videos/:id
  DELETE /admin/videos/:id
  DELETE /admin/videos/:id/permanent
  POST   /admin/videos/:id/publish
  POST   /admin/videos/:id/unpublish
  GET    /admin/videos/:id/preview
  POST   /admin/videos/:id/upload
  POST   /admin/videos/:id/retranscode
  GET    /admin/videos/:id/job-status
  GET    /admin/videos/:id/chapters
  POST   /admin/videos/:id/chapters
  PUT    /admin/chapters/:chapter_id
  DELETE /admin/chapters/:chapter_id
  PUT    /admin/videos/:id/chapters/reorder
  GET    /admin/videos/:id/howto
  PUT    /admin/videos/:id/howto
  GET    /admin/videos/:id/quality
  PUT    /admin/videos/:id/quality
  POST   /admin/videos/:id/thumbnail

Admin — Marketplace Catalog (7):
  GET    /admin/forge/components
  POST   /admin/forge/components
  GET    /admin/forge/components/:id
  PUT    /admin/forge/components/:id
  DELETE /admin/forge/components/:id
  POST   /admin/forge/components/:id/activate
  POST   /admin/forge/components/:id/deactivate

Admin — Courses (4):
  GET    /admin/courses
  POST   /admin/courses
  PUT    /admin/courses/:id
  DELETE /admin/courses/:id

Total: 56 endpoints
```
