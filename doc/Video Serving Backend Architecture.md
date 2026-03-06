# Video Serving Backend Architecture
**Profile:** Self-hosted · User-uploaded VOD · 150–200 concurrent users · Public videos · Small library (<100 videos) · Priority: Low cost, Low latency, Easy ops

---

## Architecture Overview

```
User Browser
     │
     ▼
[Nginx - Reverse Proxy + Static File Server]
     │                        │
     ▼                        ▼
[App API Server]        [HLS Video Files]
 (FastAPI / Node)        (served directly
     │                   by Nginx)
     ▼
[PostgreSQL]         [MinIO or Local Disk]
(video metadata)      (raw + transcoded files)
     │
     ▼
[FFmpeg Worker]
(transcoding queue)
```

---

## Component Breakdown

### 1. Reverse Proxy — **Nginx**
- Handles all incoming HTTP traffic
- Serves HLS video segments (`.m3u8` + `.ts` files) **directly from disk** — no app server involvement for playback
- Handles byte-range requests natively (critical for video seeking)
- Gzip/compression for manifests; no compression on `.ts` segments (already compressed)
- `sendfile on` + `tcp_nopush on` for efficient file delivery

**Why Nginx over Apache or Caddy?** Best performance for static file serving at concurrency, battle-tested, easy to configure.

---

### 2. App API Server — **FastAPI (Python) or Node.js/Express**
Handles everything *except* actual video streaming:
- `POST /upload` — accepts raw video upload, saves to staging area, enqueues transcode job
- `GET /videos` — list videos with metadata
- `GET /videos/:id` — video detail + playback URL (just a path to the `.m3u8`)
- No video bytes ever pass through the app server

**Recommendation:** FastAPI if your team knows Python; it's async-native, fast, and has great tooling.

---

### 3. Video Storage — **Local Disk or MinIO**

| Option | When to use |
|---|---|
| **Local disk** | Simplest. Single server. Fine for <100 videos. |
| **MinIO** | If you want S3-compatible API, multi-node, or future flexibility. Self-hosted. |

Organize storage as:
```
/videos
  /{video_id}
    /raw/original.mp4
    /hls/
      360p/index.m3u8 + *.ts
      720p/index.m3u8 + *.ts
      1080p/index.m3u8 + *.ts
      master.m3u8       ← adaptive bitrate manifest
```

---

### 4. Transcoding — **FFmpeg + Worker Queue**

On upload:
1. Save raw file to `/videos/{id}/raw/`
2. Push a job to a queue
3. FFmpeg worker picks it up and transcodes to multi-bitrate HLS

**FFmpeg command (example for 720p):**
```bash
ffmpeg -i input.mp4 \
  -vf scale=-2:720 -c:v libx264 -crf 23 -preset fast \
  -c:a aac -b:a 128k \
  -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "720p_%03d.ts" \
  720p/index.m3u8
```

**Queue options (pick one):**

| Tool | Pros | Cons |
|---|---|---|
| **Redis + RQ (Python)** | Simple, lightweight, easy ops | Requires Redis |
| **Redis + BullMQ (Node)** | Great UI dashboard, robust | Node ecosystem |
| **PostgreSQL-backed queue** | No extra infra (reuse your DB) | Slightly more setup |

**Recommendation:** PostgreSQL-backed queue (e.g. `pgqueue` or a simple jobs table) — eliminates Redis as a dependency entirely, keeping ops simple.

---

### 5. Database — **PostgreSQL**

Single table to start:
```sql
CREATE TABLE videos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'processing', -- processing | ready | error
  duration_s  INTEGER,
  hls_path    TEXT,   -- e.g. /videos/{id}/hls/master.m3u8
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

### 6. Video Player — **HLS.js (browser)**
- Native HLS support via `<video>` tag on Safari; HLS.js polyfills for Chrome/Firefox
- Handles adaptive bitrate switching automatically
- Lightweight, no dependencies

```html
<video id="player" controls></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
<script>
  const video = document.getElementById('player');
  const src = '/videos/{id}/hls/master.m3u8';
  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(src);
    hls.attachMedia(video);
  } else {
    video.src = src; // Safari native
  }
</script>
```

---

## Concurrency & Performance Sizing

For **150–200 concurrent viewers** watching HLS:

- Each viewer requests one ~6-second `.ts` segment every ~6 seconds
- Average segment size at 720p ≈ 3–5 MB → ~0.5–0.8 Mbps per viewer
- **200 users × 0.8 Mbps = ~160 Mbps sustained bandwidth**

**Server spec recommendation:**
| Resource | Minimum | Comfortable |
|---|---|---|
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Disk | 500 GB HDD | 1 TB SSD |
| Network | 1 Gbps NIC | 1 Gbps NIC |

Nginx handles 200 concurrent static file connections easily on 4 cores. The bottleneck will be **network bandwidth**, not CPU.

---

## Deployment Stack Summary

| Layer | Tool | Notes |
|---|---|---|
| Reverse proxy | Nginx | Video delivery + API proxy |
| API server | FastAPI | Upload, metadata, job dispatch |
| Transcoder | FFmpeg | Background worker process |
| Job queue | PostgreSQL jobs table | No extra infra |
| Storage | Local disk (or MinIO) | Start with disk |
| Database | PostgreSQL | Metadata + job queue |
| Player | HLS.js | Browser-side |
| Process manager | **Systemd** or **Docker Compose** | Easy self-hosted ops |

---

## Suggested Docker Compose Layout

```yaml
services:
  nginx:
    image: nginx:alpine
    volumes:
      - ./videos:/srv/videos
      - ./nginx.conf:/etc/nginx/nginx.conf
    ports: ["80:80"]

  api:
    build: ./api
    environment:
      DATABASE_URL: postgres://...
    volumes:
      - ./videos:/srv/videos

  worker:
    build: ./worker   # FFmpeg transcoding worker
    volumes:
      - ./videos:/srv/videos

  db:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

---

## What You're Intentionally NOT Using
(and why)

| Skipped | Reason |
|---|---|
| Kubernetes | Overkill for 200 users on-prem |
| Dedicated media server (Wowza, etc.) | Paid, heavy; Nginx + HLS is sufficient |
| Redis | Eliminated by using PG as queue |
| S3/cloud storage | Self-hosted requirement |
| DRM / token auth | Public videos, not needed |