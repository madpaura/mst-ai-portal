# MST AI Portal — Setup Guide

Complete guide for setting up the portal from scratch on a new server.

---

## Prerequisites

### Required

| Requirement | Version | Notes |
|---|---|---|
| Docker | 24+ | `docker --version` |
| Docker Compose | v2 plugin | `docker compose version` |
| Disk space | 20 GB+ | Videos can grow large; 100 GB+ recommended for production |
| RAM | 4 GB+ | 8 GB+ recommended when running the transcript service |

### Optional (GPU acceleration)

| Requirement | Notes |
|---|---|
| NVIDIA GPU | Any CUDA-capable card |
| NVIDIA driver | 525+ |
| nvidia-container-toolkit | Enables NVENC transcoding + CUDA Whisper |

If no GPU is present everything still works — transcoding uses CPU libx264 and Whisper runs on CPU (slower but functional).

---

## 1. Clone the repository

```bash
git clone <repository-url> mst-ai-portal
cd mst-ai-portal
```

---

## 2. Create and edit `.env`

```bash
cp .env.example .env
```

Open `.env` and set **at minimum**:

```bash
# Security — change both before first run
JWT_SECRET=<long-random-string>          # openssl rand -hex 32
POSTGRES_PASSWORD=<strong-password>

# URL the browser will use to reach the API
# - Local: http://localhost:9800
# - Behind nginx: /backend  (see nginx section below)
# - Custom domain: https://portal.example.com/backend
VITE_API_URL=http://localhost:9800

# Public URL used in digest/email links
PORTAL_URL=http://localhost:9810

# Optional: show a BETA badge in the navbar
# VITE_BETA_TAG=BETA
```

Full variable reference is in [.env.example](.env.example) with inline comments.

---

## 3. Check prerequisites

```bash
./setup.sh check
```

This checks Docker, Docker Compose, GPU availability, disk space, and port conflicts. Fix any blocking issues before continuing.

---

## 4. Deploy

```bash
./setup.sh deploy
```

This will:
1. Copy `.env.example` → `.env` if not already present
2. Detect GPU and choose the right Compose files
3. Build all Docker images
4. Start the full stack
5. Wait for the backend health check to pass
6. Print access URLs and the transcript API key

First run takes 5–15 minutes to build images. Subsequent deployments are fast (cached layers).

---

## 5. Verify

Visit http://localhost:9810 — you should see the portal login page.

Default credentials: **admin / admin**

> Change the admin password immediately under Admin Panel → Users.

---

## Port reference

| Port | Service | Variable |
|---|---|---|
| 9810 | Frontend (nginx serving React) | `FRONTEND_PORT` |
| 9800 | Backend API | `BACKEND_PORT` |
| 9100 | Transcript service (Whisper) | `TRANSCRIPT_PORT` |
| 5432 | PostgreSQL | `DB_PORT` |
| 6379 | Redis | (internal only) |

All ports are configurable in `.env`. Only 9810 and 9800 need to be reachable from browsers.

---

## Auth mode setup

### open (default)

No configuration needed. Admins create users through the admin panel. A default admin is seeded from `.env`:

```bash
SEED_DEFAULT_ADMIN=true    # create admin/admin on first startup
```

### LDAP

```bash
AUTH_MODE=ldap
LDAP_URL=ldap://your-ad-server:389
LDAP_BASE_DN=DC=corp,DC=example,DC=com
LDAP_BIND_DN=CN=svc-portal,OU=ServiceAccounts,DC=corp,DC=example,DC=com
LDAP_BIND_PASSWORD=<service-account-password>
```

Users log in with their AD credentials. The first successful login auto-creates their account with the `user` role; promote to `admin` or `content` in the admin panel.

### SAML 2.0 / ADFS

```bash
AUTH_MODE=saml
SAML_SP_ENTITY_ID=https://portal.example.com/saml/metadata
SAML_SP_ACS_URL=https://portal.example.com/saml/acs
SAML_SP_SLS_URL=https://portal.example.com/saml/sls
SAML_IDP_ENTITY_ID=https://adfs.example.com/adfs/services/trust
SAML_IDP_SSO_URL=https://adfs.example.com/adfs/ls/
SAML_IDP_SLO_URL=https://adfs.example.com/adfs/ls/?wa=wsignout1.0
SAML_IDP_CERT=<base64-cert-without-headers>
SAML_SP_CERT=<base64-cert>
SAML_SP_KEY=<base64-key>
# Map AD groups to portal roles:
SAML_GROUP_ROLE_MAP=AI-Team=admin,Developers=user
SAML_DEFAULT_ROLE=user
```

Generate SP certificates:
```bash
cd api/saml
./gen_sp_cert.sh          # creates sp.crt + sp.key + .b64 files
```

For complex ADFS configurations, write `api/saml/settings.json` and point to it:
```bash
SAML_SETTINGS_PATH=/app/saml/settings.json
```

In SAML mode, unauthenticated users are redirected to `/login` and Sign Out is hidden (session ends at the IdP).

---

## GPU setup (optional)

If you have an NVIDIA GPU and want faster transcoding and Whisper:

```bash
./setup.sh setup-gpu
```

This installs `nvidia-container-toolkit` and restarts Docker. Then redeploy:

```bash
./setup.sh deploy
```

The worker will automatically use `h264_nvenc` for transcoding and the transcript service will use CUDA.

