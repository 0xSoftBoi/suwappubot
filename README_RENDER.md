# 🚀 Deploying Suwappu Bot to Render

We've configured your project for **Blueprint Deployment**, which automates everything.

## Step 1: Push to GitHub
Ensure you've committed all new files (`render.yaml`, `start_web.sh`, `requirements.txt`).

```bash
git add .
git commit -m "Configure Render deployment"
git push origin main
```

## Step 2: Create Service on Render
1. Go to [dashboard.render.com](https://dashboard.render.com)
2. Click **New +** → **Blueprint**
3. Connect your **GitHub Repository**
4. Give it a name (e.g., `suwappu-prod`)
5. Click **Apply**

  Render will automatically:
  - Create a **Database** (PostgreSQL)
  - Build and deploy the **Suwappu Monolith** (API + Bot background services)

## Step 3: Environment Variables
Go to the **Environment** tab for each service and verify/add secrets that aren't in `render.yaml` (like private keys).

You might need to manually add `TELEGRAM_BOT_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `ENCRYPTION_KEY`, etc., in the Render Dashboard if you didn't commit them (which is good!).

## Step 4: Webhook Update
Once deployed, your URL will change from `ngrok` to something like:
`https://suwappu-web.onrender.com/webhook`

**Update this URL in:**
1. **Meta Developer Portal** (WhatsApp Configuration)
2. **Telegram** (if using webhooks)

## 💡 Free Tier Uptime Trick (24/7 Bot)
Render's free tier sleeps after 15 minutes of inactivity. To keep your price alerts and swaps active:
1. Go to [cron-job.org](https://cron-job.org)
2. Create a new job to ping `https://your-service.onrender.com/health` every **10 minutes**.
3. This will keep the bot awake 24/7 at **zero cost**.

## 🎨 Frontend (Dashboard)
For the best performance, deploy the `dashboard/` folder to **Vercel** or **Netlify**. This keeps the UI fast and responsive while Render handles the heavy lifting.
