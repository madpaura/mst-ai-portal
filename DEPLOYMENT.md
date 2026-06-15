# Deployment Guide

## Docker Compose (recommended)

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` — at minimum set:

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | Yes | Long random string — never use the default |
| `POSTGRES_PASSWORD` | Yes | Strong DB password |
| `ADMIN_PASSWORD` | Yes | Initial admin password |
| `PORTAL_URL` | Yes | Public URL e.g. `https://ai.example.com` |
| `PORTAL_BASE_URL` | No | Override "View on Portal" base in emails; defaults to `PORTAL_URL` |
| `AUTH_MODE` | No | `open` (default) \| `ldap` \| `saml` |
| `SMTP_SERVER` | No | Required for email features |
| `EMAIL_SUBJECT_PREFIX` | No | Prepended to every outgoing email subject (default `MSTAI-TF`; blank to disable) |
| `LOG_LEVEL` | No | `DEBUG` \| `INFO` (default) \| `WARNING` \| `ERROR` — applies to all services |
| `UVICORN_WORKERS` | No | Number of FastAPI worker processes (default `4`); increase for high-concurrency deployments; migrations and the scheduler are advisory-lock-guarded |

### 2. Deploy

```bash
./setup.sh deploy
```

This script:
- Detects GPU and selects the correct compose override
- Pulls/builds images
- Starts all containers (db, backend, worker, auto-processor, frontend/nginx)

### Manual deploy

```bash
docker compose up -d --build
```

GPU variant:
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

With Whisper transcript service:
```bash
docker compose -f docker-compose.yml -f docker-compose.transcript.yml up -d --build
```

With host networking (Linux only — use when the Docker bridge causes Ollama/LDAP connectivity issues):
```bash
docker compose -f docker-compose.yml -f docker-compose.hostnet.yml up -d --build
# or set HOST_NETWORK=true in .env and let setup.sh pick it up automatically
```

### 3. Verify

```bash
docker compose ps          # all containers should be Up
docker compose logs -f     # watch startup logs
curl http://localhost/health
```

## Nginx (reverse proxy for HTTPS)

The frontend container runs Nginx on port 80. For production TLS, add a reverse proxy (Nginx, Caddy, or Traefik) in front:

```nginx
server {
    listen 443 ssl;
    server_name ai.example.com;
    ssl_certificate     /etc/letsencrypt/live/ai.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ai.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Set `PORTAL_URL=https://ai.example.com` in `.env` so SAML callbacks and email links work correctly. Set `PORTAL_BASE_URL` separately if you want "View on Portal" links in notification emails to point to a different origin.

## Updating

```bash
git pull
docker compose build
docker compose up -d
```

Alembic migrations run automatically on backend startup.

## Scaling

- **Transcoder workers**: scale with `docker compose up -d --scale worker=2` (jobs use `SKIP LOCKED` so multiple workers are safe)
- **Auto-processor**: controlled by `AUTO_PROCESSOR_CONCURRENCY` env var (default 4)
- **Frontend**: stateless — can be load-balanced

## Backup, restore & migration

Use the bundled scripts — they handle the DB dump, video/media archives, config,
scheduling, remote transfer, safe restore with rollback, and server-to-server
migration:

```bash
./scripts/backup.sh              # backup now (./scripts/backup.sh --schedule for nightly cron)
./scripts/restore.sh             # interactive restore with pre-restore snapshot + rollback
./scripts/migrate.sh --target user@new-host --dry-run   # move to a new server
```

Storage locations are taken from `.env` (`VIDEO_DATA_VOLUME` / `MEDIA_DATA_VOLUME`),
so backups follow wherever docker-compose mounts the data.

See the full guide: [doc/Backup_Restore_Migration.md](doc/Backup_Restore_Migration.md)

## Environment variables reference

See `.env.example` for the full list with inline documentation.
