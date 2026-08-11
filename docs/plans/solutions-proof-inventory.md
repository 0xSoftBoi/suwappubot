# Proof inventory — what we can actually claim, measured

Third companion doc. `solutions-pages-redesign.md` says the solutions pages
need proof and we have no logos; `solutions-competitor-teardown.md` says the
substitute is **specific self-measured numbers**. This file records what is
actually true, measured against production, so nobody has to invent a number
later.

Measured 2026-08-11 via the Railway MCP and direct calls to production.
**Deploy target is Railway. Vercel appears in the teardown only as a design
reference — we do not deploy there.**

---

## 1. Production topology (Railway MCP, project `suwappu`)

Environment `production`. **All 10 services report `SUCCESS` on their latest
deployment:**

| Service | Last successful deploy |
|---|---|
| python-api | 2026-08-09 |
| api-ts | 2026-08-09 |
| showcase | 2026-08-09 |
| webapp | 2026-08-09 |
| terminal | 2026-08-09 |
| python-worker | 2026-08-04 |
| Postgres, Redis, suwappu-bridge, suwappu-relayer | 2026-06-10 |

**Finding worth a separate ticket:** no service in this project's production
environment has a **custom domain** registered in Railway — showcase is only
`showcase-production-6f89.up.railway.app`, api-ts only
`api-ts-production.up.railway.app`. Yet `suwappu.bot` and `api.suwappu.bot`
both serve 200s, and response headers show `server: cloudflare` +
`x-railway-edge: jfk1`. So the apex domains are fronted by Cloudflare rather
than attached as Railway custom domains. Not a solutions-page issue, but it
means Railway's dashboard is not the source of truth for our public URLs.

## 2. api-ts resource metrics — 7-day window (10,081 samples)

| Measurement | Average | Max |
|---|---|---|
| CPU_USAGE | 0.41% | 9.95% |
| MEMORY_USAGE_GB | 0.263 | 0.568 |
| NETWORK_RX_GB (per sample) | ~0.0000019 | 0.00026 |
| NETWORK_TX_GB (per sample) | ~0.0000068 | 0.00039 |

**Read this honestly: traffic is very low.** The service is healthy and
idle. That rules out any volume-based proof claim — no "$X routed," no
"N integrators," no "M requests/day." Competitors lead with those; **we
cannot, and must not fake them.**

## 3. What we measured live and CAN cite

- `GET https://api.suwappu.bot/health` → 200,
  `{"status":"ok","service":"suwappu-api-ts","version":"0.4.0","db":"connected"}`
- `GET https://api.suwappu.bot/v1/agent/chains` → 200, **public and
  unauthenticated.** Five consecutive calls: 0.87s (cold), then 0.40, 0.41,
  0.46, 0.39s end-to-end from this container.
- Origin sets an **`x-response-time` header** (observed `2ms`). That's a real
  server-side latency source we could sample and publish, separate from
  network round-trip.
- `https://suwappu.bot/solutions` → 200 (0.85s), showcase origin → 200 (0.40s).

**The `/v1/agent/chains` endpoint being public and unauthenticated is the
single most useful finding here:** a live widget on a solutions page can call
it from the browser with **no API key exposure**. The "live demo" idea in the
redesign doc is technically unblocked for at least chain/route data.

### Claims we could stand behind
1. Chain count and router count — already build-time generated, verifiable.
2. **Server-side latency** from `x-response-time`, if we sample it properly
   and state the method.
3. Deploy/health status — all services green, sourced from Railway.

### Claims we cannot stand behind today
1. Volume, TVL, request counts, integrator counts.
2. **Uptime percentage.** We have no uptime history — 7 days of resource
   metrics with a deploy inside the window is not a 99.9x figure. Publishing
   one would be invented. If we want it, we need an actual uptime monitor
   feeding `/status`.
3. Revert rate / fill rate — no measurement pipeline exists.

---

## 4. A live accuracy bug on the current page

`showcase/src/app/solutions/page.tsx` (payments row) shows this curl and
claims the response:

```
HTTP/1.1 402 Payment Required
X-Payment: { "amount": "0.001", "asset": "USDC", "chain": "base" }
```

**Production actually returns HTTP 401.** Verified against
`POST https://api.suwappu.bot/v1/agent/quote` with the exact body from the
page and no auth header:

```
HTTP/2 401
x-response-time: 2ms
```

The whole payments row is built on "no signup, no API key handshake" — and
the endpoint answers 401, which is precisely an API-key demand. Under
investigation (see §5) whether the 402 path exists on another route, needs a
flag, or is unshipped. **Either way the page as published is wrong**, and
this is a live marketing claim about how our billing works.

---

## 5. Open

- Where the x402 402 flow actually lives, what triggers it, and whether it's
  enabled in production config. Scout in progress.
- Whether to stand up a real uptime monitor so a percentage becomes citable.
- Sampling method for a publishable latency figure.
