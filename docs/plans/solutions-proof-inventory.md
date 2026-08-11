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

## 4. Live accuracy bugs on the current page — all four fixed

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
the endpoint answers 401, which is precisely an API-key demand.

### Confirmed in the code — it is wrong on three counts

`/v1/agent/quote` carries two different payment middlewares
(`api-ts/src/routes/agent.ts:506` and `:600`), and **both are gated off by
default**:

| Flag | Default | Source |
|---|---|---|
| `MPP_ENABLED` | `'false'` | `api-ts/src/config/EnvService.ts:69` |
| `AGENT_METERING_ENABLED` | `'false'` | `api-ts/src/config/EnvService.ts:74` |

With MPP disabled, `mppPaymentAuth()` returns **401** rather than a challenge
(`api-ts/src/middleware/mppAuth.ts:53-59`). That is exactly the live response
we measured.

1. **Status code** — page claims 402 is the default response; production
   returns 401 because both billing paths are disabled.
2. **Header name** — page claims `X-Payment`. **No such header exists in the
   codebase.** The real ones are `X-Payment-Required`
   (`middleware/x402Payment.ts:179`) and `x-402`
   (`middleware/mppAuth.ts:94`), and both carry **base64-encoded** JSON, not
   the plaintext object the page prints.
3. **Reachability** — the 402 path needs `AGENT_METERING_ENABLED='true'`
   *and* an agent with insufficient prepaid credits
   (`middleware/x402Payment.ts:241, 361-364`). An unauthenticated caller
   fails at 401 and never reaches it. There is no header or query param a
   caller can send to get the documented flow.

The one accurate detail is the price: `MPP_SWAP_PRICE_USD` defaults to
`'0.001'`, matching the page's `"amount": "0.001"`.

**Attempted to confirm the production flag values through the Railway MCP;
reading service variables was blocked by the permission classifier.** Not
needed for the verdict — the live 401 from production is direct proof that
neither flag is on.

### Fixed

The payments row now shows the bearer-auth call that actually works, and
describes the 402 challenge as what happens **when metered payments are
enabled**, using the real `X-Payment-Required` / `Accept-Payment` headers and
noting the challenge is base64. `AGENT_METERING_ENABLED` was **not** changed —
turning on a billing path is a product decision, not a copy fix.

### The other three examples were wrong too

Verified against `api-ts/src/routes/agent.ts` and the SDK. Every code block on
the page had at least one false claim.

| Row | Was | Actually |
|---|---|---|
| Trading | `tx.status` → `"filled"` | `"filled"` is not a status. Real values include `"completed"`, `"confirming"`, `"failed"` (`bot/models/swap.py:20-33`). Class, constructor, `getQuote()`/`swap()` signatures were all correct. |
| Portfolio | `?tokens=ETH,SOL,BTC` | query param is **`?symbols=`** (`agent.ts:3059`) |
| Portfolio | response `"chains": [...]` | field is **`"balances"`** (`agent.ts:2427-2433`) |
| Portfolio | `"total_usd": "12,480.55"` | returned unformatted: **`"12480.55"`** |
| Wallets | `POST /wallets` with `{chain, policy:{max_spend_usd, allowed_pairs}}` | the handler **ignores the request body entirely** (`agent.ts:2450-2533`) |
| Wallets | response `{wallet_id, address}` | returns a nested **`wallet`** object with `address`, `chain_type`, `supported_chains` — there is no `wallet_id` |
| Wallets (body copy) | "per-key spend limits and allowed chains/pairs" | policies are a **separate call**, `POST /v1/agent/wallet/policy`, and support `spending_limit` (maxAmountWei + timeWindowSeconds) or an **address** whitelist — not pairs |

All corrected in `showcase/src/app/solutions/page.tsx`, including the wallets
body copy, which promised a policy shape the API does not accept.

**Note:** `docs.json` already used the correct `X-Payment-Required`. The docs
were right; only the marketing page was wrong.

---

## 5. Open

- Whether to stand up a real uptime monitor so a percentage becomes citable.
- Sampling method for a publishable latency figure.
- Product decision on the x402 row above.