To check GPU status:
```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

---

## Nginx reverse proxy (production)

For production, put nginx in front so both the frontend and backend are served from the same domain on port 80/443.

```bash
sudo ./scripts/setup-nginx.sh --rebuild
```

This will:
- Install nginx if missing
- Deploy `nginx/mst-ai-portal.conf` to `/etc/nginx/sites-available/`
- Set `VITE_API_URL=/backend` in `.env`
- Rebuild the frontend container (so the new API URL is baked in)
- Reload nginx

The portal will be available at `http://mst.ai.samsungds.net` (edit the hostname in the script/config as needed).

### TLS with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d portal.example.com
```

Then update `.env`:
```bash
VITE_API_URL=https://portal.example.com/backend
PORTAL_URL=https://portal.example.com
```

And rebuild the frontend:
```bash
sudo docker compose build --no-cache frontend && sudo docker compose up -d
```

---

## Transcript service

The Whisper transcript service runs as a separate container (included in `docker-compose.transcript.yml`). It is started automatically by `./setup.sh deploy`.

After deployment, configure it in the admin panel:

1. Go to **Admin Panel → Settings → Transcript Service**
2. Set URL to `http://transcript-service:9100` (container-to-container)
3. Set API key to the value shown after `./setup.sh deploy` (or from `TRANSCRIPT_API_KEY` in `.env`)

To test without a GPU or real transcription:
```bash
TRANSCRIPT_MOCK=true    # in .env — returns synthetic transcripts instantly
```

Whisper model size (in `.env`):
```bash
TRANSCRIPT_MODEL=large-v3   # best quality, needs ~4 GB RAM on CPU
TRANSCRIPT_MODEL=medium     # faster, less accurate
TRANSCRIPT_MODEL=small      # lowest resource usage
```

---

## Marketplace GitHub sync

1. Go to **Admin Panel → Forge Settings**
2. Add a git repository URL and personal access token (for private repos)
3. Set the branch and scan paths (directories to scan for components)
4. Click **Sync Now**

Each subdirectory in the scan path is treated as a component. The sync reads `skill.md` or `README.md` for metadata, and uses `skill.md` / `HOWTO.md` as the how-to guide.

---

## Backup

### Run a manual backup

```bash
./scripts/backup.sh
```

Backs up PostgreSQL, videos, media, and config to `./backups/<timestamp>/`.

### Configure backup

```bash
cp scripts/backup.conf.example scripts/backup.conf
# Edit backup.conf to set retention, remote transfer (rsync/scp/rclone), etc.
```

### Schedule automatic backups

```bash
./scripts/backup.sh --schedule
```

Installs a cron job running at 2 AM daily by default (configurable in `backup.conf`).

### Restore

```bash
./scripts/restore.sh
```

Interactive — lists available backups and lets you choose what to restore.

---

## Video auto-ingestion watcher

The watcher monitors a filesystem path (e.g. Samba share) and automatically uploads new videos to the portal.

```bash
./scripts/setup-watcher.sh           # set up config + test
sudo ./scripts/setup-watcher.sh --service  # also install systemd service
```

Edit `watcher.json` to point `watch_root` at your video share.

---

## Upgrading

```bash
git pull
./setup.sh deploy
```

Alembic migrations run automatically on backend startup — no manual migration step needed.

If the frontend config changed (e.g. `VITE_API_URL`):
```bash
docker compose build --no-cache frontend && docker compose up -d
```

---

## Resource tuning

Background workers have configurable resource limits in `.env` to prevent them from starving the API:

```bash
WORKER_CPU_LIMIT=4.0          # ffmpeg transcoder
WORKER_MEM_LIMIT=4g
AUTO_PROCESSOR_CPU_LIMIT=2.0  # LLM pipeline
AUTO_PROCESSOR_MEM_LIMIT=2g
TRANSCRIPT_CPU_LIMIT=4.0      # Whisper CPU
TRANSCRIPT_MEM_LIMIT=6g
AUTO_PROCESSOR_CONCURRENCY=4  # parallel pipeline jobs
```

Defaults assume 12 CPU cores / 14 GB RAM. Tune to your host.

---

## Troubleshooting

### Backend doesn't start

```bash
./setup.sh logs backend
```

Common causes:
- `JWT_SECRET` or `POSTGRES_PASSWORD` empty in `.env`
- Port conflict on 9800 — change `BACKEND_PORT` in `.env`
- Database not healthy yet — wait a few seconds and check `./setup.sh logs db`

### Videos stuck on "pending" or "processing"

```bash
./setup.sh logs worker
./setup.sh logs auto-processor
```

Check that the worker container started and FFmpeg is available. For GPU issues run `nvidia-smi` and verify `nvidia-container-toolkit` is installed.

### Transcript never completes

```bash
./setup.sh logs transcript-service
```

Verify the URL and API key are correctly set in Admin → Settings. Use `TRANSCRIPT_MOCK=true` for testing without real inference.

### Redis connection errors

If running without Redis:
```bash
REDIS_ENABLED=false    # in .env — disables caching, API responses are not cached
```

### Frontend shows blank page

- Check browser console for network errors
- Verify `VITE_API_URL` matches where the backend is actually reachable from the browser
- Rebuild frontend after changing `VITE_API_URL`: `docker compose build --no-cache frontend && docker compose up -d`

### Port conflicts

```bash
./setup.sh check
```

Shows which ports are in use. Change conflicting ports in `.env` and redeploy.

### View all logs

```bash
docker compose logs -f                      # all services
docker compose logs -f backend worker       # specific services
./setup.sh logs transcript-service          # via helper
```

---

## Live server migration

To move the portal to a new server:

```bash
./scripts/migrate.sh --target user@new-server-ip
```

This handles: pre-flight checks, final backup, file transfer, data restore on new server, health check, and cutover — with automatic rollback to the old server if anything fails.

See `scripts/migrate.sh --help` for options including `--dry-run`.
