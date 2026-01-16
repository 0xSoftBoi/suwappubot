# Render Deployment Checklist

Use this checklist to ensure your Render deployment succeeds.

## Pre-Deployment

- [ ] **GitHub Repository**: Code is pushed to GitHub
- [ ] **render.yaml**: Configuration file is committed
- [ ] **Dockerfile**: Dockerfile is present and valid
- [ ] **Requirements**: All dependencies in `requirements.txt`

## Required Environment Variables

Set these in Render Dashboard → Environment tab:

### Critical (Must Have)
- [ ] `TELEGRAM_BOT_TOKEN` - Get from @BotFather
- [ ] `ENCRYPTION_KEY` - Generate: `python -c "import secrets; print(secrets.token_hex(32))"`
- [ ] `DATABASE_URL` - Auto-set from database (verify it's Internal URL)

### Recommended
- [ ] `ADMIN_IDS` - Your Telegram user ID (comma-separated)
- [ ] `LOG_LEVEL` - Set to `INFO` or `DEBUG`
- [ ] `ADMIN_API_KEY` - For dashboard access (generate random string)

### Optional
- [ ] `LIFI_API_KEY` - For higher rate limits
- [ ] `WHATSAPP_ACCESS_TOKEN` - If using WhatsApp
- [ ] `WHATSAPP_PHONE_NUMBER_ID` - If using WhatsApp
- [ ] `TURNKEY_*` - Only if using Turnkey wallet provider

## Database Setup

- [ ] Database created in Render dashboard
- [ ] Database name matches `render.yaml` (`suwappu-db`)
- [ ] Using **Internal Database URL** (not External)
- [ ] Database in same region as service

## Deployment Steps

1. [ ] Go to [dashboard.render.com](https://dashboard.render.com)
2. [ ] Click **New +** → **Blueprint**
3. [ ] Connect your GitHub repository
4. [ ] Review configuration from `render.yaml`
5. [ ] Set all required environment variables
6. [ ] Click **Apply** to deploy

## Post-Deployment Verification

- [ ] Service status is "Live" (green)
- [ ] Health check passes: `curl https://your-service.onrender.com/health`
- [ ] Logs show no errors
- [ ] Bot responds to Telegram messages
- [ ] API endpoints work: `/health`, `/tools`

## Common Issues to Check

### Build Failures
- [ ] Check build logs for errors
- [ ] Verify all dependencies install correctly
- [ ] Check for C++ extension build issues (can be skipped)

### Runtime Failures
- [ ] Check service logs for errors
- [ ] Verify environment variables are set
- [ ] Check database connection
- [ ] Verify Telegram bot token is valid

### Health Check Failures
- [ ] Service is listening on correct port
- [ ] `/health` endpoint returns 200 OK
- [ ] Health check timeout is sufficient

## Quick Test Commands

```bash
# Check service status
curl https://your-service.onrender.com/health

# Should return: {"status":"healthy","service":"suwappu-api"}

# Test API endpoint
curl https://your-service.onrender.com/tools

# View logs (if using Render CLI)
render logs suwappu --tail 50
```

## Troubleshooting

If deployment fails:

1. **Check Build Logs**: Look for compilation errors, missing dependencies
2. **Check Runtime Logs**: Look for import errors, configuration errors
3. **Verify Environment Variables**: Ensure all required vars are set
4. **Test Locally**: Build and run Docker image locally first
5. **Review Documentation**: See `RENDER_TROUBLESHOOTING.md`

## Support Resources

- Render Docs: https://render.com/docs
- Render Status: https://status.render.com
- Render Support: support@render.com
- Project Docs: `docs/RENDER_TROUBLESHOOTING.md`
