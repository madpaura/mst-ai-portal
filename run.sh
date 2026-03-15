#!/bin/bash

# MST AI Portal Management Script
# Usage: ./run.sh [command]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project paths
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$PROJECT_ROOT/api"
FRONTEND_DIR="$PROJECT_ROOT/react-portal"
DB_DIR="$PROJECT_ROOT/db"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check if PostgreSQL is running
check_postgres() {
    if command_exists docker; then
        docker ps | grep -q "mst-ai-portal_db_1" && return 0 || return 1
    else
        pg_isready -h localhost -p 5432 >/dev/null 2>&1 && return 0 || return 1
    fi
}

# Check if backend is running
check_backend() {
    curl -s http://localhost:8000/health >/dev/null 2>&1 && return 0 || return 1
}

# Check if frontend is running
check_frontend() {
    curl -s http://localhost:5173 >/dev/null 2>&1 && return 0 || return 1
}

# Start PostgreSQL
start_postgres() {
    print_header "Starting PostgreSQL"
    if command_exists docker; then
        if docker ps | grep -q "mst-ai-portal_db_1"; then
            print_status "PostgreSQL is already running"
        else
            print_status "Starting PostgreSQL with Docker Compose..."
            cd "$PROJECT_ROOT"
            docker-compose up -d db
            sleep 3
        fi
    else
        print_warning "Docker not found. Please ensure PostgreSQL is running on localhost:5432"
    fi
    
    if check_postgres; then
        print_status "PostgreSQL is running"
    else
        print_error "Failed to start PostgreSQL"
        exit 1
    fi
}

# Initialize backend
init_backend() {
    print_header "Initializing Backend"
    
    cd "$API_DIR"
    
    # Check if virtual environment exists
    if [ ! -d "venv" ]; then
        print_status "Creating Python virtual environment..."
        python3 -m venv venv
    fi
    
    # Activate virtual environment
    print_status "Activating virtual environment..."
    source venv/bin/activate
    
    # Install dependencies
    print_status "Installing Python dependencies..."
    pip install -r requirements.txt
    
    # Create storage directories
    print_status "Creating storage directories..."
    mkdir -p storage/videos storage/thumbnails
    
    # Initialize database
    print_status "Initializing database..."
    if check_postgres; then
        cd "$PROJECT_ROOT"
        psql -h localhost -U portal -d mst_portal -f "$DB_DIR/init.sql" 2>/dev/null || {
            print_warning "Database might already be initialized or connection failed"
        }
    else
        print_error "PostgreSQL is not running. Please start it first."
        exit 1
    fi
    
    print_status "Backend initialization complete"
}

# Start backend
start_backend() {
    print_header "Starting Backend"
    
    cd "$API_DIR"
    
    if [ ! -d "venv" ]; then
        print_error "Backend not initialized. Run './run.sh init' first."
        exit 1
    fi
    
    source venv/bin/activate
    
    if check_backend; then
        print_status "Backend is already running on port 8000"
        return
    fi
    
    print_status "Starting FastAPI server..."
    nohup uvicorn main:app --host 0.0.0.0 --port 8000 --reload > backend.log 2>&1 &
    BACKEND_PID=$!
    echo $BACKEND_PID > backend.pid
    
    sleep 2
    
    if check_backend; then
        print_status "Backend started successfully (PID: $BACKEND_PID)"
        print_status "API Documentation: http://localhost:8000/docs"
    else
        print_error "Failed to start backend"
        if [ -f backend.log ]; then
            print_error "Check backend.log for details"
        fi
        exit 1
    fi
}

