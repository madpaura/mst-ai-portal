#!/bin/bash
# MST AI Portal — Docker Setup & Prerequisite Checker
# Usage: ./setup.sh [deploy|check|down|logs]

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✔${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✘${NC} $1"; }
header() { echo -e "\n${BLUE}── $1 ──${NC}"; }

ERRORS=0

# ── Prerequisite checks ───────────────────────────────────

check_prereqs() {
    header "Checking Prerequisites"

    # Docker
    if command -v docker &>/dev/null; then
        ver=$(docker --version | grep -oP '\d+\.\d+\.\d+')
        ok "Docker $ver"
    else
        fail "Docker not found — install from https://docs.docker.com/get-docker/"
        ERRORS=$((ERRORS+1))
    fi

    # Docker Compose
    if docker compose version &>/dev/null; then
        ver=$(docker compose version --short 2>/dev/null || echo "v2+")
        ok "Docker Compose $ver"
    elif command -v docker-compose &>/dev/null; then
        ver=$(docker-compose --version | grep -oP '\d+\.\d+\.\d+')
        ok "Docker Compose (legacy) $ver"
    else
        fail "Docker Compose not found"
        ERRORS=$((ERRORS+1))
    fi

    # Docker daemon running
    if docker info &>/dev/null; then
        ok "Docker daemon is running"
    else
        fail "Docker daemon is not running — start Docker first"
        ERRORS=$((ERRORS+1))
    fi

    # NVIDIA GPU (optional)
    header "GPU Support (optional)"
    if command -v nvidia-smi &>/dev/null; then
        gpu=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
        ok "NVIDIA GPU detected: $gpu"

        if dpkg -l nvidia-container-toolkit &>/dev/null 2>&1 || \
           rpm -q nvidia-container-toolkit &>/dev/null 2>&1; then
            ok "nvidia-container-toolkit installed"
            echo -e "     ${GREEN}→${NC} Uncomment the 'deploy' section in docker-compose.yml to enable GPU transcoding"
        else
            warn "nvidia-container-toolkit not installed"
            echo "     Install: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html"
        fi
    else
        warn "No NVIDIA GPU detected — transcoding will use CPU (slower but works fine)"
    fi

    # Disk space
    header "Disk Space"
    avail=$(df -BG . | tail -1 | awk '{print $4}' | tr -d 'G')
    if [ "$avail" -ge 20 ]; then
        ok "${avail}GB available (recommended: 20GB+)"
    elif [ "$avail" -ge 5 ]; then
        warn "${avail}GB available — may be tight for video storage"
    else
        fail "${avail}GB available — insufficient disk space"
        ERRORS=$((ERRORS+1))
    fi

    # Port conflicts
    header "Port Availability"
    for port_var in "80:FRONTEND_PORT" "8000:BACKEND_PORT" "5432:DB_PORT"; do
        port="${port_var%%:*}"
        name="${port_var##*:}"
        if [ -f .env ]; then
            custom=$(grep "^${name}=" .env 2>/dev/null | cut -d= -f2)
            [ -n "$custom" ] && port="$custom"
        fi
        if ss -tlnp 2>/dev/null | grep -q ":${port} " || \
           lsof -i ":${port}" &>/dev/null; then
            warn "Port $port ($name) is in use — change in .env or stop the conflicting service"
        else
            ok "Port $port ($name) is free"
        fi
    done

    # .env file
    header "Configuration"
    if [ -f .env ]; then
        ok ".env file found"
    else
        warn ".env not found — copying from .env.example (edit for production)"
        cp .env.example .env
        ok "Created .env from .env.example"
    fi

    echo ""
    if [ "$ERRORS" -gt 0 ]; then
        echo -e "${RED}Found $ERRORS blocking issue(s). Fix them before deploying.${NC}"
        exit 1
    else
        echo -e "${GREEN}All prerequisites met. Run './setup.sh deploy' to start.${NC}"
    fi
}

# ── Deploy ────────────────────────────────────────────────

deploy() {
    header "Deploying MST AI Portal"

    if [ ! -f .env ]; then
        echo "No .env file found. Creating from .env.example..."
        cp .env.example .env
    fi

    echo "Building and starting containers..."
    if docker compose version &>/dev/null; then
        docker compose build
        docker compose up -d
    else
        docker-compose build
        docker-compose up -d
    fi

    echo ""
    header "Waiting for services to be healthy"
    for i in $(seq 1 30); do
        if curl -sf http://localhost:${BACKEND_PORT:-8000}/health &>/dev/null; then
            ok "Backend is healthy"
            break
        fi
        [ "$i" -eq 30 ] && warn "Backend not yet healthy — check logs with './setup.sh logs backend'"
        sleep 2
    done

    echo ""
    header "Deployment Complete"
    echo -e "  Frontend:    ${GREEN}http://localhost:${FRONTEND_PORT:-80}${NC}"
    echo -e "  Backend API: ${GREEN}http://localhost:${BACKEND_PORT:-8000}${NC}"
    echo -e "  API Docs:    ${GREEN}http://localhost:${BACKEND_PORT:-8000}/docs${NC}"
    echo -e "  Admin Panel: ${GREEN}http://localhost:${FRONTEND_PORT:-80}/admin/videos${NC}"
    echo -e "  Default Login: admin / admin"
    echo ""
    echo "  Useful commands:"
    echo "    ./setup.sh logs backend    # Backend logs"
    echo "    ./setup.sh logs worker     # Worker logs"
    echo "    ./setup.sh down            # Stop all containers"
}

# ── Down ──────────────────────────────────────────────────

down() {
    header "Stopping all containers"
    if docker compose version &>/dev/null; then
        docker compose down
    else
        docker-compose down
    fi
    ok "All containers stopped"
}

# ── Logs ──────────────────────────────────────────────────

show_logs() {
    local svc="${1:-}"
    if [ -z "$svc" ]; then
        echo "Usage: ./setup.sh logs [backend|worker|frontend|db]"
        exit 1
    fi
    if docker compose version &>/dev/null; then
        docker compose logs -f "$svc"
    else
        docker-compose logs -f "$svc"
    fi
}

# ── Main ──────────────────────────────────────────────────

case "${1:-check}" in
    check)   check_prereqs ;;
    deploy)  check_prereqs && deploy ;;
    down)    down ;;
    logs)    show_logs "$2" ;;
    *)
        echo "MST AI Portal — Docker Setup"
        echo ""
        echo "Usage: ./setup.sh [command]"
        echo ""
        echo "  check    Check prerequisites (default)"
        echo "  deploy   Build and start all containers"
        echo "  down     Stop all containers"
        echo "  logs     Show logs: ./setup.sh logs [backend|worker|frontend|db]"
        ;;
esac
