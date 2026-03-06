# Redundancy & Failover Design
**Context:** Self-hosted · 150–200 users · Low cost · Easy ops

---

## Failure Mode Analysis — What Actually Breaks?

Before adding redundancy, know what's worth protecting:

| Component | Failure Impact | Likelihood | Priority |
|---|---|---|---|
| Nginx / App process crash | Full outage | Medium | 🔴 High |
| Server hardware failure | Full outage | Low | 🔴 High |
| Disk failure | Data loss + outage | Low-Medium | 🔴 High |
| PostgreSQL crash | Upload/API down; **playback unaffected** | Low | 🟡 Medium |
| Transcoding worker crash | New uploads stuck; **playback unaffected** | Medium | 🟢 Low |
| Network/ISP issue | Full outage | Low | 🟡 Medium |

**Key insight:** Once a video is transcoded and on disk, playback only needs Nginx + disk. PostgreSQL and the API are only in the critical path for *uploads and metadata*. This simplifies your redundancy story significantly.

---

## Layer-by-Layer Redundancy

### 1. Process-Level (Free, Do This First)

The most common failures are process crashes, not hardware. Systemd or Docker restart policies handle this automatically.

**With Docker Compose:**
```yaml
services:
  nginx:
    restart: unless-stopped   # auto-restarts on crash

  api:
    restart: unless-stopped

  worker:
    restart: unless-stopped

  db:
    restart: unless-stopped
```

**With Systemd (bare metal):**
```ini
[Service]
Restart=on-failure
RestartSec=5s
```

This alone eliminates the vast majority of real-world downtime. A crashed process is back in seconds with zero manual intervention.

---

### 2. Disk-Level — RAID for Data Protection

Disk failure is your highest-risk data loss scenario. This is cheap insurance.

| RAID Level | Protects Against | Cost | Recommendation |
|---|---|---|---|
| **RAID 1** (mirror) | 1 disk failure | 2× disk cost | ✅ Best for simplicity |
| **RAID 5** | 1 disk failure | 1.33× disk cost | Good if you have 3+ disks |
| **RAID 6** | 2 disk failures | 1.5× disk cost | Overkill for this scale |

**Recommendation:** RAID 1 with two identical drives for your `/videos` directory. Set up via Linux `mdadm` — straightforward to configure and monitor.

```bash
# Check RAID health (add to cron daily)
mdadm --detail /dev/md0 | grep -E "State|Failed|Active"
```

**Important:** RAID is not a backup. It protects against hardware failure, not accidental deletion or corruption.

---

### 3. Backup Strategy — The Real Safety Net

```
Daily backup job
      │
      ├── PostgreSQL dump → rsync to backup server (or external drive)
      └── /videos directory → rsync to backup server

Retention: Keep 7 daily + 4 weekly snapshots
```

**Simple backup script:**
```bash
#!/bin/bash
DATE=$(date +%Y%m%d)
BACKUP_DIR=/mnt/backup/$DATE

# DB dump
pg_dump -U postgres videodb | gzip > $BACKUP_DIR/db.sql.gz

# Video files (incremental — only changed files)
rsync -av --delete /srv/videos/ /mnt/backup/videos/

# Prune old backups (keep 7 days)
find /mnt/backup -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \;
```

Run via cron at 2 AM daily. The `rsync` incremental sync means backups are fast after the first run.

---

### 4. Server-Level — Active/Passive Failover (Optional but Recommended)

If you have (or can get) a second physical machine, a simple **active/passive** setup gives you server-level failover without complexity.

```
          ┌─────────────────────────────┐
          │   Floating IP (e.g. Keepalived)   │
          └──────────┬──────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
   [Server A - PRIMARY]    [Server B - STANDBY]
   Nginx + API + PG        Nginx + API + PG
   (active)                (warm standby, ready)
         │                       │
         └───────────┬───────────┘
                     ▼
           [Shared Storage - NFS]
           or rsync-replicated /videos
```

**Keepalived** manages a virtual/floating IP that automatically moves to Server B if Server A goes down. From the user's perspective, the IP never changes.

**For shared video files, two options:**
| Option | Pros | Cons |
|---|---|---|
| **NFS shared mount** | Both servers see same files instantly | NFS becomes single point of failure |
| **rsync replication** | No shared dependency | Small replication lag (~1 min) |

**Recommendation:** rsync every 60 seconds for videos + PostgreSQL streaming replication for the DB. Simple, no shared failure points.

**PostgreSQL streaming replication** (primary → standby) is well-documented and reliable:
```bash
# On standby, pg_basebackup sets up replication in one command
pg_basebackup -h primary-server -D /var/lib/postgresql/data -P -Xs -R
```

---

### 5. Health Checks & Alerting

Redundancy without monitoring is useless — you won't know failover happened.

**Minimal monitoring stack (all free/open source):**

| Tool | Purpose |
|---|---|
| **Uptime Kuma** | Simple self-hosted uptime monitor with alerts (Slack, email, Telegram) |
| **Netdata** | Real-time server metrics (CPU, disk, network) — zero config |
| **Systemd journal** | Log all service crashes automatically |

**Uptime Kuma** is especially worth it — it's a single Docker container, has a great UI, and will ping you the moment Nginx stops responding.

```yaml
# Add to docker-compose.yml
uptime-kuma:
  image: louislam/uptime-kuma:1
  volumes:
    - kuma-data:/app/data
  ports: ["3001:3001"]
  restart: unless-stopped
```

---

## Recommended Redundancy Tiers

Pick the tier that matches your tolerance for downtime:

### Tier 1 — Minimal (1 server, ~$0 extra)
- ✅ Docker `restart: unless-stopped` on all services
- ✅ RAID 1 on disk
- ✅ Daily rsync backups to external drive
- ✅ Uptime Kuma alerting
- **Recovery time if server dies:** Hours (restore from backup onto new hardware)

### Tier 2 — Practical (1 server + backup server)
- Everything in Tier 1, plus:
- ✅ Second server as warm standby
- ✅ Keepalived floating IP
- ✅ rsync video replication every 60s
- ✅ PostgreSQL streaming replication
- **Recovery time if primary dies:** 1–5 minutes (automatic failover)

### Tier 3 — Robust (load balanced, not needed at 200 users)
- Multiple Nginx nodes behind a load balancer
- Centralized storage (Ceph or MinIO distributed)
- PG with automatic failover (Patroni)
- **Overkill for your scale — revisit if you grow to 2000+ users**

---

## Summary Recommendation

For your scale, **Tier 2 is the sweet spot:**

1. Process restarts handle 90% of real incidents automatically
2. RAID 1 protects your video library from disk failure
3. A warm standby server with Keepalived gives you fast failover for the remaining 10%
4. Daily backups protect against the scenarios RAID can't (corruption, mistakes)
5. Uptime Kuma ensures you know immediately when something goes wrong