# Start frontend
start_frontend() {
    print_header "Starting Frontend"
    
    cd "$FRONTEND_DIR"
    
    if [ ! -d "node_modules" ]; then
        print_status "Installing frontend dependencies..."
        npm install
    fi
    
    if check_frontend; then
        print_status "Frontend is already running on port 5173"
        return
    fi
    
    print_status "Starting Vite development server..."
    nohup npm run dev > frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > frontend.pid
    
    sleep 3
    
    if check_frontend; then
        print_status "Frontend started successfully (PID: $FRONTEND_PID)"
        print_status "Frontend URL: http://localhost:5173"
    else
        print_error "Failed to start frontend"
        if [ -f frontend.log ]; then
            print_error "Check frontend.log for details"
        fi
        exit 1
    fi
}

# Start transcoder worker
start_worker() {
    print_header "Starting Transcoder Worker"
    
    cd "$API_DIR"
    
    if [ ! -d "venv" ]; then
        print_error "Backend not initialized. Run './run.sh init' first."
        exit 1
    fi
    
    source venv/bin/activate
    
    # Check if worker is already running
    if pgrep -f "worker/transcoder.py" > /dev/null; then
        print_status "Transcoder worker is already running"
        return
    fi
    
    print_status "Starting transcoder worker..."
    nohup python worker/transcoder.py > worker.log 2>&1 &
    WORKER_PID=$!
    echo $WORKER_PID > worker.pid
    
    sleep 1
    
    if pgrep -f "worker/transcoder.py" > /dev/null; then
        print_status "Transcoder worker started successfully (PID: $WORKER_PID)"
    else
        print_error "Failed to start transcoder worker"
        if [ -f worker.log ]; then
            print_error "Check worker.log for details"
        fi
        exit 1
    fi
}

# Start all services
start_all() {
    print_header "Starting All Services"
    
    start_postgres
    start_backend
    start_frontend
    start_worker
    
    print_header "Services Status"
    print_status "PostgreSQL: $(check_postgres && echo 'Running' || echo 'Stopped')"
    print_status "Backend: $(check_backend && echo 'Running (http://localhost:8000)' || echo 'Stopped')"
    print_status "Frontend: $(check_frontend && echo 'Running (http://localhost:5173)' || echo 'Stopped')"
    print_status "Worker: $(pgrep -f 'worker/transcoder.py' > /dev/null && echo 'Running' || echo 'Stopped')"
    
    print_header "Access Information"
    echo "Frontend: http://localhost:5173"
    echo "Backend API: http://localhost:8000"
    echo "API Docs: http://localhost:8000/docs"
    echo "Admin Panel: http://localhost:5173/admin/videos"
    echo "Default Login: admin/admin"
}

# Stop services
stop_services() {
    print_header "Stopping Services"
    
    # Stop frontend
    if [ -f "$FRONTEND_DIR/frontend.pid" ]; then
        FRONTEND_PID=$(cat "$FRONTEND_DIR/frontend.pid")
        if ps -p $FRONTEND_PID > /dev/null; then
            print_status "Stopping frontend (PID: $FRONTEND_PID)..."
            kill $FRONTEND_PID
            rm "$FRONTEND_DIR/frontend.pid"
        fi
    fi
    
    # Kill any remaining frontend processes
    pkill -f "vite.*5173" 2>/dev/null || true
    
    # Stop backend
    if [ -f "$API_DIR/backend.pid" ]; then
        BACKEND_PID=$(cat "$API_DIR/backend.pid")
        if ps -p $BACKEND_PID > /dev/null; then
            print_status "Stopping backend (PID: $BACKEND_PID)..."
            kill $BACKEND_PID
            rm "$API_DIR/backend.pid"
        fi
    fi
    
    # Kill any remaining backend processes
    pkill -f "uvicorn.*8000" 2>/dev/null || true
    
    # Stop worker
    if [ -f "$API_DIR/worker.pid" ]; then
        WORKER_PID=$(cat "$API_DIR/worker.pid")
        if ps -p $WORKER_PID > /dev/null; then
            print_status "Stopping worker (PID: $WORKER_PID)..."
            kill $WORKER_PID
            rm "$API_DIR/worker.pid"
        fi
    fi
    
    # Kill any remaining worker processes
    pkill -f "worker/transcoder.py" 2>/dev/null || true
    
    print_status "All services stopped"
}

