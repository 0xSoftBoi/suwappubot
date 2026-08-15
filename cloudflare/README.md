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

### 2 + 3. Deploy the Worker AND bind all hostnames — one command
Once the zone is **Active** on Cloudflare (step 1) and you've run `bunx wrangler login`:
```bash
cd cloudflare && bunx wrangler deploy
```
`wrangler.toml` has `custom_domain = true` for `api`, `www`, apex, `terminal`, and `app`, so
this single command deploys the Worker and creates each Custom Domain + edge TLS cert
automatically — no dashboard clicking. (Dashboard equivalent: Workers & Pages → Create Worker
`suwappu-router`, paste `suwappu-router.worker.js`, then Settings → Domains & Routes → add each
Custom Domain.) Note: if a hostname already has a stale DNS record (e.g. an old ALB CNAME),
delete it first or the Custom Domain bind returns error 100117.

Client TLS is served by Cloudflare; the Worker fetches each origin over the valid
`*.up.railway.app` cert. The hostname→origin map lives in `suwappu-router.worker.js`.

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
- If a railway URL ever changes, update the matching entry in `ORIGINS` and redeploy. Current:
  python-api `python-api-production-8526`, api-ts `api-ts-production`, showcase `showcase-production-6f89`.

## Per-hostname status (June 2026)
| Hostname | Status | Action |
|----------|--------|--------|
| `api.suwappu.bot` | ✅ live (python-api + api-ts) | bound |
| `www.suwappu.bot` / `suwappu.bot` | ✅ live (showcase) | bound |
| `terminal.suwappu.bot` | ✅ live (terminal) | bound; 502 fixed in PR #349 ($PORT) |
| `app.suwappu.bot` | ✅ live (→ terminal) | bound; old Mini App source is gone so `app` mirrors terminal |
| `devapi.suwappu.bot` | 🔶 dev python-api exposed at `python-api-dev-456d.up.railway.app`; Worker branch + route added — **needs `wrangler deploy` to bind the Custom Domain** | run `bunx wrangler login && bunx wrangler deploy` |

Five hostnames (`api`, `www`, apex, `terminal`, `app`) are **live** and serving through the
Worker with valid edge TLS. `devapi` is code-complete but **not yet resolving**: the dev
python-api now has a public Railway domain and the Worker routes the hostname, but the
Cloudflare Custom Domain (and therefore its DNS record) is only created when someone runs
`wrangler deploy` — that step needs interactive `wrangler login` and cannot be automated
from an agent session.

**Dev routing differs from prod.** `api.suwappu.bot` path-splits between python-api and
api-ts. The dev environment has **no api-ts service**, so `devapi.suwappu.bot` sends *every*
path to dev python-api. The hostname check sits before the path-routing fallthrough
deliberately — without it, any non-python path on devapi would reach **production** api-ts.
