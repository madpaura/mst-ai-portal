#!/usr/bin/env bash
# =============================================================================
# MST AI Portal — Backup Script
#
# Usage:
#   ./scripts/backup.sh               Run a backup now
#   ./scripts/backup.sh --schedule    Install as a cron job
#   ./scripts/backup.sh --list        List existing backups
#   ./scripts/backup.sh --help        Show this help
#
# Config:  scripts/backup.conf  (copy from backup.conf.example)
# =============================================================================
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; }
step()    { echo -e "\n${BLUE}${BOLD}──── $* ────${NC}"; }
section() { echo -e "\n${CYAN}${BOLD}$*${NC}"; }

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONF_FILE="$SCRIPT_DIR/backup.conf"

# ── Defaults (overridden by backup.conf) ──────────────────────────────────────
BACKUP_LOCAL_DIR="$PROJECT_ROOT/backups"
BACKUP_RETENTION_DAYS=14
BACKUP_TRANSFER_METHOD="local"
BACKUP_REMOTE_URL=""
BACKUP_SSH_KEY=""
BACKUP_CRON_SCHEDULE="0 2 * * *"
BACKUP_DB=true
BACKUP_VIDEOS=true
BACKUP_MEDIA=true
BACKUP_CONFIG=true
BACKUP_COMPRESS_LEVEL=6
BACKUP_WEBHOOK_URL=""

