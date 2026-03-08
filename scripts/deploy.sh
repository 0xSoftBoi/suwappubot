#!/bin/bash

# ===========================================
# Suwappu Bot Deployment Script
# ===========================================
# This script helps deploy the bot to production
# Usage: ./deploy.sh [docker|systemd|check]

set -e

DEPLOYMENT_TYPE="${1:-check}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${GREEN}===========================================${NC}"
    echo -e "${GREEN}$1${NC}"
    echo -e "${GREEN}===========================================${NC}\n"
}

print_error() {
    echo -e "${RED}❌ Error: $1${NC}" >&2
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

check_prerequisites() {
    print_header "Checking Prerequisites"
    
    local errors=0
    
    # Check Python
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 is not installed"
        errors=$((errors + 1))
    else
        PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
        print_success "Python $PYTHON_VERSION found"
    fi
    
    # Check .env file
    if [ ! -f ".env" ]; then
        print_error ".env file not found. Copy env.example to .env and configure it."
        errors=$((errors + 1))
    else
        print_success ".env file found"
        
        # Check required variables
        source .env 2>/dev/null || true
        
        if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ "$TELEGRAM_BOT_TOKEN" = "your_bot_token_here" ]; then
            print_error "TELEGRAM_BOT_TOKEN not set in .env"
            errors=$((errors + 1))
        else
            print_success "TELEGRAM_BOT_TOKEN is set"
        fi
        
        if [ -z "$ENCRYPTION_KEY" ] || [ "$ENCRYPTION_KEY" = "your_64_character_hex_key_here" ]; then
            print_error "ENCRYPTION_KEY not set in .env"
            errors=$((errors + 1))
        else
            if [ ${#ENCRYPTION_KEY} -ne 64 ]; then
                print_error "ENCRYPTION_KEY must be 64 characters (32 bytes hex)"
                errors=$((errors + 1))
            else
                print_success "ENCRYPTION_KEY is set and valid length"
            fi
        fi
    fi
    
    # Check Docker (if deploying with Docker)
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        if ! command -v docker &> /dev/null; then
            print_error "Docker is not installed"
            errors=$((errors + 1))
        else
            print_success "Docker found"
        fi
        
        if ! command -v docker-compose &> /dev/null; then
            print_error "Docker Compose is not installed"
            errors=$((errors + 1))
        else
            print_success "Docker Compose found"
        fi
    fi
    
    # Check systemd (if deploying with systemd)
    if [ "$DEPLOYMENT_TYPE" = "systemd" ]; then
        if ! command -v systemctl &> /dev/null; then
            print_error "systemd is not available (not running on Linux?)"
            errors=$((errors + 1))
        else
            print_success "systemd found"
        fi
    fi
    
    if [ $errors -gt 0 ]; then
        print_error "Found $errors issue(s). Please fix them before deploying."
        exit 1
    fi
    
    print_success "All prerequisites met!"
}

generate_encryption_key() {
    print_header "Generating Encryption Key"
    
    if command -v python3 &> /dev/null; then
        KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
        echo ""
        echo -e "${YELLOW}Generated Encryption Key:${NC}"
        echo -e "${GREEN}$KEY${NC}"
        echo ""
        echo -e "${YELLOW}Add this to your .env file:${NC}"
        echo -e "ENCRYPTION_KEY=$KEY"
        echo ""
    else
        print_error "Python 3 not found. Cannot generate key."
        exit 1
    fi
}

deploy_docker() {
    print_header "Deploying with Docker"
    
    check_prerequisites
    
    # Create data directory if it doesn't exist
    mkdir -p data
    
    print_warning "Building Docker images..."
    docker-compose build
    
    print_warning "Starting services..."
    docker-compose up -d
    
    print_warning "Waiting for services to be healthy..."
    sleep 5
    
    # Check if services are running
    if docker-compose ps | grep -q "Up"; then
        print_success "Bot is running!"
        echo ""
        echo "View logs with: docker-compose logs -f bot"
        echo "Stop bot with: docker-compose down"
        echo "Restart bot with: docker-compose restart bot"
    else
        print_error "Some services failed to start. Check logs: docker-compose logs"
        exit 1
    fi
}

deploy_systemd() {
    print_header "Deploying with systemd"
    
    check_prerequisites
    
    # Check if running as root
    if [ "$EUID" -ne 0 ]; then
        print_error "Please run as root (use sudo) for systemd deployment"
        exit 1
    fi
    
    # Get current user (the one who ran sudo)
    REAL_USER=${SUDO_USER:-$USER}
    REAL_HOME=$(eval echo ~$REAL_USER)
    BOT_DIR="$SCRIPT_DIR"
    
    print_warning "Creating systemd service file..."
    
    # Create service file
    cat > /etc/systemd/system/suwappubot.service <<EOF
[Unit]
Description=Suwappu Telegram Bot
After=network.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=$REAL_USER
Group=$REAL_USER
WorkingDirectory=$BOT_DIR
Environment=PATH=$BOT_DIR/venv/bin
EnvironmentFile=$BOT_DIR/.env
ExecStart=$BOT_DIR/venv/bin/python -m bot.main
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$BOT_DIR/data

[Install]
WantedBy=multi-user.target
EOF
    
    print_success "Service file created at /etc/systemd/system/suwappubot.service"
    
    # Reload systemd
    systemctl daemon-reload
    
    # Enable service
    systemctl enable suwappubot
    
    print_warning "Starting service..."
    systemctl start suwappubot
    
    sleep 2
    
    # Check status
    if systemctl is-active --quiet suwappubot; then
        print_success "Bot is running!"
        echo ""
        echo "View status: sudo systemctl status suwappubot"
        echo "View logs: sudo journalctl -u suwappubot -f"
        echo "Restart: sudo systemctl restart suwappubot"
        echo "Stop: sudo systemctl stop suwappubot"
    else
        print_error "Service failed to start. Check logs: sudo journalctl -u suwappubot -n 50"
        exit 1
    fi
}

setup_venv() {
    print_header "Setting up Python Virtual Environment"
    
    if [ ! -d "venv" ]; then
        print_warning "Creating virtual environment..."
        python3 -m venv venv
    fi
    
    print_warning "Activating virtual environment and installing dependencies..."
    source venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt
    
    print_success "Virtual environment ready!"
}

run_tests() {
    print_header "Running Tests"
    
    if [ ! -d "venv" ]; then
        setup_venv
    fi
    
    source venv/bin/activate
    
    if [ -f "pytest.ini" ]; then
        pytest tests/ -v
    else
        print_warning "No pytest.ini found, running basic tests..."
        python -m pytest tests/ -v || true
    fi
}

# Main script logic
case "$DEPLOYMENT_TYPE" in
    docker)
        deploy_docker
        ;;
    systemd)
        deploy_systemd
        ;;
    check)
        check_prerequisites
        echo ""
        print_header "Deployment Options"
        echo "1. Docker: ./deploy.sh docker"
        echo "2. systemd: sudo ./deploy.sh systemd"
        echo "3. Generate encryption key: ./deploy.sh keygen"
        echo "4. Run tests: ./deploy.sh test"
        echo "5. Setup venv: ./deploy.sh venv"
        ;;
    keygen)
        generate_encryption_key
        ;;
    test)
        run_tests
        ;;
    venv)
        setup_venv
        ;;
    *)
        print_error "Unknown deployment type: $DEPLOYMENT_TYPE"
        echo "Usage: ./deploy.sh [docker|systemd|check|keygen|test|venv]"
        exit 1
        ;;
esac

print_success "Done!"

