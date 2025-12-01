# 🚀 Deployment Guide

This guide covers deploying the Suwappu Cross-Chain Swap Bot to production.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Deployment Options](#deployment-options)
   - [Option A: VPS/Cloud Server](#option-a-vpscloud-server)
   - [Option B: Docker](#option-b-docker)
   - [Option C: Railway/Render](#option-c-railwayrender)
4. [Database Setup](#database-setup)
5. [Security Checklist](#security-checklist)
6. [Monitoring](#monitoring)

---

## Prerequisites

- Python 3.9+
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- RPC endpoints for each chain
- Server with at least 1GB RAM, 1 vCPU

---

## Environment Setup

### 1. Create Production `.env` File

```bash
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_actual_bot_token
ENCRYPTION_KEY=your_32_byte_hex_key  # Generate: python -c "import secrets; print(secrets.token_hex(32))"

# Admin IDs (comma-separated Telegram user IDs)
ADMIN_IDS=123456789,987654321

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/suwappubot
# Or for SQLite: DATABASE_URL=sqlite:///./suwappubot.db

# RPC Endpoints (use your own or paid providers for production)
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
OPTIMISM_RPC_URL=https://opt-mainnet.g.alchemy.com/v2/YOUR_KEY
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
BSC_RPC_URL=https://bsc-dataseed1.binance.org
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# API Keys (optional but recommended)
LIFI_API_KEY=your_lifi_api_key

# Fee Configuration
FEE_COLLECTOR_ADDRESS=0xYourFeeCollectorAddress

# Logging
LOG_LEVEL=INFO

# Redis (optional, for caching)
REDIS_URL=redis://localhost:6379/0
```

### 2. Generate Encryption Key

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

**⚠️ IMPORTANT**: Store this key securely. Losing it means losing access to all encrypted wallet keys!

---

## Deployment Options

### Option A: VPS/Cloud Server

Best for: Full control, production workloads

**Recommended providers**: DigitalOcean, Linode, Vultr, AWS EC2, Google Cloud

#### Step 1: Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python and dependencies
sudo apt install python3.9 python3.9-venv python3-pip git -y

# Install PostgreSQL (recommended for production)
sudo apt install postgresql postgresql-contrib -y

# Create database
sudo -u postgres createuser suwappubot
sudo -u postgres createdb suwappubot -O suwappubot
sudo -u postgres psql -c "ALTER USER suwappubot WITH PASSWORD 'your_secure_password';"
```

#### Step 2: Clone and Setup

```bash
# Clone repository
git clone https://github.com/yourusername/suwappubot.git
cd suwappubot

# Create virtual environment
python3.9 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install production dependencies
pip install psycopg2-binary gunicorn

# Create .env file
cp .env.example .env
nano .env  # Edit with your values
```

#### Step 3: Create Systemd Service

```bash
sudo nano /etc/systemd/system/suwappubot.service
```

```ini
[Unit]
Description=Suwappu Telegram Bot
After=network.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/suwappubot
Environment=PATH=/home/ubuntu/suwappubot/venv/bin
ExecStart=/home/ubuntu/suwappubot/venv/bin/python -m bot.main
Restart=always
RestartSec=10

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable suwappubot
sudo systemctl start suwappubot

# Check status
sudo systemctl status suwappubot

# View logs
sudo journalctl -u suwappubot -f
```

---

### Option B: Docker

Best for: Easy deployment, containerization

#### Dockerfile

```dockerfile
FROM python:3.9-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir psycopg2-binary

# Copy application code
COPY . .

# Create non-root user
RUN useradd -m botuser && chown -R botuser:botuser /app
USER botuser

CMD ["python", "-m", "bot.main"]
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  bot:
    build: .
    restart: always
    env_file:
      - .env
    depends_on:
      - db
      - redis
    volumes:
      - ./data:/app/data

  db:
    image: postgres:15-alpine
    restart: always
    environment:
      POSTGRES_USER: suwappubot
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: suwappubot
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

#### Deploy with Docker

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f bot

# Restart
docker-compose restart bot

# Stop
docker-compose down
```

---

### Option C: Railway/Render

Best for: Quick deployment, auto-scaling

#### Railway

1. Fork the repository to your GitHub
2. Go to [railway.app](https://railway.app)
3. Create new project → Deploy from GitHub repo
4. Add PostgreSQL service
5. Set environment variables in Railway dashboard
6. Deploy!

**railway.json** (create this file):
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "python -m bot.main",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

#### Render

1. Go to [render.com](https://render.com)
2. Create new Web Service → Connect GitHub repo
3. Settings:
   - Runtime: Python 3
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `python -m bot.main`
4. Add PostgreSQL database
5. Set environment variables
6. Deploy!

**render.yaml**:
```yaml
services:
  - type: worker
    name: suwappubot
    env: python
    buildCommand: pip install -r requirements.txt
    startCommand: python -m bot.main
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: suwappubot-db
          property: connectionString

databases:
  - name: suwappubot-db
    plan: free
```

---

## Database Setup

### PostgreSQL (Recommended for Production)

```bash
# Install
sudo apt install postgresql postgresql-contrib

# Create database
sudo -u postgres psql

CREATE USER suwappubot WITH PASSWORD 'your_secure_password';
CREATE DATABASE suwappubot OWNER suwappubot;
GRANT ALL PRIVILEGES ON DATABASE suwappubot TO suwappubot;
\q

# Update .env
DATABASE_URL=postgresql://suwappubot:your_secure_password@localhost:5432/suwappubot
```

### Database Migrations

The bot auto-creates tables on first run, but for manual migrations:

```bash
# Initialize tables
python -c "
from database.db import init_db
from bot.config.settings import settings
init_db(settings.database_url)
print('Database initialized!')
"
```

### Backup Database

```bash
# PostgreSQL backup
pg_dump -U suwappubot suwappubot > backup_$(date +%Y%m%d).sql

# Restore
psql -U suwappubot suwappubot < backup_20241201.sql
```

---

## Security Checklist

### ✅ Before Going Live

- [ ] **Encryption Key**: Generate new key, store securely (not in repo!)
- [ ] **Bot Token**: Keep secret, regenerate if compromised
- [ ] **RPC URLs**: Use paid providers (Alchemy, Infura, QuickNode)
- [ ] **Database**: Strong password, not exposed to internet
- [ ] **Admin IDs**: Only trusted users
- [ ] **Fee Collector**: Your controlled address
- [ ] **Hot Wallet Keys**: Generated fresh, backed up securely
- [ ] **Firewall**: Only allow necessary ports (22, 443)
- [ ] **SSL**: Use HTTPS for webhooks (if applicable)
- [ ] **Updates**: Keep dependencies updated

### 🔐 Key Management

```bash
# Generate encryption key
python -c "import secrets; print(secrets.token_hex(32))"

# Store in secure location:
# - Password manager
# - AWS Secrets Manager
# - HashiCorp Vault
# - Environment variable (not in code!)
```

### 🛡️ Server Hardening

```bash
# UFW Firewall
sudo ufw allow ssh
sudo ufw allow 443/tcp  # If using webhooks
sudo ufw enable

# Fail2ban
sudo apt install fail2ban
sudo systemctl enable fail2ban

# Automatic security updates
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

---

## Monitoring

### Health Check Endpoint

Add to your server (optional nginx setup):

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location /health {
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
```

### Log Monitoring

```bash
# View bot logs
sudo journalctl -u suwappubot -f

# Or with Docker
docker-compose logs -f bot
```

### Uptime Monitoring

Use services like:
- [UptimeRobot](https://uptimerobot.com) (free)
- [Better Uptime](https://betteruptime.com)
- [Pingdom](https://pingdom.com)

### Alerts

Configure admin alerts in the bot:
1. Set `ADMIN_IDS` in `.env`
2. Use `/status` command to check health
3. Health monitor sends alerts for high error rates

---

## Quick Start Commands

```bash
# Clone
git clone https://github.com/yourusername/suwappubot.git
cd suwappubot

# Setup
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Configure
cp .env.example .env
nano .env  # Add your values

# Run
python -m bot.main

# Production (with systemd)
sudo systemctl start suwappubot
sudo systemctl status suwappubot
```

---

## Troubleshooting

### Bot not responding
```bash
# Check if running
sudo systemctl status suwappubot

# Check logs
sudo journalctl -u suwappubot -n 100

# Restart
sudo systemctl restart suwappubot
```

### Database connection errors
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Test connection
psql -U suwappubot -h localhost -d suwappubot
```

### High memory usage
```bash
# Check memory
free -h

# Restart bot (clears memory)
sudo systemctl restart suwappubot
```

### RPC rate limits
- Use paid RPC providers
- Enable caching (Redis)
- Adjust rate limits in `bot/utils/rate_limiter.py`

---

## Cost Estimates

| Component | Free Tier | Production |
|-----------|-----------|------------|
| VPS (DigitalOcean) | - | $6-12/mo |
| Railway | 500 hours/mo | $5-20/mo |
| Render | 750 hours/mo | $7-25/mo |
| PostgreSQL | Included | Included |
| RPC (Alchemy) | 300M CU/mo | $49+/mo |
| Domain | - | $10-15/yr |

**Minimum Production Cost**: ~$15-30/month

---

## Support

- Issues: [GitHub Issues](https://github.com/yourusername/suwappubot/issues)
- Telegram: [@yoursupportbot](https://t.me/yoursupportbot)

---

**Happy Deploying! 🚀**