# ── Load config ───────────────────────────────────────────────────────────────
if [[ -f "$CONF_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$CONF_FILE"
    info "Loaded config from $CONF_FILE"
else
    warn "No backup.conf found — using defaults (local-only mode)"
    warn "Copy scripts/backup.conf.example → scripts/backup.conf to customise"
fi

# ── Load .env for DB credentials ──────────────────────────────────────────────
ENV_FILE="$PROJECT_ROOT/.env"
POSTGRES_DB="mst_portal"
POSTGRES_USER="portal"
POSTGRES_PASSWORD="portal123"
if [[ -f "$ENV_FILE" ]]; then
    # shellcheck source=/dev/null
    source <(grep -E '^(POSTGRES_DB|POSTGRES_USER|POSTGRES_PASSWORD|DB_PORT)=' "$ENV_FILE" | sed 's/[[:space:]]*#.*//')
fi
DB_PORT="${DB_PORT:-5432}"

# ── Helpers ───────────────────────────────────────────────────────────────────
timestamp() { date '+%Y-%m-%d_%H%M%S'; }

human_size() {
    local bytes=$1
    if   (( bytes >= 1073741824 )); then printf "%.1f GB" "$(echo "scale=1; $bytes/1073741824" | bc)"
    elif (( bytes >= 1048576 ));    then printf "%.1f MB" "$(echo "scale=1; $bytes/1048576"    | bc)"
    elif (( bytes >= 1024 ));       then printf "%.1f KB" "$(echo "scale=1; $bytes/1024"       | bc)"
    else echo "${bytes} B"; fi
}

require_cmd() {
    if ! command -v "$1" &>/dev/null; then
        error "Required command '$1' not found. Install it and retry."
        exit 1
    fi
}

# ── Detect Docker DB container ────────────────────────────────────────────────
find_db_container() {
    # Match by image name (handles postgres:16-alpine, postgres:15, etc.)
    docker ps --format "{{.Names}}\t{{.Image}}" 2>/dev/null \
        | awk -F'\t' '$2 ~ /^postgres/ {print $1}' \
        | grep -E "(mst|portal|db)" | head -1 || true
}

DB_CONTAINER=""
DB_CONTAINER=$(find_db_container)

# ── Subcommands ───────────────────────────────────────────────────────────────

do_list() {
    section "Available backups in $BACKUP_LOCAL_DIR"
    if [[ ! -d "$BACKUP_LOCAL_DIR" ]] || [[ -z "$(ls -A "$BACKUP_LOCAL_DIR" 2>/dev/null)" ]]; then
        warn "No backups found."
        return
    fi
    echo ""
    printf "%-25s %-12s %-12s %-12s %s\n" "TIMESTAMP" "DB" "VIDEOS" "MEDIA" "TOTAL"
    printf "%-25s %-12s %-12s %-12s %s\n" "─────────────────────────" "───────────" "───────────" "───────────" "─────────"
    for bdir in "$BACKUP_LOCAL_DIR"/*/; do
        [[ -d "$bdir" ]] || continue
        name=$(basename "$bdir")
        db_size="-"
        vid_size="-"
        med_size="-"
        total=0
        if [[ -f "$bdir/db/mst_portal.dump" ]]; then
            s=$(stat -c%s "$bdir/db/mst_portal.dump" 2>/dev/null || echo 0)
            db_size=$(human_size "$s"); total=$((total + s))
        fi
        if [[ -f "$bdir/files/videos.tar.gz" ]]; then
            s=$(stat -c%s "$bdir/files/videos.tar.gz" 2>/dev/null || echo 0)
            vid_size=$(human_size "$s"); total=$((total + s))
        fi
        if [[ -f "$bdir/files/media.tar.gz" ]]; then
            s=$(stat -c%s "$bdir/files/media.tar.gz" 2>/dev/null || echo 0)
            med_size=$(human_size "$s"); total=$((total + s))
        fi
        printf "%-25s %-12s %-12s %-12s %s\n" "$name" "$db_size" "$vid_size" "$med_size" "$(human_size "$total")"
    done
    echo ""
}

do_schedule() {
    step "Installing cron job"
    require_cmd crontab
    SCRIPT_ABS="$SCRIPT_DIR/backup.sh"
    LOG_FILE="$PROJECT_ROOT/logs/backup.log"
    mkdir -p "$PROJECT_ROOT/logs"

    CRON_LINE="$BACKUP_CRON_SCHEDULE $SCRIPT_ABS >> $LOG_FILE 2>&1"
    # Remove old entries for this script, then add new one
    { crontab -l 2>/dev/null || true; } | { grep -v "$SCRIPT_ABS" || true; } | { cat; echo "$CRON_LINE"; } | crontab -
    info "Cron job installed: $CRON_LINE"
    info "Logs will be written to: $LOG_FILE"
    echo ""
    info "Current crontab:"
    crontab -l | grep "$SCRIPT_ABS" || true
}

do_backup() {
    local TS
    TS=$(timestamp)
    local DEST="$BACKUP_LOCAL_DIR/$TS"
    mkdir -p "$DEST/db" "$DEST/files" "$DEST/config"

    section "MST AI Portal — Backup  $TS"
    echo "  Destination : $DEST"
    echo "  DB          : $BACKUP_DB"
    echo "  Videos      : $BACKUP_VIDEOS"
    echo "  Media       : $BACKUP_MEDIA"
    echo "  Config      : $BACKUP_CONFIG"
    echo "  Remote      : ${BACKUP_REMOTE_URL:-'(local only)'}"

    local ERRORS=0

    # ── 1. Database ───────────────────────────────────────────────────────────
    if [[ "$BACKUP_DB" == "true" ]]; then
        step "1/4  Database backup"
        local DUMP_FILE="$DEST/db/mst_portal.dump"

        if [[ -n "$DB_CONTAINER" ]]; then
            info "Using Docker container: $DB_CONTAINER"
            if docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
                    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z "$BACKUP_COMPRESS_LEVEL" \
                    > "$DUMP_FILE" 2>/dev/null; then
                info "Database dump: $(human_size "$(stat -c%s "$DUMP_FILE")")"
            else
                error "pg_dump via Docker failed"
                ERRORS=$((ERRORS + 1))
            fi
        elif command -v pg_dump &>/dev/null; then
            info "Using local pg_dump (port $DB_PORT)"
            PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
                -h localhost -p "$DB_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
                -Fc -Z "$BACKUP_COMPRESS_LEVEL" > "$DUMP_FILE" || {
                    error "pg_dump failed"; ERRORS=$((ERRORS + 1)); }
            info "Database dump: $(human_size "$(stat -c%s "$DUMP_FILE")")"
        else
            warn "Neither Docker DB container nor local pg_dump found — skipping DB backup"
        fi
    fi

    # ── 2. Videos ─────────────────────────────────────────────────────────────
    if [[ "$BACKUP_VIDEOS" == "true" ]]; then
        step "2/4  Videos backup"
        local VIDEO_SRC="$PROJECT_ROOT/volumes/storage/videos"
        local VIDEO_ARCHIVE="$DEST/files/videos.tar.gz"
        if [[ -d "$VIDEO_SRC" ]]; then
            tar -czf "$VIDEO_ARCHIVE" -C "$(dirname "$VIDEO_SRC")" "$(basename "$VIDEO_SRC")" \
                --checkpoint=1000 --checkpoint-action="ttyout=." 2>/dev/null || true
            echo ""
            info "Videos archive: $(human_size "$(stat -c%s "$VIDEO_ARCHIVE")")"
        else
            warn "Videos directory not found: $VIDEO_SRC — skipping"
            touch "$DEST/files/videos.tar.gz.EMPTY"
        fi
    fi

    # ── 3. Media ──────────────────────────────────────────────────────────────
    if [[ "$BACKUP_MEDIA" == "true" ]]; then
        step "3/4  Media backup"
        local MEDIA_SRC="$PROJECT_ROOT/volumes/storage/media"
        local MEDIA_ARCHIVE="$DEST/files/media.tar.gz"
        if [[ -d "$MEDIA_SRC" ]]; then
            tar -czf "$MEDIA_ARCHIVE" -C "$(dirname "$MEDIA_SRC")" "$(basename "$MEDIA_SRC")" \
                --checkpoint=1000 --checkpoint-action="ttyout=." 2>/dev/null || true
            echo ""
            info "Media archive: $(human_size "$(stat -c%s "$MEDIA_ARCHIVE")")"
        else
            warn "Media directory not found: $MEDIA_SRC — skipping"
            touch "$DEST/files/media.tar.gz.EMPTY"
        fi
    fi

    # ── 4. Config ─────────────────────────────────────────────────────────────
    if [[ "$BACKUP_CONFIG" == "true" ]]; then
        step "4/4  Config backup"
        [[ -f "$PROJECT_ROOT/.env" ]]              && cp "$PROJECT_ROOT/.env"              "$DEST/config/.env"
        [[ -f "$PROJECT_ROOT/docker-compose.yml" ]] && cp "$PROJECT_ROOT/docker-compose.yml" "$DEST/config/docker-compose.yml"
        [[ -f "$CONF_FILE" ]]                      && cp "$CONF_FILE"                      "$DEST/config/backup.conf"
        info "Config files saved"
    fi

    # ── Manifest ──────────────────────────────────────────────────────────────
    cat > "$DEST/manifest.json" <<EOF
{
  "timestamp": "$TS",
  "project_root": "$PROJECT_ROOT",
  "postgres_db": "$POSTGRES_DB",
  "postgres_user": "$POSTGRES_USER",
  "components": {
    "db": $BACKUP_DB,
    "videos": $BACKUP_VIDEOS,
    "media": $BACKUP_MEDIA,
    "config": $BACKUP_CONFIG
  },
  "errors": $ERRORS
}
EOF

    # ── Remote transfer ───────────────────────────────────────────────────────
    if [[ -n "$BACKUP_REMOTE_URL" && "$BACKUP_TRANSFER_METHOD" != "local" ]]; then
        step "Remote transfer → $BACKUP_REMOTE_URL"
        case "$BACKUP_TRANSFER_METHOD" in
            rsync)
                SSH_OPTS="-o StrictHostKeyChecking=no -o BatchMode=yes"
                [[ -n "$BACKUP_SSH_KEY" ]] && SSH_OPTS="$SSH_OPTS -i $BACKUP_SSH_KEY"
                rsync -az --progress -e "ssh $SSH_OPTS" \
                    "$DEST/" "$BACKUP_REMOTE_URL/$TS/" && info "rsync complete" \
                    || { error "rsync failed"; ERRORS=$((ERRORS + 1)); }
                ;;
            scp)
                SSH_OPTS="-o StrictHostKeyChecking=no -o BatchMode=yes"
                [[ -n "$BACKUP_SSH_KEY" ]] && SSH_OPTS="$SSH_OPTS -i $BACKUP_SSH_KEY"
                # Extract host and path from BACKUP_REMOTE_URL (user@host:/path)
                REMOTE_HOST="${BACKUP_REMOTE_URL%%:*}"
                REMOTE_PATH="${BACKUP_REMOTE_URL#*:}"
                # shellcheck disable=SC2086
                ssh $SSH_OPTS "$REMOTE_HOST" "mkdir -p '$REMOTE_PATH/$TS'"
                # shellcheck disable=SC2086
                scp $SSH_OPTS -r "$DEST/" "$BACKUP_REMOTE_URL/$TS/" \
                    && info "scp complete" \
                    || { error "scp failed"; ERRORS=$((ERRORS + 1)); }
                ;;
            rclone)
                require_cmd rclone
                rclone copy "$DEST" "$BACKUP_REMOTE_URL/$TS" --progress \
                    && info "rclone complete" \
                    || { error "rclone failed"; ERRORS=$((ERRORS + 1)); }
                ;;
            *)
                warn "Unknown transfer method '$BACKUP_TRANSFER_METHOD' — skipping remote transfer"
                ;;
        esac
    fi

    # ── Retention: prune old local backups ────────────────────────────────────
    if [[ "$BACKUP_RETENTION_DAYS" -gt 0 ]]; then
        step "Pruning local backups older than $BACKUP_RETENTION_DAYS days"
        find "$BACKUP_LOCAL_DIR" -maxdepth 1 -mindepth 1 -type d \
            -mtime "+$BACKUP_RETENTION_DAYS" -print -exec rm -rf {} + 2>/dev/null \
            && info "Pruning complete" || true
    fi

    # ── Summary ───────────────────────────────────────────────────────────────
    echo ""
    if [[ "$ERRORS" -eq 0 ]]; then
        echo -e "${GREEN}${BOLD}Backup completed successfully${NC}"
    else
        echo -e "${YELLOW}${BOLD}Backup completed with $ERRORS error(s)${NC}"
    fi
    echo "  Location: $DEST"

    # ── Webhook notification ──────────────────────────────────────────────────
    if [[ -n "$BACKUP_WEBHOOK_URL" ]]; then
        STATUS="success"
        [[ "$ERRORS" -gt 0 ]] && STATUS="partial"
        curl -sf -X POST "$BACKUP_WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -d "{\"event\":\"backup\",\"status\":\"$STATUS\",\"timestamp\":\"$TS\",\"errors\":$ERRORS}" \
            &>/dev/null || true
    fi

    return "$ERRORS"
}

# ── Entry point ───────────────────────────────────────────────────────────────
case "${1:-run}" in
    --help|-h)
        head -12 "$0" | tail -10
        exit 0
        ;;
    --list|-l)
        do_list
        ;;
    --schedule|-s)
        do_schedule
        ;;
    run|--run|"")
        require_cmd docker
        do_backup
        ;;
    *)
        error "Unknown argument: $1"
        echo "Usage: $0 [--list|--schedule|--help]"
        exit 1
        ;;
esac
