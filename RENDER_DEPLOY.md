# Deploy to Render

## Quick Deploy (One-Click)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/0xSoftBoi/suwappubot)

## Manual Setup

### 1. Create Render Account
Go to [render.com](https://render.com) and sign up with GitHub.

### 2. Create New Web Service
1. Click **New** → **Web Service**
2. Connect your GitHub repo: `0xSoftBoi/suwappubot`
3. Configure:
   - **Name**: `suwappubot`
   - **Region**: Oregon (or closest to you)
   - **Branch**: `main`
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python -m bot.main`
   - **Plan**: Starter ($7/mo) or Free (with limitations)

### 3. Add PostgreSQL Database
1. Click **New** → **PostgreSQL**
2. Configure:
   - **Name**: `suwappubot-db`
   - **Plan**: Free (1GB, 90-day retention)
3. Copy the **Internal Database URL**

### 4. Set Environment Variables
In your web service, go to **Environment** and add:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | (paste Internal Database URL) |
| `TELEGRAM_BOT_TOKEN` | Your bot token |
| `ENCRYPTION_KEY` | Generate: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `LOG_LEVEL` | `INFO` |
| `ADMIN_IDS` | Your Telegram user ID |

### 5. Deploy
Click **Create Web Service** and wait for deployment.

---

## Using Render MCP (AI-Assisted Deployment)

### Setup MCP in Cursor

Add this to your Cursor MCP settings (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "render": {
      "url": "https://mcp.render.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR_RENDER_API_KEY"
      }
    }
  }
}
```

### Get Render API Key
1. Go to [render.com/docs/api](https://render.com/docs/api)
2. Click **Create API Key**
3. Copy and paste into the config above

### MCP Commands
Once configured, you can ask the AI to:
- "Deploy suwappubot to Render"
- "Check deployment status"
- "View logs for suwappubot"
- "Scale up the service"

---

## Blueprint Deployment (render.yaml)

The `render.yaml` file defines your infrastructure as code:

```yaml
services:
  - type: worker
    name: suwappubot
    runtime: python
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

To deploy:
1. Push `render.yaml` to your repo
2. Go to Render Dashboard
3. Click **Blueprints** → **New Blueprint Instance**
4. Select your repo
5. Configure secrets and deploy

---

## Troubleshooting

### Bot not starting
```bash
# Check logs in Render dashboard
# Or use Render CLI:
render logs suwappubot
```

### Database connection errors
- Ensure `DATABASE_URL` uses the **Internal** URL (not External)
- Check if database is in the same region as your service

### Memory issues
- Upgrade to Starter plan ($7/mo) for more memory
- The C++ extension requires compilation during build

---

## Cost Estimate

| Resource | Free Tier | Paid |
|----------|-----------|------|
| Web Service | 750 hrs/mo (sleeps) | $7/mo (always on) |
| PostgreSQL | 1GB, 90 days | $7/mo |
| Redis | - | $10/mo |

**Recommended**: Starter plan ($7-14/mo) for production use.

