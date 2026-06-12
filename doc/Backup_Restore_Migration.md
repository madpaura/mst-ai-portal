# Backup, Restore & Server Migration Guide

This guide covers the three operational scripts in `scripts/`:

| Script | Purpose |
|---|---|
| `scripts/backup.sh` | Back up DB + videos + media + config, locally and/or to a remote target |
| `scripts/restore.sh` | Restore a backup with a pre-restore safety snapshot and automatic rollback |
| `scripts/migrate.sh` | Move a running portal to a new server with cutover and automatic rollback |

All three read the same configuration (`scripts/backup.conf` + `.env`), so settings
like storage locations and SSH keys only need to be configured once.

---

## 1. What gets backed up

A backup is a timestamped directory under `backups/` (configurable):

```
backups/2026-06-12_020000/
├── db/
│   └── mst_portal.dump        # pg_dump custom format (-Fc), compressed
├── files/
│   ├── videos.tar.gz          # HLS renditions, thumbnails, source uploads
│   └── media.tar.gz           # article images, solution-card assets, attachments
├── config/
│   ├── .env                   # environment (contains secrets — protect backups!)
│   ├── docker-compose.yml
│   └── backup.conf
└── manifest.json              # timestamp, source paths, included components
```

Each component can be switched on/off independently (see configuration below).
If a videos/media directory does not exist, the script writes a
`*.tar.gz.EMPTY` marker instead of failing.

> **Security note:** `config/.env` contains `JWT_SECRET`, DB credentials and
> SMTP/LLM tokens. Treat the backup directory with the same care as the server
> itself, and prefer encrypted remote targets.

---

## 2. Configuration

### 2.1 Create your config

```bash
cp scripts/backup.conf.example scripts/backup.conf
$EDITOR scripts/backup.conf
```

Without a `backup.conf` the scripts run with safe defaults: local-only backups
into `./backups/`, all components enabled, 14-day retention.

### 2.2 Options reference (`scripts/backup.conf`)

| Option | Default | Meaning |
|---|---|---|
| `BACKUP_LOCAL_DIR` | `./backups` | Where backups are written on this machine |
| `BACKUP_RETENTION_DAYS` | `14` | Local backups older than this are pruned after each run (`0` = keep forever) |
| `BACKUP_TRANSFER_METHOD` | `local` | `local` \| `rsync` \| `scp` \| `rclone` |
| `BACKUP_REMOTE_URL` | *(empty)* | `user@host:/path` for rsync/scp, `remote:bucket/path` for rclone |
| `BACKUP_SSH_KEY` | *(empty)* | SSH key for rsync/scp (empty = default key / ssh-agent) |
| `BACKUP_CRON_SCHEDULE` | `0 2 * * *` | Cron expression used by `--schedule` |
| `BACKUP_DB` | `true` | Include the PostgreSQL dump |
| `BACKUP_VIDEOS` | `true` | Include the video storage directory |
| `BACKUP_MEDIA` | `true` | Include the media storage directory |
| `BACKUP_CONFIG` | `true` | Include `.env`, `docker-compose.yml`, `backup.conf` |
| `BACKUP_COMPRESS_LEVEL` | `6` | pg_dump compression level (1 = fastest, 9 = smallest) |
| `BACKUP_WEBHOOK_URL` | *(empty)* | POST a JSON status ping when a backup finishes |
| `BACKUP_VIDEOS_DIR` | *(empty)* | Override the video storage location (see below) |
| `BACKUP_MEDIA_DIR` | *(empty)* | Override the media storage location (see below) |

### 2.3 Video / media storage locations

Both `backup.sh` and `restore.sh` resolve where the video and media files live
with this priority:

1. **`BACKUP_VIDEOS_DIR` / `BACKUP_MEDIA_DIR`** in `scripts/backup.conf` — explicit override
2. **`VIDEO_DATA_VOLUME` / `MEDIA_DATA_VOLUME`** in `.env` — the same paths
   docker-compose mounts into the containers, so backups automatically follow
   your compose configuration
3. `./volumes/storage/videos` and `./volumes/storage/media` — built-in default

Relative paths are resolved against the project root. The resolved paths are
printed at the start of every backup run and recorded in `manifest.json`.

Example — storage relocated to a data disk:

```bash
# .env  (docker-compose and the backup scripts both honour these)
VIDEO_DATA_VOLUME="/mnt/data/videos"
MEDIA_DATA_VOLUME="/mnt/data/media"
```

No `backup.conf` change needed — backups and restores follow the `.env` paths.

### 2.4 Database credentials

DB credentials are read from `.env` (`POSTGRES_DB`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `DB_PORT`). The scripts auto-detect the running Postgres
container; if none is running, `backup.sh` falls back to a local `pg_dump`
against `localhost:$DB_PORT`.

