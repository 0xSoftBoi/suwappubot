# Free edge router for `api.suwappu.bot` (Cloudflare Worker)

## Why this exists
The AWS→Railway migration deleted the ALB (`suwappu-alb-…elb.amazonaws.com`) that
path-routed `api.suwappu.bot` across **python-api** and **api-ts**. Every `*.suwappu.bot`
hostname still CNAMEs to that dead ALB → the whole HTTP API is down (the Telegram bot
survives because it uses outbound polling). Railway **custom domains require a paid plan**,
so instead of paying we put one **free Cloudflare Worker** at the edge to do the path
routing the ALB used to do. The Worker is in `suwappu-router.worker.js`.

Both backends are healthy on their free Railway URLs:
- python-api → `https://python-api-production-8526.up.railway.app`
- api-ts → `https://api-ts-production.up.railway.app`

## One-time setup

### 1. Put `suwappu.bot` on Cloudflare (free)
1. Cloudflare dashboard → **Add a site** → `suwappu.bot` → **Free** plan.
2. Cloudflare imports existing DNS. **Delete/disable the stale `api`, `devapi`, `www`,
   `app`, `terminal` CNAMEs** that point at `suwappu-alb-…elb.amazonaws.com` (all dead).
3. Cloudflare gives you two nameservers. At **Gandi** (current registrar), set the domain's
   nameservers to those two. Propagation is usually minutes to a couple hours.
4. SSL/TLS → set mode to **Full** (not Flexible, not Full(Strict)).

### 2. Create the Worker
1. Cloudflare → **Workers & Pages** → **Create** → **Worker**. Name it `suwappu-router`.
2. Paste the contents of `suwappu-router.worker.js` and **Deploy**.
   (Or with wrangler: `npx wrangler deploy suwappu-router.worker.js --name suwappu-router`.)

### 3. Bind the hostname (Worker Custom Domain — simplest, auto DNS + cert)
1. Open the `suwappu-router` Worker → **Settings → Domains & Routes → Add → Custom Domain**.
2. Enter `api.suwappu.bot`. Cloudflare creates the proxied DNS record and provisions the
   edge TLS cert automatically — no manual record, no SSL-mode fiddling for this host.

That's it. Client TLS is served by Cloudflare; the Worker fetches each origin over the
valid `*.up.railway.app` cert.

## Verify
```bash
curl -s https://api.suwappu.bot/health            | head -c 200   # → api-ts health 200
curl -s https://api.suwappu.bot/v1/agent/chains   | head -c 200   # → api-ts, chains list 200
curl -s -X POST https://api.suwappu.bot/auth/refresh -i | head -5 # → python-api (401 without a cookie = reached it)
```
All three reaching the right backend = the ALB path-routing is restored, for $0.

## Routing map (keep in sync with the Worker)
| Path prefix | Backend | Notes |
|-------------|---------|-------|
| `/auth/*` | python-api | JWT **issuer**; api-ts has no `/auth`, only consumes the token |
| `/telegram/*`, `/webhook/*` | python-api | Telegram + WhatsApp |
| `/users/*`, `/tools/*` | python-api | python-only |
| everything else | api-ts | `/v1/agent/*`, `/mcp`, `/a2a`, `/webapp/*`, `/public/*`, `/staking/*`, `/billing/*`, `/health`, `/.well-known/*`, agent cards, `llms.txt` |

## Caveats / next steps
- **Free Workers cap: 100,000 requests/day** (~69/min avg). Fine for now. Keep external
  uptime monitors light, or point them at the railway URLs directly to save quota. If you
  outgrow it, Workers Paid is $5/mo — same price as Railway Hobby (which would instead give
  native custom domains and let you drop this Worker).
- **Other hostnames** (`devapi`, `terminal`, `app`, `www`, apex `suwappu.bot`): once the zone
  is on Cloudflare, restore each the same way — a Worker route (or a proxied CNAME to the
  service's railway domain **only if** that custom domain is also registered on Railway).
  `devapi` points at the python-api **development** environment.
- If `api-ts`'s railway URL ever changes (it's `api-ts-production.up.railway.app` now),
  update `API_TS` in the Worker and redeploy.
