# Render Deployment Diagnostic Guide

## Quick Diagnostic

Run the diagnostic script:
```bash
./scripts/check_render_deployment.sh
```

## Common Failure Causes

### 1. Missing Environment Variables ⚠️ MOST COMMON

**Symptoms**: Service starts but crashes immediately, or fails during initialization

**Required Variables** (check in Render Dashboard → Environment):
- ✅ `TELEGRAM_BOT_TOKEN` - Must be set
- ✅ `ENCRYPTION_KEY` - Must be set (64-character hex string)
- ✅ `DATABASE_URL` - Should be auto-set from database

**How to Check**:
1. Go to Render Dashboard → Your Service → Environment tab
2. Verify all required variables are present
3. Ensure values are correct (no typos, no extra spaces)

**Fix**: Add missing variables in Render Dashboard

---

### 2. Build Timeout (C++ Extension)

**Symptoms**: Build fails after ~10-15 minutes, or "Build timeout" error

**Cause**: The C++ extension (`suwappu_core`) takes time to compile. Free tier has build time limits.

**Solutions**:
- **Option A**: Make C++ extension optional (bot works without it)
- **Option B**: Upgrade to Starter plan ($7/mo) for longer build times
- **Option C**: Pre-build the extension and include in repo (not recommended)

**Check**: Look for cmake/pybind11 errors in build logs

---

### 3. Runtime Import Errors

**Symptoms**: Service starts but crashes with "ModuleNotFoundError" or "ImportError"

**Common Missing Modules**:
- `psycopg2-binary` (for PostgreSQL)
- `gunicorn` (for production server)
- Any module in `requirements.txt`

**Fix**: Ensure `requirements.txt` includes all dependencies and Dockerfile installs them

**Check**: Look for import errors in runtime logs

---

### 4. Port Binding Issues

**Symptoms**: Health check fails, service shows as "unhealthy"

**Cause**: Service not listening on the correct port

**Check**:
- Render sets `PORT` environment variable dynamically
- `start_all.sh` should use `${PORT:-10000}`
- API should listen on `0.0.0.0:$PORT`

**Fix**: Ensure `scripts/start_all.sh` uses `$PORT` variable correctly

---

### 5. Health Check Failures

**Symptoms**: Service builds successfully but health check fails

**Causes**:
- Health endpoint not responding
- Wrong port in health check
- Service takes too long to start

**Check**:
- Verify `/health` endpoint exists in `api/main.py`
- Health check timeout is sufficient (40s start-period)
- Service actually starts before health check runs

**Fix**: Increase `start-period` in Dockerfile HEALTHCHECK or fix health endpoint

---

### 6. Database Connection Errors

**Symptoms**: Service crashes with database connection errors

**Causes**:
- Using External Database URL instead of Internal
- Database not created yet
- Wrong connection string format
- Database in different region

**Fix**:
- Use **Internal Database URL** from Render dashboard
- Ensure database is created before service
- Verify database is in same region

---

### 7. Missing Script Permissions

**Symptoms**: "Permission denied" errors when starting

**Fix**: Ensure scripts are executable:
```bash
chmod +x scripts/*.sh
```

Dockerfile should include: `RUN chmod +x scripts/*.sh`

---

## Step-by-Step Debugging

### Step 1: Check Render Dashboard
1. Go to: https://dashboard.render.com/web/srv-d4qf44ili9vc739sl420
2. Click **Events** tab
3. Find the latest failed deployment
4. Click on it to see build logs
5. Look for error messages (search for "error", "failed", "exception")

### Step 2: Check Runtime Logs
1. Go to **Logs** tab
2. Filter by "Error" level
3. Look for:
   - Import errors
   - Missing environment variables
   - Database connection errors
   - Port binding errors

### Step 3: Verify Configuration
1. **Environment Variables**: Check all required vars are set
2. **Build Command**: Should be handled by Dockerfile
3. **Start Command**: Should be `bash scripts/start_all.sh` (in Dockerfile CMD)
4. **Health Check**: Should be `/health` (set in render.yaml)

### Step 4: Test Locally
Build and test Docker image locally:
```bash
# Build
docker build -t suwappu-test .

# Run with test environment
docker run -p 8000:8000 \
  -e PORT=8000 \
  -e TELEGRAM_BOT_TOKEN=test_token \
  -e ENCRYPTION_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))") \
  -e DATABASE_URL=sqlite:///test.db \
  suwappu-test

# Test health endpoint
curl http://localhost:8000/health
```

If this works locally but fails on Render, it's likely an environment variable issue.

---

## Getting Detailed Logs

### Via Render Dashboard (Easiest)
1. Go to service dashboard
2. Click **Logs** tab
3. Use filters: Error level, specific time range
4. Copy error messages

### Via Render CLI
```bash
# Install CLI
npm install -g render-cli

# Login
render login

# View logs
render logs suwappu --tail 100

# Filter errors
render logs suwappu | grep -i error
```

### Via API (Limited)
The Render API has limited log access. Best to use dashboard or CLI.

---

## Quick Fixes Checklist

Before asking for help, verify:

- [ ] `render.yaml` syntax is valid (no YAML errors)
- [ ] All required environment variables are set in Render dashboard
- [ ] Dockerfile builds successfully locally
- [ ] Start script is executable
- [ ] Health endpoint `/health` exists and works
- [ ] Database URL uses Internal URL (not External)
- [ ] Service is not suspended
- [ ] No obvious errors in build logs
- [ ] No obvious errors in runtime logs

---

## Still Failing?

If you've checked everything above and it's still failing:

1. **Share the error message** from Render logs
2. **Share the build logs** (last 50 lines)
3. **Share the runtime logs** (last 50 lines)
4. **Verify environment variables** are set (without sharing values)

Common next steps:
- Check for specific error patterns in logs
- Test Docker build locally
- Verify all dependencies are in requirements.txt
- Check for memory/resource limits

---

## Useful Links

- Render Dashboard: https://dashboard.render.com/web/srv-d4qf44ili9vc739sl420
- Render Docs: https://render.com/docs
- Render Status: https://status.render.com
- Render Support: support@render.com
