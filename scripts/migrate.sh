#!/usr/bin/env bash
# =============================================================================
# MST AI Portal — Server Migration Script
#
# Migrates a running portal to a new server, step by step, with
# automatic rollback (restart on old server) if any step fails.
#
# Usage:
#   ./scripts/migrate.sh --target user@new-host         Full migration
#   ./scripts/migrate.sh --target user@new-host --dry-run  Simulate only
#   ./scripts/migrate.sh --help
#
# Pre-requisites on NEW server:
#   • Docker + Docker Compose installed
#   • SSH access from this machine (key-based preferred)
#   • Same OS architecture as current server
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
BACKUP_SSH_KEY=""

[[ -f "$CONF_FILE" ]] && source "$CONF_FILE"

ENV_FILE="$PROJECT_ROOT/.env"
POSTGRES_DB="mst_portal"; POSTGRES_USER="portal"; POSTGRES_PASSWORD="portal123"
if [[ -f "$ENV_FILE" ]]; then
    source <(grep -E '^(POSTGRES_DB|POSTGRES_USER|POSTGRES_PASSWORD|DB_PORT|BACKEND_PORT)=' \
             "$ENV_FILE" | sed 's/[[:space:]]*#.*//')
fi
DB_PORT="${DB_PORT:-5432}"
BACKEND_PORT="${BACKEND_PORT:-9800}"

# ── Parse args ────────────────────────────────────────────────────────────────
TARGET_HOST=""
DRY_RUN=false
REMOTE_DIR="/opt/mst-ai-portal"
SSH_KEY_OPT=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --target|-t) TARGET_HOST="$2"; shift 2 ;;
        --remote-dir) REMOTE_DIR="$2"; shift 2 ;;
        --ssh-key) SSH_KEY_OPT="-i $2"; shift 2 ;;
        --dry-run|-n) DRY_RUN=true; shift ;;
        --help|-h)
            head -16 "$0" | tail -14; exit 0 ;;
        *) error "Unknown argument: $1"; exit 1 ;;
    esac
done

[[ -n "$BACKUP_SSH_KEY" && -z "$SSH_KEY_OPT" ]] && SSH_KEY_OPT="-i $BACKUP_SSH_KEY"

# ── State ─────────────────────────────────────────────────────────────────────
MIGRATION_BACKUP=""
SERVICES_STOPPED_LOCALLY=false
ROLLBACK_IN_PROGRESS=false

# ── Dry-run wrapper ───────────────────────────────────────────────────────────
run() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "  ${CYAN}[DRY-RUN]${NC} $*"
    else
        "$@"
    fi
}

# ── SSH helpers ───────────────────────────────────────────────────────────────
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes $SSH_KEY_OPT"

remote_run() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "  ${CYAN}[DRY-RUN @ $TARGET_HOST]${NC} $*"
        return 0
    fi
    # shellcheck disable=SC2086
    ssh $SSH_OPTS "$TARGET_HOST" "$@"
}

remote_rsync() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "  ${CYAN}[DRY-RUN]${NC} rsync $*"
        return 0
    fi
    # shellcheck disable=SC2086
    rsync $SSH_OPTS_RSYNC "$@"
}

SSH_OPTS_RSYNC="-az --progress -e \"ssh $SSH_OPTS\""

find_db_container() {
    docker ps --format "{{.Names}}\t{{.Image}}" 2>/dev/null \
        | awk -F'\t' '$2 ~ /^postgres/ {print $1}' \
        | grep -E "(mst|portal|db)" | head -1 || true
}

# ── Rollback ──────────────────────────────────────────────────────────────────
do_rollback() {
    [[ "$ROLLBACK_IN_PROGRESS" == "true" ]] && return
    ROLLBACK_IN_PROGRESS=true

    echo ""
    echo -e "${RED}${BOLD}════════════════════════════════════════════════${NC}"
    echo -e "${RED}${BOLD}  MIGRATION FAILED — ROLLING BACK (OLD SERVER)  ${NC}"
    echo -e "${RED}${BOLD}════════════════════════════════════════════════${NC}"

    warn "Restarting services on this (source) server..."
    cd "$PROJECT_ROOT"
    docker compose up -d 2>/dev/null || docker-compose up -d 2>/dev/null || true

    echo ""
    warn "The original server has been restarted."
    warn "The new server may be in a partial state — verify before using it."
    [[ -n "$MIGRATION_BACKUP" ]] && \
        warn "Migration backup: $MIGRATION_BACKUP"
}