---

## 3. Backup (`scripts/backup.sh`)

### 3.1 Run a backup now

```bash
./scripts/backup.sh
```

Runs all enabled components, writes a manifest, transfers to the remote target
(if configured), then prunes local backups past the retention window.

### 3.2 List existing backups

```bash
./scripts/backup.sh --list
```

```
TIMESTAMP                 DB           VIDEOS       MEDIA        TOTAL
─────────────────────────  ───────────  ───────────  ───────────  ─────────
2026-06-12_020000         48.2 MB      3.1 GB       210.4 MB     3.4 GB
```

### 3.3 Schedule nightly backups

```bash
./scripts/backup.sh --schedule
```

Installs a crontab entry using `BACKUP_CRON_SCHEDULE` (default: daily 02:00).
Output is appended to `logs/backup.log`. Re-running `--schedule` replaces the
existing entry (no duplicates). Remove it with `crontab -e`.

### 3.4 Off-site backups

Set both `BACKUP_TRANSFER_METHOD` and `BACKUP_REMOTE_URL`:

```bash
# rsync over SSH (recommended — incremental, resumable)
BACKUP_TRANSFER_METHOD="rsync"
BACKUP_REMOTE_URL="backup@nas.example.com:/srv/backups/mst-portal"
BACKUP_SSH_KEY="/home/admin/.ssh/backup_ed25519"

# or S3/GCS/anything rclone supports (configure the remote with `rclone config` first)
BACKUP_TRANSFER_METHOD="rclone"
BACKUP_REMOTE_URL="s3remote:mst-portal-backups"
```

Each run is uploaded into a `<timestamp>/` subdirectory on the remote.
Remote copies are **not** pruned by the retention policy — manage remote
retention on the remote side (e.g. S3 lifecycle rules).

### 3.5 Webhook notifications

```bash
BACKUP_WEBHOOK_URL="https://hooks.example.com/backup"
```

After each run the script POSTs:

```json
{"event": "backup", "status": "success|partial", "timestamp": "2026-06-12_020000", "errors": 0}
```

---

## 4. Restore (`scripts/restore.sh`)

### 4.1 How it works

Restore is deliberately defensive:

1. **Pre-restore safety snapshot** — dumps the current DB and archives the
   current videos/media into `backups/pre-restore_<timestamp>/`
2. Stops the `backend` and `worker` services
3. Restores the database (terminate connections → drop → create → `pg_restore`)
4. Restores video files into the configured video storage location
5. Restores media files into the configured media storage location
6. Starts all services and polls `http://localhost:$BACKEND_PORT/health`

**If any step fails — including the health check — the script automatically
rolls back** to the pre-restore snapshot and restarts services. The snapshot is
kept after a successful restore too; delete it once you've verified the result.

### 4.2 Interactive restore

```bash
./scripts/restore.sh
```

Lists available backups, lets you pick one by number, shows what it contains,
and asks for confirmation before touching anything.

### 4.3 Restore a specific backup

```bash
./scripts/restore.sh 2026-06-12_020000        # by timestamp under BACKUP_LOCAL_DIR
./scripts/restore.sh /mnt/usb/2026-06-12_020000   # or any backup directory path
./scripts/restore.sh --list                   # see what's available
```

To restore a backup that lives on a remote target, copy it back first:

```bash
rsync -az backup@nas:/srv/backups/mst-portal/2026-06-12_020000/ \
      ./backups/2026-06-12_020000/
./scripts/restore.sh 2026-06-12_020000
```

### 4.4 Restoring after a storage move

Restore always extracts into the **currently configured** storage locations
(section 2.3), even if the backup was taken when storage lived somewhere else —
archives are re-rooted to the target directory name automatically. So the
workflow for moving to a bigger disk is simply:

```bash
./scripts/backup.sh                       # 1. backup with the old paths
docker compose down                       # 2. stop the stack
$EDITOR .env                              # 3. point VIDEO_DATA_VOLUME / MEDIA_DATA_VOLUME at the new disk
./scripts/restore.sh <timestamp>          # 4. restore — lands in the new location, restarts services
```

### 4.5 Disaster recovery on a fresh machine

```bash
git clone <repo-url> mst-ai-portal && cd mst-ai-portal
cp .env.example .env && $EDITOR .env      # or restore config/.env from the backup
mkdir -p backups
rsync -az backup@nas:/srv/backups/mst-portal/<timestamp>/ backups/<timestamp>/
./setup.sh deploy                          # build images, start the stack once
./scripts/restore.sh <timestamp>
```

The backup's `config/.env` is a reference copy of the environment at backup
time — diff it against your new `.env` if anything misbehaves.

