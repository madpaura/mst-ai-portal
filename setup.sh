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
GPU_AVAILABLE=false

# ── GPU detection helper ─────────────────────────────────

detect_gpu() {
    # Check for NVIDIA GPU + nvidia-container-toolkit
    if command -v nvidia-smi &>/dev/null; then
        if nvidia-smi &>/dev/null; then
            if dpkg -l nvidia-container-toolkit &>/dev/null 2>&1 || \
               rpm -q nvidia-container-toolkit &>/dev/null 2>&1; then
                GPU_AVAILABLE=true
                return 0
            fi
        fi
    fi
    GPU_AVAILABLE=false
    return 1
}

# Helper: pick compose command (v2 plugin vs legacy standalone)
compose_cmd() {
    if docker compose version &>/dev/null; then
        echo "docker compose"
    else
        echo "docker-compose"
    fi
}

# Helper: compose files based on GPU availability
compose_files() {
    detect_gpu
    if [ "$GPU_AVAILABLE" = true ]; then
        echo "-f docker-compose.yml -f docker-compose.gpu.yml"
    else
        echo "-f docker-compose.yml"
    fi
}

ensure_env_var() {
    local key="$1"
    local value="$2"

    if [ ! -f .env ]; then
        return
    fi

    if grep -q "^${key}=" .env 2>/dev/null; then
        return
    fi

    echo "${key}=${value}" >> .env
}

ensure_runtime_env() {
    ensure_env_var "BACKEND_PORT" "8000"
    ensure_env_var "FRONTEND_PORT" "9800"
    ensure_env_var "VITE_API_URL" "http://localhost:${BACKEND_PORT:-8000}"
    ensure_env_var "OLLAMA_BASE_URL" "http://localhost:11434"
    ensure_env_var "VIDEO_DATA_VOLUME" "./volumes/storage/videos"
    ensure_env_var "MEDIA_DATA_VOLUME" "./volumes/storage/media"
    ensure_env_var "PG_DATA_VOLUME" "./volumes/pg-data"
}

# ── Prerequisite checks ───────────────────────────────────

check_prereqs() {
    header "Checking Prerequisites"

    ensure_runtime_env

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
        echo "  Installing Docker Compose v2..."
        mkdir -p ~/.docker/cli-plugins && curl -SL "https://github.com/docker/compose/releases/download/v2.32.4/docker-compose-linux-x86_64" -o ~/.docker/cli-plugins/docker-compose && chmod +x ~/.docker/cli-plugins/docker-compose
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
        if nvidia-smi &>/dev/null; then
            gpu=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
            ok "NVIDIA GPU detected: $gpu"

            if dpkg -l nvidia-container-toolkit &>/dev/null 2>&1 || \
               rpm -q nvidia-container-toolkit &>/dev/null 2>&1; then
                ok "nvidia-container-toolkit installed"
                ok "GPU transcoding will be enabled automatically"
                GPU_AVAILABLE=true
            else
                warn "nvidia-container-toolkit not installed — GPU transcoding disabled"
                echo -e "     Run ${YELLOW}./setup.sh setup-gpu${NC} to install it, or see:"
                echo "     https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html"
            fi
        else
            warn "NVIDIA GPU found but driver not responding — transcoding will use CPU"
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

    ensure_runtime_env

    local COMPOSE=$(compose_cmd)
    local FILES=$(compose_files)

    if [ "$GPU_AVAILABLE" = true ]; then
        ok "GPU detected — worker will use NVIDIA NVENC acceleration"
    else
        warn "No GPU — worker will use CPU encoding (libx264)"
    fi

    echo "Building and starting containers..."
    $COMPOSE $FILES build
    $COMPOSE $FILES up -d

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
    if [ "$GPU_AVAILABLE" = true ]; then
        echo -e "  GPU Encode:  ${GREEN}NVIDIA NVENC (h264_nvenc)${NC}"
    else
        echo -e "  GPU Encode:  ${YELLOW}CPU fallback (libx264)${NC}"
    fi
    echo ""
    echo "  Useful commands:"
    echo "    ./setup.sh logs backend    # Backend logs"
    echo "    ./setup.sh logs worker     # Worker logs"
    echo "    ./setup.sh down            # Stop all containers"
}

# ── Down ──────────────────────────────────────────────────

down() {
    header "Stopping all containers"
    local COMPOSE=$(compose_cmd)
    local FILES=$(compose_files)
    $COMPOSE $FILES down
    ok "All containers stopped"
}

# ── Logs ──────────────────────────────────────────────────

show_logs() {
    local svc="${1:-}"
    if [ -z "$svc" ]; then
        echo "Usage: ./setup.sh logs [backend|worker|frontend|db]"
        exit 1
    fi
    local COMPOSE=$(compose_cmd)
    local FILES=$(compose_files)
    $COMPOSE $FILES logs -f "$svc"
}

# ── Setup NVIDIA Container Toolkit ───────────────────────

setup_gpu() {
    header "Installing NVIDIA Container Toolkit"

    if ! command -v nvidia-smi &>/dev/null; then
        fail "No NVIDIA GPU driver found. Install the NVIDIA driver first."
        echo "  See: https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/"
        exit 1
    fi

    gpu=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
    ok "NVIDIA GPU detected: $gpu"

    if dpkg -l nvidia-container-toolkit &>/dev/null 2>&1; then
        ok "nvidia-container-toolkit is already installed"
        echo "  Restarting Docker daemon to ensure GPU runtime is active..."
        sudo systemctl restart docker
        ok "Docker restarted"
        return
    fi

    echo "  Adding NVIDIA container toolkit repository..."
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
        sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null

    echo "  Installing nvidia-container-toolkit..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq nvidia-container-toolkit

    echo "  Configuring Docker runtime..."
    sudo nvidia-ctk runtime configure --runtime=docker
    sudo systemctl restart docker

    ok "nvidia-container-toolkit installed and configured"
    echo -e "  ${GREEN}→${NC} Run ${GREEN}./setup.sh deploy${NC} to start with GPU acceleration"
}

# ── Main ──────────────────────────────────────────────────

case "${1:-check}" in
    check)     check_prereqs ;;
    deploy)    check_prereqs && deploy ;;
    down)      down ;;
    logs)      show_logs "$2" ;;
    setup-gpu) setup_gpu ;;
    *)
        echo "MST AI Portal — Docker Setup"
        echo ""
        echo "Usage: ./setup.sh [command]"
        echo ""
        echo "  check      Check prerequisites (default)"
        echo "  deploy     Build and start all containers"
        echo "  down       Stop all containers"
        echo "  logs       Show logs: ./setup.sh logs [backend|worker|frontend|db]"
        echo "  setup-gpu  Install NVIDIA container toolkit for GPU transcoding"
        ;;
esac