trap 'do_rollback' ERR

# ── Preflight ─────────────────────────────────────────────────────────────────
preflight() {
    step "Pre-flight checks"

    # Local requirements
    for cmd in docker rsync ssh; do
        if command -v "$cmd" &>/dev/null; then
            info "$cmd ✓"
        else
            error "$cmd not found"
            exit 1
        fi
    done

    # SSH connectivity
    info "Testing SSH connection to $TARGET_HOST..."
    if ! remote_run "echo 'SSH_OK'" 2>/dev/null | grep -q "SSH_OK" && [[ "$DRY_RUN" == "false" ]]; then
        error "Cannot SSH into $TARGET_HOST"
        error "Make sure:"
        error "  • The server is reachable"
        error "  • SSH key is set up (ssh-copy-id $TARGET_HOST)"
        echo ""
        ask "Try with password auth? [y/N] "
        read -r ans
        if [[ "$ans" =~ ^[Yy]$ ]]; then
            SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 $SSH_KEY_OPT"
            SSH_OPTS_RSYNC="-az --progress -e \"ssh $SSH_OPTS\""
            remote_run "echo SSH_OK" | grep -q "SSH_OK" || { error "Still cannot connect"; exit 1; }
        else
            exit 1
        fi
    fi
    info "SSH connection OK"

    # Docker on remote
    if ! remote_run "docker info &>/dev/null && echo DOCKER_OK" 2>/dev/null | grep -q "DOCKER_OK" \
            && [[ "$DRY_RUN" == "false" ]]; then
        error "Docker is not running on $TARGET_HOST"
        error "Install Docker: https://docs.docker.com/engine/install/"
        exit 1
    fi
    info "Docker on remote ✓"
}

# ── Step display helper ───────────────────────────────────────────────────────
progress_header() {
    local current=$1 total=$2 title=$3
    echo ""
    echo -e "${BLUE}${BOLD}┌────────────────────────────────────────┐${NC}"
    printf "${BLUE}${BOLD}│  Step %d/%d  %-32s │${NC}\n" "$current" "$total" "$title"
    echo -e "${BLUE}${BOLD}└────────────────────────────────────────┘${NC}"
}

