# MST AI Portal — Architecture

## System overview

```
Browser
  │
  ▼
Nginx (port 80/443)
  ├── /          → React frontend (static files)
  ├── /api/      → FastAPI backend (port 8000)
  └── /streams/  → HLS video files (served from disk)

FastAPI backend
  ├── auth/          JWT (httpOnly cookie), LDAP, SAML 2.0
  ├── video/         Ignite video + course CRUD, notes, progress
  ├── solutions/     Solution cards + news feed
  ├── articles/      Knowledge articles
  ├── marketplace/   Agent/skill/MCP registry
  ├── forge/         Digest scheduler, RSS ingest
  ├── analytics/     Page-view tracking
  └── settings/      Admin SMTP, portal config

Workers (separate containers)
  ├── transcoder      — Polls transcode_jobs, runs FFmpeg HLS pipeline
  └── auto-processor  — Transcript → metadata/chapters/howto via Ollama

Transcript service (separate container)
  └── Whisper inference over SSE, job queue

PostgreSQL — single database (mst_portal)
Redis      — cache + rate limiting
```

## Data flow: video upload to playback

```
1. Admin uploads MP4 → FastAPI writes raw file to /data/videos/{uuid}/raw/original.mp4
2. FastAPI inserts transcode_jobs row (status=pending)
3. Transcoder worker polls DB, claims job, runs FFmpeg:
   raw/original.mp4 → hls/{360p,720p,1080p}/*.ts + master.m3u8
4. Worker sets video status=ready, stores hls_path + thumbnail
5. Frontend loads HLS via hls.js, fetches /streams/{uuid}/hls/master.m3u8
6. Nginx serves .m3u8 and .ts segments directly from disk
```

## Data flow: auto-processing pipeline

```
1. Transcoder completes → auto_processor picks up video
2. auto_processor sends audio to transcript-service (Whisper over SSE)
3. Transcript JSON stored at /data/videos/{uuid}/transcript.json
4. LLM jobs run sequentially: metadata → chapters → howto
5. Each result persisted back to DB / filesystem
```

## Directory layout

```
/data/videos/{uuid}/
├── raw/
│   ├── original.mp4        ← source file
│   ├── original_pretrim.mp4 ← backup before trim (if trimmed)
│   └── ops.json            ← operation audit log
├── hls/
│   ├── master.m3u8
│   ├── 360p/ 720p/ 1080p/  ← HLS segments
├── transcript.json
├── howto.json
└── thumb.jpg
```

## Key technology choices

| Layer | Choice | Reason |
|---|---|---|
| API | FastAPI + asyncpg | Async I/O, raw SQL (no ORM overhead), PostgreSQL native |
| Frontend | React 19 + Vite | Fast builds, lazy-loaded chunks, TypeScript |
| Video | FFmpeg + HLS | Browser-compatible adaptive bitrate, GPU via NVENC |
| Transcription | Whisper (faster-whisper) | Offline, accurate, SSE streaming progress |
| LLM | Ollama (local) | No cloud dependency, model-agnostic |
| Auth | JWT httpOnly cookie | XSS-safe; SAML/LDAP for enterprise SSO |
| Cache | Redis | Per-namespace versioned cache, TTL-based invalidation |

## Database schema highlights

- `videos` — core video metadata, status, hls_path, thumbnail
- `courses` + `video_chapters` — course structure, chapter timestamps
- `transcode_jobs` — worker queue with SKIP LOCKED
- `auto_jobs` — auto-processor queue (transcript/metadata/chapters/howto)
- `user_video_progress` — per-user watch position and completion
- `user_notes` — timestamped video notes
- `articles` — knowledge base
- `solutions` + `news_items` — solutions showcase + feed
- `forge_components` — marketplace registry
- `app_settings` — key/value admin config (SMTP, feature flags)

## Security model

- All admin endpoints require `role=admin`; content endpoints require `role=content`
- Rate limiting via slowapi on auth endpoints (login: 5/min, reset: 10/min)
- httpOnly cookies — JS cannot read tokens
- Article HTML content sanitized server-side with bleach on write
- DB port bound to loopback only (127.0.0.1) in docker-compose
- SAML assertions verified via python3-saml