# Restart services
restart_services() {
    print_header "Restarting Services"
    stop_services
    sleep 2
    start_all
}

# Docker Compose
docker_compose() {
    print_header "Using Docker Compose"
    cd "$PROJECT_ROOT"
    docker-compose "$@"
}

# Show status
show_status() {
    print_header "Service Status"
    
    echo -e "PostgreSQL: $(check_postgres && echo "${GREEN}Running${NC}" || echo "${RED}Stopped${NC}")"
    echo -e "Backend: $(check_backend && echo "${GREEN}Running (http://localhost:8000)${NC}" || echo "${RED}Stopped${NC}")"
    echo -e "Frontend: $(check_frontend && echo "${GREEN}Running (http://localhost:5173)${NC}" || echo "${RED}Stopped${NC}")"
    echo -e "Worker: $(pgrep -f 'worker/transcoder.py' > /dev/null && echo "${GREEN}Running${NC}" || echo "${RED}Stopped${NC}")"
    
    echo ""
    print_header "Process Details"
    
    if pgrep -f "uvicorn.*8000" > /dev/null; then
        echo "Backend Processes:"
        ps aux | grep "uvicorn.*8000" | grep -v grep
    fi
    
    if pgrep -f "vite.*5173" > /dev/null; then
        echo "Frontend Processes:"
        ps aux | grep "vite.*5173" | grep -v grep
    fi
    
    if pgrep -f "worker/transcoder.py" > /dev/null; then
        echo "Worker Processes:"
        ps aux | grep "worker/transcoder.py" | grep -v grep
    fi
}

# Show logs
show_logs() {
    local service=$1
    case $service in
        backend)
            if [ -f "$API_DIR/backend.log" ]; then
                tail -f "$API_DIR/backend.log"
            else
                print_error "Backend log file not found"
            fi
            ;;
        frontend)
            if [ -f "$FRONTEND_DIR/frontend.log" ]; then
                tail -f "$FRONTEND_DIR/frontend.log"
            else
                print_error "Frontend log file not found"
            fi
            ;;
        worker)
            if [ -f "$API_DIR/worker.log" ]; then
                tail -f "$API_DIR/worker.log"
            else
                print_error "Worker log file not found"
            fi
            ;;
        *)
            print_error "Usage: ./run.sh logs [backend|frontend|worker]"
            exit 1
            ;;
    esac
}

# Show help
show_help() {
    echo "MST AI Portal Management Script"
    echo ""
    echo "Usage: ./run.sh [command]"
    echo ""
    echo "Commands:"
    echo "  start           Start all services (PostgreSQL, backend, frontend, worker)"
    echo "  stop            Stop all running services"
    echo "  restart         Restart all services"
    echo "  init            Initialize backend environment and database"
    echo "  ui              Start frontend only"
    echo "  backend         Start backend only"
    echo "  transcode-worker Start transcoder worker only"
    echo "  docker-compose  Run docker-compose commands"
    echo "  status          Show status of all services"
    echo "  logs [service]  Show logs for service (backend|frontend|worker)"
    echo "  help            Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./run.sh init                    # Initialize everything"
    echo "  ./run.sh start                   # Start all services"
    echo "  ./run.sh ui                      # Start frontend only"
    echo "  ./run.sh logs backend            # Follow backend logs"
    echo "  ./run.sh docker-compose ps       # Run docker-compose ps"
}

# Main script logic
case "${1:-help}" in
    start)
        start_all
        ;;
    stop)
        stop_services
        ;;
    restart)
        restart_services
        ;;
    init)
        init_backend
        ;;
    ui)
        start_frontend
        ;;
    backend)
        start_backend
        ;;
    transcode-worker)
        start_worker
        ;;
    docker-compose)
        shift
        docker_compose "$@"
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$2"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
