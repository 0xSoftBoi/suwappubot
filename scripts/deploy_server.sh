#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Initiating Suwappu Bot Server Deployment...${NC}"

# 1. Check for .env file
if [ ! -f .env ]; then
    echo -e "${RED}❌ Error: .env file not found!${NC}"
    echo "Please copy your .env.prod file to .env before running this script."
    exit 1
fi

# 2. Update System
echo -e "${YELLOW}🔄 Updating system packages...${NC}"
sudo apt-get update && sudo apt-get upgrade -y

# 3. Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}🐳 Docker not found. Installing Docker...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    sudo usermod -aG docker $USER
    echo -e "${GREEN}✅ Docker installed successfully.${NC}"
    echo "⚠️  You may need to log out and log back in for group changes to take effect."
else
    echo -e "${GREEN}✅ Docker is already installed.${NC}"
fi

# 4. Install Docker Compose if not present
if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}🐳 Installing Docker Compose...${NC}"
    sudo apt-get install -y docker-compose-plugin
    echo -e "${GREEN}✅ Docker Compose installed.${NC}"
fi

# 5. Stop existing containers
echo -e "${YELLOW}🛑 Stopping any existing bot containers...${NC}"
docker compose -f docker-compose.prod.yml down || true

# 6. Build and Start
echo -e "${YELLOW}🏗️  Building and starting services...${NC}"
docker compose -f docker-compose.prod.yml up -d --build

# 7. Verification
echo -e "${YELLOW}🔍 Verifying deployment...${NC}"
sleep 5
if docker compose -f docker-compose.prod.yml ps | grep "Up"; then
    echo -e "${GREEN}✅ Deployment successful! Services are running.${NC}"
    echo -e "📊 API: http://$(curl -s ifconfig.me):8000"
    echo -e "📈 Dashboard: http://$(curl -s ifconfig.me):3000"
    echo -e "📜 Logs: docker compose -f docker-compose.prod.yml logs -f"
else
    echo -e "${RED}❌ Deployment failed. Check logs with: docker compose logs${NC}"
fi
