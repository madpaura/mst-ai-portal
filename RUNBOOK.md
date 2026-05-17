# Operations Runbook

## Service health checks

```bash
# Docker Compose status
docker compose ps

# Backend health
curl http://localhost:8000/health

# Frontend
curl -s -o /dev/null -w "%{http_code}" http://localhost/

# Worker logs (last 100 lines)
docker compose logs --tail=100 worker

# Auto-processor logs
docker compose logs --tail=100 auto-processor
```

## Common operations

### Restart a single service

```bash
docker compose restart backend
docker compose restart worker
docker compose restart frontend
```

### Follow logs

```bash
docker compose logs -f backend
docker compose logs -f worker
docker compose logs -f auto-processor
```

### Local dev (non-Docker)

```bash
./run.sh status          # show all service states
./run.sh logs backend    # tail backend log
./run.sh logs worker     # tail worker log
./run.sh restart         # stop + start all
```

## Video processing

### Requeue a stuck transcode job

```bash
docker compose exec db psql -U portal mst_portal -c \
  "UPDATE transcode_jobs SET status='pending', attempts=0 WHERE video_id='<uuid>';"
```

### Check pending jobs

```bash
docker compose exec db psql -U portal mst_portal -c \
  "SELECT id, video_id, status, attempts, created_at FROM transcode_jobs ORDER BY created_at DESC LIMIT 20;"
```

### Force video status

```bash
docker compose exec db psql -U portal mst_portal -c \
  "UPDATE videos SET status='uploaded' WHERE id='<uuid>';"
```

## Database

### Open psql

```bash
docker compose exec db psql -U portal mst_portal
```

### Run a migration manually

```bash
docker compose exec backend alembic upgrade head
```

### Check migration state

```bash
docker compose exec backend alembic current
```

## Cache

### Flush Redis cache (all namespaces)

```bash
docker compose exec redis redis-cli FLUSHDB
```

### Check Redis

```bash
docker compose exec redis redis-cli INFO server | grep redis_version
docker compose exec redis redis-cli DBSIZE
```

## Auth

### Reset admin password

```bash
docker compose exec db psql -U portal mst_portal -c \
  "UPDATE users SET password_hash = crypt('<new_password>', gen_salt('bf')) WHERE username = 'admin';"
```

Or set `ADMIN_PASSWORD` in `.env` and restart the backend (it re-seeds on startup).

### SAML / LDAP not working

1. Check `AUTH_MODE` in `.env`
2. Verify `SAML_*` or `LDAP_*` vars are set correctly
3. Check backend logs: `docker compose logs backend | grep -i "saml\|ldap\|auth"`

## Storage

### Check disk usage

```bash
du -sh storage/videos/
docker system df
```

### Clean up failed job temp files

```bash
# Remove .spd_*.mp4 and .trimmed.mp4 temp files left by failed jobs
find storage/videos -name "*.spd_*.mp4" -o -name "*.trimmed.mp4" | xargs rm -f
```

## Incident response

### Backend not responding

1. `docker compose ps` — check container state
2. `docker compose logs --tail=50 backend` — check for errors
3. `docker compose restart backend`
4. If DB connection failure: check `docker compose ps db`, check `DATABASE_URL` in `.env`

### Worker not processing jobs

1. `docker compose logs --tail=50 worker` — check for errors
2. Check if jobs are stuck: `SELECT status, count(*) FROM transcode_jobs GROUP BY status;`
3. Worker reclaims stuck jobs on restart: `docker compose restart worker`

### Out of disk space

1. `df -h` — identify full filesystem
2. Clean Docker images: `docker system prune -f`
3. Remove old video temp files (see Storage section above)
4. Archive old videos: move `.ts` segments out of `storage/videos/` to cold storage
