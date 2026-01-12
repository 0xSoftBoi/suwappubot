# 🚀 Suwappu Bot Server Deployment Guide

Follow these steps to deploy your bot to a fresh Linux server (Ubuntu/Debian).

## 1. Prepare Local Files
Make sure your `.env.prod` is ready and contains your **production** credentials (real DB URL, private keys, etc.).

## 2. Copy Files to Server
Replace `user` and `your-server-ip` with your actual server details.

```bash
# Copy project folder (excluding venv, .git, etc via rsync)
rsync -av --exclude 'venv' --exclude '.git' --exclude '__pycache__' \
  ./ user@your-server-ip:~/suwappubot/
```

## 3. SSH into Server & Deploy

```bash
# Login
ssh user@your-server-ip

# Go to folder
cd suwappubot

# Setup Production Env
cp .env.prod .env
nano .env  # Double check your values!

# Run Deployment Script
chmod +x deploy_server.sh
./deploy_server.sh
```

## 4. Post-Deployment

- **View Logs**: `docker compose -f docker-compose.prod.yml logs -f`
- **Restart**: `docker compose -f docker-compose.prod.yml restart`
- **Stop**: `docker compose -f docker-compose.prod.yml down`

---

### Troubleshooting

**"Permission denied" for Docker?**
If the script installs Docker for the first time, you might need to log out and log back in:
```bash
exit
ssh user@your-server-ip
```
Then run `./deploy_server.sh` again.