### 4.6 Partial restores (DB only / files only)

The restore script skips any component missing from the backup directory. To
restore only the database from a full backup, temporarily move
`files/videos.tar.gz` and `files/media.tar.gz` out of the backup directory, or
do it manually:

```bash
docker exec -i -e PGPASSWORD=$POSTGRES_PASSWORD <db-container> \
    pg_restore -U portal -d mst_portal --no-owner --role=portal --no-acl --clean \
    < backups/<timestamp>/db/mst_portal.dump
```

---

## 5. Server migration (`scripts/migrate.sh`)

Moves a live portal to a new server in one supervised run: backup → transfer →
restore → health check → cutover.

### 5.1 Prerequisites on the **new** server

- Docker + Docker Compose installed and running
- SSH access from the current server (key-based strongly recommended:
  `ssh-copy-id user@new-host`)
- Same CPU architecture as the current server
- Enough disk for the project + data (check `du -sh volumes/ backups/`)

### 5.2 Dry-run first

```bash
./scripts/migrate.sh --target admin@10.0.0.42 --dry-run
```

Prints every command that would run, locally and remotely, without changing
anything. Always do this before a real migration.

### 5.3 Run the migration

```bash
./scripts/migrate.sh --target admin@10.0.0.42 \
    [--remote-dir /opt/mst-ai-portal]   # default: /opt/mst-ai-portal
    [--ssh-key ~/.ssh/migrate_ed25519]  # default: backup.conf BACKUP_SSH_KEY or ssh-agent
```

The script walks through eight steps, asking for confirmation before starting
and again before the final cutover:

| Step | What happens | Where |
|---|---|---|
| 1 | Pre-flight: docker/rsync/ssh present, SSH connectivity, Docker on remote | both |
| 2 | Final backup via `backup.sh` | source |
| 3 | rsync project files (excludes `volumes/`, `backups/`, `node_modules/`, `.git/`) | source → target |
| 4 | rsync the step-2 backup to `<remote-dir>/backups/migration_<ts>/` | source → target |
| 5 | Create volume dirs, start DB, restore dump + extract videos/media | target |
| 6 | `docker compose up -d` (all services) | target |
| 7 | Poll `/health` for up to 90 s | target |
| 8 | **Cutover** — asks, then `docker compose stop` on the source | source |

**Automatic rollback:** if any step before cutover fails, services are
restarted on the source server and the migration backup location is printed.
The old server keeps serving; the new server may be in a partial state — wipe
`<remote-dir>` before retrying.

### 5.4 After a successful migration

1. Point DNS / load balancer at the new server
2. Verify the app at `http://<new-host>:$BACKEND_PORT` (login, video playback,
   uploads, admin pages)
3. Re-install the backup cron **on the new server**: `./scripts/backup.sh --schedule`
4. Update `BACKUP_REMOTE_URL` if the new server should push to the same target
5. Decommission the old server only after a few days of clean operation

> **Note:** migration restores data into `<remote-dir>/volumes/storage/` on the
> target (the default layout). If you want custom storage paths on the new
> server, migrate first, then follow the storage-move recipe in section 4.4 on
> the new machine.

---

## 6. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `pg_dump via Docker failed` | DB container not healthy — `docker compose logs db`. Credentials in `.env` must match the running container. |
| `Videos directory not found … skipping` | Storage path mismatch — check the resolved path printed in the run header against `.env` `VIDEO_DATA_VOLUME`. |
| Restore rolls back with `Backend did not become healthy` | `docker compose logs backend --tail=100`. Common: backup from a newer schema than the code (update code first), or `.env` mismatch. The rollback already returned you to the pre-restore state. |
| `Cannot SSH into <host>` during migration | Run `ssh-copy-id user@host`; the script also offers a password-auth retry. |
| Backup is huge / slow | Lower `BACKUP_COMPRESS_LEVEL`, or set `BACKUP_VIDEOS=false` for frequent DB-only backups and back videos up weekly with a second conf (run with `BACKUP_LOCAL_DIR` pointing elsewhere). |
| Cron backup never runs | `crontab -l` to verify the entry; check `logs/backup.log`. Cron has a minimal `PATH` — docker must be resolvable for the cron user. |
| Restoring an old backup after renaming storage dirs | Supported — archives are re-rooted to the configured target automatically (section 4.4). |

## 7. Recommended baseline

For any production install:

```bash
cp scripts/backup.conf.example scripts/backup.conf
# set BACKUP_TRANSFER_METHOD=rsync + BACKUP_REMOTE_URL to an off-site target
./scripts/backup.sh              # take one now, verify with --list
./scripts/backup.sh --schedule   # nightly at 02:00
```

…and periodically test that a backup actually restores — a backup you've never
restored is a hope, not a backup.
