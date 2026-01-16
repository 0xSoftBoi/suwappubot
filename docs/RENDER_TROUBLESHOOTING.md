# Render Deployment Troubleshooting Guide

## Common Issues and Solutions

### 1. Port Configuration Mismatch

**Problem**: Render dynamically sets the `PORT` environment variable, but the Dockerfile/scripts might not handle it correctly.

**Solution**: The `start_all.sh` script uses `${PORT:-8000}` which should work, but Render typically uses port 10000. Ensure the script respects Render's PORT.

**Check**: Look for errors like "Address already in use" or "Connection refused" in logs.

### 2. Health Check Failures

**Problem**: Health check fails because:
- Port mismatch
- curl not found in PATH
- Service not ready when health check runs

**Solution**: 
- Ensure `/health` endpoint is accessible
- Health check should use the same PORT variable
- Increase `start-period` in Dockerfile HEALTHCHECK

### 3. C++ Extension Build Failures

**Problem**: The C++ extension (`suwappu_core`) requires cmake, g++, and pybind11. Build might fail if:
- System dependencies missing
- Memory limits exceeded (free tier)
- Build timeout

**Solution**:
- Dockerfile already includes build dependencies
- Consider making C++ extension optional for initial deployment
- Upgrade to Starter plan ($7/mo) for more memory

### 4. Missing Environment Variables

**Problem**: Required environment variables not set in Render dashboard.

**Required Variables**:
- `TELEGRAM_BOT_TOKEN` (required)
- `ENCRYPTION_KEY` (required - 64 char hex)
- `DATABASE_URL` (auto-set from database)
- `ADMIN_IDS` (optional but recommended)
- `LOG_LEVEL` (optional, defaults to INFO)

**Solution**: Check Render dashboard → Environment tab → Ensure all required vars are set.

### 5. Database Connection Issues

**Problem**: Cannot connect to PostgreSQL.

**Common Causes**:
- Using External URL instead of Internal URL
- Database not in same region
- Database not created yet
- Wrong connection string format

**Solution**:
- Use Internal Database URL (from Render dashboard)
- Ensure database is created before service
- Format: `postgresql://user:pass@host:port/dbname`

### 6. Build Timeout

**Problem**: Docker build exceeds timeout (usually 20 minutes on free tier).

**Solution**:
- Optimize Dockerfile layers
- Cache pip dependencies
- Consider splitting build into stages
- Upgrade plan for faster builds

### 7. Service Crashes on Start

**Problem**: Service starts then immediately crashes.

**Check Logs For**:
- Import errors
- Missing modules
- Permission errors
- Configuration errors

**Solution**:
```bash
# View logs in Render dashboard
# Or check specific errors:
render logs suwappu --tail 100
```

### 8. Bot Not Responding

**Problem**: Bot deployed but not responding to messages.

**Check**:
- Telegram bot token is valid
- Bot is not rate-limited
- Bot process is running (check logs)
- Network connectivity

**Solution**:
- Verify token with @BotFather
- Check bot logs for errors
- Ensure bot process started successfully

## Diagnostic Commands

### Check Service Status
```bash
render services list
render services get suwappu
```

### View Logs
```bash
# Recent logs
render logs suwappu --tail 50

# Follow logs
render logs suwappu --follow

# Filter errors
render logs suwappu | grep -i error
```

### Check Environment Variables
```bash
render env list suwappu
```

### Restart Service
```bash
render services restart suwappu
```

## Quick Fixes

### Fix 1: Update start script to handle Render PORT correctly
See updated `scripts/start_all.sh`

### Fix 2: Make C++ extension optional
The bot should work without C++ extension (uses Python fallback).

### Fix 3: Add better error handling
Update startup scripts to log errors clearly.

### Fix 4: Fix health check
Ensure health check uses correct port and curl is available.

## Testing Locally

Before deploying to Render, test the Docker build locally:

```bash
# Build locally
docker build -t suwappu-test .

# Run locally
docker run -p 8000:8000 \
  -e PORT=8000 \
  -e TELEGRAM_BOT_TOKEN=your_token \
  -e ENCRYPTION_KEY=your_key \
  -e DATABASE_URL=postgresql://... \
  suwappu-test

# Test health endpoint
curl http://localhost:8000/health
```

## Getting Help

1. Check Render logs first
2. Review this troubleshooting guide
3. Check GitHub issues
4. Render support: support@render.com
