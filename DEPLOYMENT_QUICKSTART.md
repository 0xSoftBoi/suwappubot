# 🚀 Quick Deployment Guide

## Prerequisites

1. **Telegram Bot Token** - Get from [@BotFather](https://t.me/BotFather)
2. **Encryption Key** - Generate with: `python3 -c "import secrets; print(secrets.token_hex(32))"`
3. **RPC Endpoints** - Use Alchemy, Infura, or QuickNode for production

## Quick Start (3 Steps)

### Step 1: Configure Environment

```bash
# Copy example env file
cp env.example .env

# Edit .env file with your values
nano .env  # or use your favorite editor
```

**Required variables:**
- `TELEGRAM_BOT_TOKEN` - Your bot token
- `ENCRYPTION_KEY` - 64-character hex string (generate with deploy script)
- `DATABASE_URL` - PostgreSQL or SQLite URL
- RPC URLs for each chain

### Step 2: Choose Deployment Method

#### Option A: Docker (Recommended for Easy Deployment)

```bash
# Make deploy script executable
chmod +x deploy.sh

# Check prerequisites
./deploy.sh check

# Deploy
./deploy.sh docker

# View logs
docker-compose logs -f bot
```

#### Option B: systemd (Linux VPS)

```bash
# Setup virtual environment
./deploy.sh venv

# Deploy (requires sudo)
sudo ./deploy.sh systemd

# View logs
sudo journalctl -u suwappubot -f
```

### Step 3: Verify Deployment

```bash
# For Docker
docker-compose ps

# For systemd
sudo systemctl status suwappubot
```

## Generate Encryption Key

```bash
./deploy.sh keygen
```

Copy the output to your `.env` file.

## Common Commands

### Docker
```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# Restart
docker-compose restart bot

# View logs
docker-compose logs -f bot

# Update
git pull
docker-compose build
docker-compose up -d
```

### systemd
```bash
# Start
sudo systemctl start suwappubot

# Stop
sudo systemctl stop suwappubot

# Restart
sudo systemctl restart suwappubot

# Status
sudo systemctl status suwappubot

# Logs
sudo journalctl -u suwappubot -f

# Update
git pull
sudo systemctl restart suwappubot
```

## Troubleshooting

### Bot not responding
1. Check logs: `docker-compose logs bot` or `sudo journalctl -u suwappubot`
2. Verify `.env` file has correct values
3. Check database connection
4. Verify RPC endpoints are accessible

### Database errors
- **SQLite**: Ensure `data/` directory exists and is writable
- **PostgreSQL**: Verify connection string and database exists

### RPC rate limits
- Use paid RPC providers (Alchemy, Infura, QuickNode)
- Enable Redis caching in `.env`

## Security Checklist

- [ ] Encryption key is 64 characters and secure
- [ ] `.env` file is not committed to git
- [ ] Database password is strong
- [ ] RPC endpoints use API keys
- [ ] Firewall configured (only necessary ports open)
- [ ] Regular backups configured

## Next Steps

1. Test the bot in Telegram
2. Configure admin IDs in `.env`
3. Set up monitoring (see DEPLOYMENT.md)
4. Configure backups
5. Set up hot wallets for deposits (use admin commands)

For detailed deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md)