# ── Main migration ────────────────────────────────────────────────────────────
do_migrate() {
    local TOTAL_STEPS=8
    local TS; TS=$(date '+%Y-%m-%d_%H%M%S')

    section "MST AI Portal — Server Migration"
    echo ""
    echo "  Source (this) : $(hostname)"
    echo "  Target        : $TARGET_HOST"
    echo "  Remote dir    : $REMOTE_DIR"
    echo "  Dry-run       : $DRY_RUN"
    echo ""

    if [[ "$DRY_RUN" == "true" ]]; then
        warn "DRY-RUN MODE — no changes will be made"
    fi

    echo -e "${YELLOW}${BOLD}Migration steps:${NC}"
    echo "  1. Pre-flight checks"
    echo "  2. Final backup on source server"
    echo "  3. Transfer project files to new server"
    echo "  4. Transfer backup (DB + media) to new server"
    echo "  5. Configure environment on new server"
    echo "  6. Start services on new server"
    echo "  7. Health check on new server"
    echo "  8. Stop services on source server (cutover)"
    echo ""
    echo -e "${RED}${BOLD}This is the final cutover. Services on the OLD server will be stopped.${NC}"
    echo ""
    ask "Proceed with migration to $TARGET_HOST? [y/N] "
    read -r -p "" ans
    [[ "$ans" =~ ^[Yy]$ ]] || { info "Migration cancelled."; exit 0; }

    # ── STEP 1: Pre-flight ────────────────────────────────────────────────────
    progress_header 1 $TOTAL_STEPS "Pre-flight checks"
    preflight

    # ── STEP 2: Final backup ──────────────────────────────────────────────────
    progress_header 2 $TOTAL_STEPS "Final backup on source"
    info "Creating migration backup..."
    if [[ "$DRY_RUN" == "false" ]]; then
        "$SCRIPT_DIR/backup.sh" run
        # Find the newest backup
        MIGRATION_BACKUP=$(ls -td "$BACKUP_LOCAL_DIR"/*/ 2>/dev/null | head -1 || true)
        [[ -n "$MIGRATION_BACKUP" ]] && info "Backup: $MIGRATION_BACKUP" \
            || warn "No backup found — continuing without one"
    else
        echo -e "  ${CYAN}[DRY-RUN]${NC} Would run backup.sh"
        MIGRATION_BACKUP="$BACKUP_LOCAL_DIR/dry-run-backup"
    fi

    # ── STEP 3: Transfer project files ────────────────────────────────────────
    progress_header 3 $TOTAL_STEPS "Transfer project files"
    info "Creating remote directory..."
    remote_run "mkdir -p $REMOTE_DIR"

    info "Syncing project (code + config, excluding volumes)..."
    eval rsync -az --progress \
        --exclude='volumes/' \
        --exclude='backups/' \
        --exclude='node_modules/' \
        --exclude='.git/' \
        --exclude='api/venv/' \
        --exclude='api/__pycache__/' \
        --exclude='react-portal/dist/' \
        -e "\"ssh $SSH_OPTS\"" \
        "\"$PROJECT_ROOT/\"" \
        "\"$TARGET_HOST:$REMOTE_DIR/\"" 2>/dev/null \
    || run rsync -az \
        --exclude='volumes/' --exclude='backups/' --exclude='node_modules/' \
        --exclude='.git/' --exclude='api/venv/' \
        -e "ssh $SSH_OPTS" \
        "$PROJECT_ROOT/" "$TARGET_HOST:$REMOTE_DIR/"
    info "Project files transferred"

    # ── STEP 4: Transfer backup (DB + data) ───────────────────────────────────
    progress_header 4 $TOTAL_STEPS "Transfer data backup"
    if [[ -n "$MIGRATION_BACKUP" && -d "$MIGRATION_BACKUP" ]]; then
        info "Syncing backup to new server..."
        remote_run "mkdir -p $REMOTE_DIR/backups"
        run rsync -az --progress \
            -e "ssh $SSH_OPTS" \
            "$MIGRATION_BACKUP/" \
            "$TARGET_HOST:$REMOTE_DIR/backups/migration_$TS/"
        info "Backup transferred"
    else
        warn "No backup to transfer — new server will start fresh"
    fi

    # ── STEP 5: Configure environment ─────────────────────────────────────────
    progress_header 5 $TOTAL_STEPS "Configure new server"

    info "Setting up volumes directory..."
    remote_run "mkdir -p $REMOTE_DIR/volumes/storage/videos $REMOTE_DIR/volumes/storage/media $REMOTE_DIR/volumes/pg-data"

    # Run restore on the new server if we have a backup
    if [[ -n "$MIGRATION_BACKUP" && "$DRY_RUN" == "false" ]]; then
        info "Restoring backup on new server..."
        remote_run "
            cd $REMOTE_DIR
            # Non-interactive restore: pass the backup dir directly
            export BACKUP_DIR=$REMOTE_DIR/backups/migration_$TS
            chmod +x scripts/restore.sh scripts/backup.sh

            # Start only the DB service first
            docker compose up -d db 2>/dev/null || docker-compose up -d db 2>/dev/null
            sleep 8

            # Restore database
            DB_CONTAINER=\$(docker ps --filter 'ancestor=postgres' --format '{{.Names}}' | grep -E '(mst|portal|db)' | head -1 || true)
            if [[ -n \"\$DB_CONTAINER\" && -f \"\$BACKUP_DIR/db/mst_portal.dump\" ]]; then
                docker exec -e PGPASSWORD='$POSTGRES_PASSWORD' \"\$DB_CONTAINER\" \
                    dropdb -U '$POSTGRES_USER' --if-exists '$POSTGRES_DB' 2>/dev/null || true
                docker exec -e PGPASSWORD='$POSTGRES_PASSWORD' \"\$DB_CONTAINER\" \
                    createdb -U '$POSTGRES_USER' '$POSTGRES_DB' 2>/dev/null
                docker exec -i -e PGPASSWORD='$POSTGRES_PASSWORD' \"\$DB_CONTAINER\" \
                    pg_restore -U '$POSTGRES_USER' -d '$POSTGRES_DB' \
                    --no-owner --role='$POSTGRES_USER' --no-acl \
                    < \"\$BACKUP_DIR/db/mst_portal.dump\"
                echo 'Database restored on new server'
            else
                echo 'No DB container or dump found — skipping DB restore'
            fi

            # Restore files
            for dir in videos media; do
                archive=\"\$BACKUP_DIR/files/\${dir}.tar.gz\"
                if [[ -f \"\$archive\" ]]; then
                    rm -rf $REMOTE_DIR/volumes/storage/\$dir
                    tar -xzf \"\$archive\" -C $REMOTE_DIR/volumes/storage/
                    echo \"\${dir} files restored\"
                fi
            done
        "
        info "Data restored on new server"
    else
        [[ "$DRY_RUN" == "true" ]] && echo -e "  ${CYAN}[DRY-RUN]${NC} Would restore data on new server"
    fi

    # ── STEP 6: Start services on new server ─────────────────────────────────
    progress_header 6 $TOTAL_STEPS "Start services on new server"
    info "Starting all services on $TARGET_HOST..."
    remote_run "
        cd $REMOTE_DIR
        docker compose pull 2>/dev/null || true
        docker compose up -d 2>/dev/null || docker-compose up -d 2>/dev/null
        echo 'Services started'
    "
    info "Services started on new server"

    # ── STEP 7: Health check on new server ────────────────────────────────────
    progress_header 7 $TOTAL_STEPS "Health check on new server"
    info "Waiting for backend to become healthy..."

    local RETRIES=0
    local MAX_RETRIES=18

    while [[ "$RETRIES" -lt "$MAX_RETRIES" ]]; do
        sleep 5
        if [[ "$DRY_RUN" == "true" ]]; then
            info "Health check simulated ✓"
            break
        fi
        if remote_run "curl -sf http://localhost:${BACKEND_PORT}/health" 2>/dev/null; then
            info "Backend healthy on new server ✓"
            break
        fi
        RETRIES=$((RETRIES + 1))
        warn "Waiting... ($RETRIES/$MAX_RETRIES)"
    done

    if [[ "$RETRIES" -eq "$MAX_RETRIES" ]]; then
        error "Backend did not become healthy on new server within 90s"
        error "New server may have misconfigured services. Check logs:"
        error "  ssh $TARGET_HOST 'cd $REMOTE_DIR && docker compose logs --tail=50'"
        false  # trigger rollback
    fi

    # ── STEP 8: Stop source server (final cutover) ────────────────────────────
    progress_header 8 $TOTAL_STEPS "Cutover — stop source server"
    echo ""
    warn "The new server is healthy. Ready to stop the OLD server."
    warn "After this step, traffic must be pointed to: $TARGET_HOST"
    echo ""
    ask "Stop services on THIS server now? [y/N] "
    read -r -p "" cutover_ans

    if [[ "$cutover_ans" =~ ^[Yy]$ ]]; then
        SERVICES_STOPPED_LOCALLY=true
        run docker compose stop 2>/dev/null || run docker-compose stop 2>/dev/null
        info "Source server services stopped"
    else
        warn "Source server NOT stopped. You'll need to stop it manually."
        warn "  cd $PROJECT_ROOT && docker compose stop"
    fi

    # ── Disable rollback trap ─────────────────────────────────────────────────
    trap - ERR

    echo ""
    echo -e "${GREEN}${BOLD}════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}  MIGRATION COMPLETED SUCCESSFULLY              ${NC}"
    echo -e "${GREEN}${BOLD}════════════════════════════════════════════════${NC}"
    echo ""
    echo "  New server   : $TARGET_HOST"
    echo "  Project dir  : $REMOTE_DIR"
    echo ""
    echo -e "${YELLOW}${BOLD}Next steps:${NC}"
    echo "  1. Update your DNS / load-balancer to point to $TARGET_HOST"
    echo "  2. Verify the application at http://$TARGET_HOST:$BACKEND_PORT"
    echo "  3. Test all functionality before decommissioning the old server"
    echo "  4. Run backups from the new server going forward"
    echo ""
    echo "  New server logs:"
    echo "    ssh $TARGET_HOST 'cd $REMOTE_DIR && docker compose logs -f'"
}

# ── Entry point ───────────────────────────────────────────────────────────────
if [[ -z "$TARGET_HOST" ]]; then
    error "No target host specified."
    echo "  Usage: $0 --target user@new-server-ip [--dry-run]"
    echo "  Run $0 --help for full usage."
    exit 1
fi
do_migrate
