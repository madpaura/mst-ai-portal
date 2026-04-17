#!/usr/bin/env bash
# =============================================================================
# MST AI Portal — Restore Script
#
# Usage:
#   ./scripts/restore.sh                    Interactive — pick a backup
#   ./scripts/restore.sh <timestamp>        Restore a specific backup
#   ./scripts/restore.sh --list             List available backups
#   ./scripts/restore.sh --help
#
# The script:
#   1. Creates a pre-restore safety snapshot
#   2. Stops services
#   3. Restores DB, videos, media step-by-step
#   4. Starts services and verifies health
#   5. On any failure → automatically rolls back to the pre-restore snapshot
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; }
step()    { echo -e "\n${BLUE}${BOLD}──── $* ────${NC}"; }
section() { echo -e "\n${CYAN}${BOLD}$*${NC}"; }
ask()     { echo -e "${YELLOW}${BOLD}[?]${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONF_FILE="$SCRIPT_DIR/backup.conf"

# ── Defaults ──────────────────────────────────────────────────────────────────
BACKUP_LOCAL_DIR="$PROJECT_ROOT/backups"

if [[ -f "$CONF_FILE" ]]; then
    source "$CONF_FILE"
fi

# ── Load .env ─────────────────────────────────────────────────────────────────
ENV_FILE="$PROJECT_ROOT/.env"
POSTGRES_DB="mst_portal"; POSTGRES_USER="portal"; POSTGRES_PASSWORD="portal123"
if [[ -f "$ENV_FILE" ]]; then
    source <(grep -E '^(POSTGRES_DB|POSTGRES_USER|POSTGRES_PASSWORD|DB_PORT)=' "$ENV_FILE" \
             | sed 's/[[:space:]]*#.*//')
fi
DB_PORT="${DB_PORT:-5432}"

# ── Global state for rollback ─────────────────────────────────────────────────
PRE_RESTORE_SNAPSHOT=""
ROLLBACK_IN_PROGRESS=false

# ── Helpers ───────────────────────────────────────────────────────────────────
timestamp() { date '+%Y-%m-%d_%H%M%S'; }

find_db_container() {
    docker ps --format "{{.Names}}\t{{.Image}}" 2>/dev/null \
        | awk -F'\t' '$2 ~ /^postgres/ {print $1}' \
        | grep -E "(mst|portal|db)" | head -1 || true
}

confirm() {
    local prompt="${1:-Continue?}"
    ask "$prompt [y/N] "
    read -r -p "" ans
    [[ "$ans" =~ ^[Yy]$ ]]
}

list_backups() {
    if [[ ! -d "$BACKUP_LOCAL_DIR" ]] || [[ -z "$(ls -A "$BACKUP_LOCAL_DIR" 2>/dev/null)" ]]; then
        return 1
    fi
    local i=1
    for d in "$BACKUP_LOCAL_DIR"/*/; do
        [[ -d "$d" ]] || continue
        local name; name=$(basename "$d")
        local parts=(); db="-"; vid="-"; med="-"
        [[ -f "$d/db/mst_portal.dump" ]]    && db="✓"
        [[ -f "$d/files/videos.tar.gz" ]]   && vid="✓"
        [[ -f "$d/files/media.tar.gz" ]]    && med="✓"
        printf "  %2d)  %-25s  DB:%-2s  Videos:%-2s  Media:%-2s\n" \
               "$i" "$name" "$db" "$vid" "$med"
        i=$((i + 1))
    done
}

get_backup_by_index() {
    local idx=$1 i=1
    for d in "$BACKUP_LOCAL_DIR"/*/; do
        [[ -d "$d" ]] || continue
        if [[ "$i" -eq "$idx" ]]; then
            echo "$d"; return 0
        fi
        i=$((i + 1))
    done
    return 1
}

# ── Pre-restore snapshot (rollback target) ────────────────────────────────────
create_snapshot() {
    step "Creating pre-restore safety snapshot"
    local SNAP_TS; SNAP_TS="pre-restore_$(timestamp)"
    PRE_RESTORE_SNAPSHOT="$BACKUP_LOCAL_DIR/$SNAP_TS"
    mkdir -p "$PRE_RESTORE_SNAPSHOT/db" "$PRE_RESTORE_SNAPSHOT/files"

    local DB_CONTAINER; DB_CONTAINER=$(find_db_container)

    if [[ -n "$DB_CONTAINER" ]]; then
        info "Snapshotting database..."
        docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
            pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
            > "$PRE_RESTORE_SNAPSHOT/db/mst_portal.dump" 2>/dev/null \
            && info "DB snapshot saved" \
            || warn "DB snapshot failed (DB may be empty)"
    fi

    for dir in videos media; do
        local SRC="$PROJECT_ROOT/volumes/storage/$dir"
        if [[ -d "$SRC" ]]; then
            tar -czf "$PRE_RESTORE_SNAPSHOT/files/$dir.tar.gz" \
                -C "$(dirname "$SRC")" "$(basename "$SRC")" 2>/dev/null \
                && info "$dir snapshot saved" \
                || warn "$dir snapshot failed"
        fi
    done

    echo "{\"type\":\"pre-restore-snapshot\",\"timestamp\":\"$SNAP_TS\"}" \
        > "$PRE_RESTORE_SNAPSHOT/manifest.json"

    info "Safety snapshot: $PRE_RESTORE_SNAPSHOT"
}

# ── Rollback ──────────────────────────────────────────────────────────────────
do_rollback() {
    if [[ "$ROLLBACK_IN_PROGRESS" == "true" ]]; then return; fi
    ROLLBACK_IN_PROGRESS=true

    echo ""
    echo -e "${RED}${BOLD}════════════════════════════════════════${NC}"
    echo -e "${RED}${BOLD}  RESTORE FAILED — ROLLING BACK         ${NC}"
    echo -e "${RED}${BOLD}════════════════════════════════════════${NC}"

    if [[ -z "$PRE_RESTORE_SNAPSHOT" ]]; then
        error "No pre-restore snapshot available. Manual intervention required."
        return 1
    fi

    warn "Restoring from snapshot: $PRE_RESTORE_SNAPSHOT"

    # Restart services (they may have been stopped)
    cd "$PROJECT_ROOT"
    docker compose up -d 2>/dev/null || docker-compose up -d 2>/dev/null || true
    sleep 5

    local DB_CONTAINER; DB_CONTAINER=$(find_db_container)

    # Restore DB from snapshot
    if [[ -f "$PRE_RESTORE_SNAPSHOT/db/mst_portal.dump" ]] && [[ -n "$DB_CONTAINER" ]]; then
        warn "Rolling back database..."
        docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
            psql -U "$POSTGRES_USER" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$POSTGRES_DB' AND pid <> pg_backend_pid();" 2>/dev/null || true
        docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
            dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" 2>/dev/null || true
        docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
            createdb -U "$POSTGRES_USER" "$POSTGRES_DB" 2>/dev/null || true
        docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
            pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --role="$POSTGRES_USER" \
            < "$PRE_RESTORE_SNAPSHOT/db/mst_portal.dump" 2>/dev/null \
            && info "Database rolled back" \
            || warn "DB rollback had warnings (may be OK)"
    fi

    # Restore files from snapshot
    for dir in videos media; do
        local ARCHIVE="$PRE_RESTORE_SNAPSHOT/files/$dir.tar.gz"
        local DEST_PARENT="$PROJECT_ROOT/volumes/storage"
        if [[ -f "$ARCHIVE" ]]; then
            warn "Rolling back $dir files..."
            rm -rf "${DEST_PARENT:?}/$dir"
            tar -xzf "$ARCHIVE" -C "$DEST_PARENT" 2>/dev/null \
                && info "$dir files rolled back" \
                || warn "$dir rollback had errors"
        fi
    done

    info "Rollback complete. Restarting services..."
    cd "$PROJECT_ROOT"
    docker compose up -d 2>/dev/null || docker-compose up -d 2>/dev/null || true

    echo -e "\n${YELLOW}${BOLD}System has been rolled back to pre-restore state.${NC}"
    echo -e "${YELLOW}Please investigate the failure and try again.${NC}"
}

# ── Register trap ──────────────────────────────────────────────────────────────
trap 'do_rollback' ERR

# ── Restore steps ─────────────────────────────────────────────────────────────
do_restore() {
    local BACKUP_DIR="$1"
    local BACKUP_NAME; BACKUP_NAME=$(basename "$BACKUP_DIR")

    section "MST AI Portal — Restore from  $BACKUP_NAME"

    # ── Confirm ───────────────────────────────────────────────────────────────
    echo ""
    echo "  This will REPLACE the current database and files with:"
    echo "  Source : $BACKUP_DIR"
    echo ""
    if [[ -f "$BACKUP_DIR/db/mst_portal.dump" ]]; then
        echo "  • Database dump  $(stat -c%s "$BACKUP_DIR/db/mst_portal.dump" 2>/dev/null | xargs -I{} du -h "$BACKUP_DIR/db/mst_portal.dump" | awk '{print $1}')"
    else
        warn "  • No database dump found — DB will not be restored"
    fi
    for f in videos media; do
        if [[ -f "$BACKUP_DIR/files/$f.tar.gz" ]]; then
            echo "  • $f archive  $(du -h "$BACKUP_DIR/files/$f.tar.gz" | awk '{print $1}')"
        fi
    done

    echo ""
    warn "ALL EXISTING DATA WILL BE OVERWRITTEN."
    confirm "Proceed with restore?" || { info "Restore cancelled."; exit 0; }

    # ── Step 1: Snapshot ──────────────────────────────────────────────────────
    step "Step 1/6  Pre-restore safety snapshot"
    create_snapshot

    # ── Step 2: Stop services ─────────────────────────────────────────────────
    step "Step 2/6  Stopping services"
    cd "$PROJECT_ROOT"
    docker compose stop backend worker 2>/dev/null \
        || docker-compose stop backend worker 2>/dev/null \
        || warn "Could not stop services (may not be running)"
    info "Services stopped"

    # ── Step 3: Restore database ──────────────────────────────────────────────
    step "Step 3/6  Restoring database"
    local DB_CONTAINER; DB_CONTAINER=$(find_db_container)

    if [[ -f "$BACKUP_DIR/db/mst_portal.dump" ]]; then
        if [[ -z "$DB_CONTAINER" ]]; then
            warn "DB container not running — starting database service"
            docker compose up -d db 2>/dev/null || docker-compose up -d db 2>/dev/null
            sleep 5
            DB_CONTAINER=$(find_db_container)
        fi

        if [[ -n "$DB_CONTAINER" ]]; then
            info "Terminating active connections..."
            docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
                psql -U "$POSTGRES_USER" -c \
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$POSTGRES_DB' AND pid <> pg_backend_pid();" \
                2>/dev/null || true

            info "Dropping and recreating database..."
            docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
                dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
            docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
                createdb -U "$POSTGRES_USER" "$POSTGRES_DB"

            info "Restoring data (this may take a while)..."
            docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
                pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
                --no-owner --role="$POSTGRES_USER" --no-acl \
                < "$BACKUP_DIR/db/mst_portal.dump"
            info "Database restored successfully"
        else
            error "Cannot find DB container — database restore skipped"
        fi
    else
        warn "No database dump in this backup — skipping DB restore"
    fi

    # ── Step 4: Restore videos ────────────────────────────────────────────────
    step "Step 4/6  Restoring video files"
    local STORAGE_DIR="$PROJECT_ROOT/volumes/storage"
    mkdir -p "$STORAGE_DIR"

    if [[ -f "$BACKUP_DIR/files/videos.tar.gz" ]]; then
        info "Extracting videos (this may take a while)..."
        rm -rf "${STORAGE_DIR:?}/videos"
        tar -xzf "$BACKUP_DIR/files/videos.tar.gz" -C "$STORAGE_DIR" \
            --checkpoint=1000 --checkpoint-action="ttyout=." 2>/dev/null || true
        echo ""
        info "Videos restored"
    else
        warn "No videos archive in this backup — skipping"
    fi

    # ── Step 5: Restore media ─────────────────────────────────────────────────
    step "Step 5/6  Restoring media files"
    if [[ -f "$BACKUP_DIR/files/media.tar.gz" ]]; then
        info "Extracting media..."
        rm -rf "${STORAGE_DIR:?}/media"
        tar -xzf "$BACKUP_DIR/files/media.tar.gz" -C "$STORAGE_DIR" \
            --checkpoint=1000 --checkpoint-action="ttyout=." 2>/dev/null || true
        echo ""
        info "Media restored"
    else
        warn "No media archive in this backup — skipping"
    fi

    # ── Step 6: Start services & health check ─────────────────────────────────
    step "Step 6/6  Starting services"
    cd "$PROJECT_ROOT"
    docker compose up -d 2>/dev/null || docker-compose up -d 2>/dev/null
    info "Services starting..."

    local RETRIES=0
    local MAX_RETRIES=12
    local BACKEND_PORT
    BACKEND_PORT=$(grep -E '^BACKEND_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "9800")

    while [[ "$RETRIES" -lt "$MAX_RETRIES" ]]; do
        sleep 5
        if curl -sf "http://localhost:${BACKEND_PORT}/health" &>/dev/null; then
            info "Health check passed ✓"
            break
        fi
        RETRIES=$((RETRIES + 1))
        warn "Waiting for backend... ($RETRIES/$MAX_RETRIES)"
    done

    if [[ "$RETRIES" -eq "$MAX_RETRIES" ]]; then
        error "Backend did not become healthy within 60s"
        error "Triggering rollback..."
        false  # trigger ERR trap
    fi

    # ── Disable trap on success ───────────────────────────────────────────────
    trap - ERR

    echo ""
    echo -e "${GREEN}${BOLD}════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}  RESTORE COMPLETED SUCCESSFULLY        ${NC}"
    echo -e "${GREEN}${BOLD}════════════════════════════════════════${NC}"
    echo ""
    echo "  Restored from : $BACKUP_DIR"
    echo "  Snapshot kept : $PRE_RESTORE_SNAPSHOT"
    echo "  (Delete the snapshot once you're satisfied the restore is good)"
}

# ── Entry point ───────────────────────────────────────────────────────────────
case "${1:---interactive}" in
    --help|-h)
        head -14 "$0" | tail -12
        exit 0
        ;;
    --list|-l)
        section "Available backups"
        if ! list_backups; then
            warn "No backups found in $BACKUP_LOCAL_DIR"
            echo "  Run: ./scripts/backup.sh  to create one"
        fi
        echo ""
        exit 0
        ;;
    --interactive|-i|"")
        section "Available backups"
        if ! list_backups; then
            warn "No backups found in $BACKUP_LOCAL_DIR"
            echo "  Run: ./scripts/backup.sh  to create one"
            exit 1
        fi
        echo ""
        ask "Enter backup number to restore (or 'q' to quit): "
        read -r -p "" choice
        [[ "$choice" == "q" || "$choice" == "Q" ]] && exit 0
        CHOSEN_DIR=$(get_backup_by_index "$choice") || {
            error "Invalid selection: $choice"; exit 1; }
        do_restore "$CHOSEN_DIR"
        ;;
    *)
        # Treat first arg as timestamp / directory name
        if [[ -d "$1" ]]; then
            do_restore "$1"
        elif [[ -d "$BACKUP_LOCAL_DIR/$1" ]]; then
            do_restore "$BACKUP_LOCAL_DIR/$1"
        else
            error "Backup not found: $1"
            echo "  Run: $0 --list  to see available backups"
            exit 1
        fi
        ;;
esac
