# Cloudflare Monetization Gateway readiness

Status: **not yet enabled in production.** This document describes the
integration Suwappu has built so that flipping it on later is a config change,
not a code change.

## What it is

Cloudflare's [Monetization Gateway](https://blog.cloudflare.com/monetization-gateway/)
does the x402 HTTP-402 payment handshake **at the edge**: it can intercept a
request, issue the 402 challenge, verify/settle USDC payment, and only then
forward the request to origin — driven by rule-based pricing (e.g. "$0.01 per
POST to `/api/premium/*`"). It's currently waitlist-only.

Suwappu's origin (`api-ts`, Hono) already runs its own complete x402 seller
stack: prepaid credit metering + 402 challenges in
`api-ts/src/middleware/x402Payment.ts`, gated by `AGENT_METERING_ENABLED`. Once
the Gateway starts charging some of that traffic at the edge, the origin must
stop charging it again for the *same* call — but our Railway origins remain
directly reachable (the Gateway only sits in front of `api.suwappu.bot`
traffic that actually flows through Cloudflare), so origin metering must stay
on for everything else.

## Architecture

```
                       (waitlist / not yet live)
        ┌───────────────────────────────────────────┐
        │        Cloudflare Monetization Gateway     │
 client │  - 402 handshake                            │
 ───────┼─▶ - verifies/settles USDC                   │
        │  - rule-based pricing (per path/method)    │
        └───────────────────┬─────────────────────────┘
                             │ (only for Gateway-priced prefixes)
                             ▼
        ┌───────────────────────────────────────────┐
        │   cloudflare/suwappu-router.worker.js      │
        │   (existing path router: api.suwappu.bot   │
        │    → python-api / api-ts on Railway)        │
        │                                             │
        │  + ALWAYS strips inbound                    │
        │    x-suwappu-edge-payment (spoof guard)     │
        │  + stamps a fresh HMAC-signed receipt ONLY   │
        │    when ALL THREE are true: GATEWAY_HMAC_    │
        │    SECRET set, path in GATEWAY_PAID_PREFIXES, │
        │    AND the request carries a non-empty        │
        │    GATEWAY_SETTLEMENT_HEADER value (actual     │
        │    proof the Gateway settled this call —       │
        │    path-match alone is NOT proof of payment)   │
        └───────────────────┬─────────────────────────┘
                             │  x-suwappu-edge-payment: v1.<ts>.<hmac>
                             ▼
        ┌───────────────────────────────────────────┐
        │        Railway origin (api-ts)              │
        │  middleware/x402Payment.ts:                 │
        │   - verifies receipt (edgePaymentTrust.ts)   │
        │     with shared secret CF_GATEWAY_TRUST_    │
        │     SECRET, ±300s skew, method+path bound    │
        │   - valid  → skip credit deduction            │
        │              (kind: 'edge', X-Metering-Edge) │
        │   - absent/invalid/expired → meter normally  │
        │              (prepaid credits / 402 /        │
        │               facilitator settlement)         │
        └───────────────────────────────────────────┘

Direct-to-Railway traffic (bypassing Cloudflare / the Worker entirely) never
carries a valid receipt, so it is always metered by the origin as today.
```

## Setup steps (in rollout order — see "Rollout order" below for why)

1. **Join the waitlist.** Cloudflare Monetization Gateway is currently
   waitlist-gated; request access before any of the following matters.
2. **Configure the origin (api-ts on Railway) first, but leave it OFF:**
   - Set `CF_GATEWAY_TRUST_SECRET` to a freshly generated random secret
     (e.g. `openssl rand -hex 32`), shared out-of-band with the Worker config
     in the next step. Never commit this value.
   - Leave `CF_GATEWAY_TRUST_ENABLED=false` until the Worker is deployed and
     verified to be stamping receipts correctly (see rollout order).
3. **Configure the Worker:**
   ```bash
   cd cloudflare
   bunx wrangler secret put GATEWAY_HMAC_SECRET   # paste the SAME secret as CF_GATEWAY_TRUST_SECRET
   ```
   Then set two plain vars (not secrets) in `cloudflare/wrangler.toml`'s
   `[vars]` block — see the commented example already in that file:
   - `GATEWAY_PAID_PREFIXES` — comma-separated path prefixes the Gateway is
     configured to charge for, e.g. `/v1/agent/`. **Do not include `/mcp`**
     (see the MCP caveat below) — only REST endpoints with distinct paths
     belong here.
   - `GATEWAY_SETTLEMENT_HEADER` — the exact header name Cloudflare's
     Monetization Gateway injects on a request it has actually settled.
     **This name is not public yet; confirm it from Cloudflare's early-access
     docs before setting it.** Do not set `GATEWAY_HMAC_SECRET` /
     `GATEWAY_PAID_PREFIXES` without also setting this — without it the
     Worker never stamps a receipt (fail-closed), which is safe but inert; the
     wrong value here (or setting it before confirming the real header name)
     risks stamping receipts for requests that were never actually charged.

   Deploy with `bunx wrangler deploy`.
4. **Verify the edge actually blocks unpaid calls BEFORE trusting any
   receipt.** The goal of this step is to *rule out* the bypass scenario
   (Gateway misconfigured / rule drift / free-tier leak), not just to confirm
   the Worker *can* sign a header. Concretely:
   - Send an **unpaid** request (no prior USDC settlement) directly to
     `https://api.suwappu.bot/v1/agent/<a paid-prefix path>` and confirm it
     gets an HTTP 402 **from the Gateway**, and that Railway's origin logs
     show **no** matching request at all (i.e. the Gateway truly stopped it
     at the edge rather than letting it through unmetered).
   - Only after that 402-at-the-edge behavior is confirmed, send a real
     **paid** request through the same path and confirm: (a) it reaches
     origin, (b) the `x-suwappu-edge-payment` receipt header is present and
     verifies, and (c) api-ts logs an `x402_edge_settled` audit line for it
     (see `api-ts/src/middleware/x402Payment.ts`).
   - Do NOT flip `CF_GATEWAY_TRUST_ENABLED=true` on Railway's api-ts service
     until both checks pass. The old version of this step ("curl through the
     Worker and see the header verify") only demonstrated that stamping
     works — it did not rule out stamping on unpaid traffic, which is exactly
     the bypass this design must prevent.
5. **Create Cloudflare Gateway pricing rules** from
   `GET /v1/agent/pricing` (public, unauthenticated, unmetered) — it returns
   the exact per-REST-endpoint and per-MCP-tool credit/USD prices, plus
   `network` / `asset` / `pay_to`, so the Gateway's rule-based pricing always
   matches what the origin would otherwise have charged. Only create rules
   for REST endpoints (paths under `GATEWAY_PAID_PREFIXES`); do not create an
   edge pricing rule for `/mcp` (see below).

### MCP is intentionally excluded from edge pricing

`/mcp` is a single `POST /mcp` JSON-RPC route shared by every tool, priced
per *tool name* (0-5 credits, see `MCP_TOOL_COSTS` in
`api-ts/src/middleware/x402Payment.ts`). The Gateway prices by path + method,
not by request body content, so a flat edge rule on `/mcp` would charge one
price for every tool call regardless of which tool ran — either over-charging
cheap reads or under-charging `execute_swap`. Keep MCP on origin metering
only: never add `/mcp` to `GATEWAY_PAID_PREFIXES` or create a Gateway pricing
rule for it. (The edge-receipt verification code path in `mcp.ts`'s
`tools/call` handler is still wired up and harmless — it simply never
triggers because no valid receipt will ever arrive for `/mcp` — and becomes
useful automatically if individual MCP tools are ever split into distinct
sub-paths.)

## Security model

- **Path-match alone is never sufficient proof of payment.** The Worker only
  stamps a receipt when it has actual settlement evidence — a non-empty
  `GATEWAY_SETTLEMENT_HEADER` value on the specific request — in addition to
  the path matching `GATEWAY_PAID_PREFIXES`. Trusting the path match alone
  would mean a Gateway misconfiguration, an accidentally-applied free/trial
  allowance, or the Gateway's rule set drifting out of sync with
  `GATEWAY_PAID_PREFIXES` would silently bypass origin metering for every
  request on that prefix, paid or not. If `GATEWAY_SETTLEMENT_HEADER` is
  unset, the Worker never stamps a receipt at all (fail-closed).
- **Anti-spoof assumption for the settlement header:** a request that reaches
  the Worker directly (not through Cloudflare's edge) could in principle set
  an arbitrary value for whatever header name `GATEWAY_SETTLEMENT_HEADER` is
  configured to. This is only safe because the Worker is bound exclusively to
  our Custom Domains behind Cloudflare's edge (it is not an open proxy
  reachable by an arbitrary hostname), and because the Gateway is expected to
  overwrite/strip its own settlement header rather than pass a client-supplied
  copy through unchanged. **This assumption must be confirmed against
  Cloudflare's actual early-access behavior before enabling stamping** — do
  not set `GATEWAY_SETTLEMENT_HEADER` in production until it is.
- **Why direct-to-Railway traffic still gets metered:** the receipt is only
  ever stamped by the Worker, using a secret that never leaves Cloudflare/
  Railway config. A request that reaches Railway without going through the
  Worker (e.g. hitting the `*.up.railway.app` hostname directly) simply has no
  receipt header, so `chargeAgentForCall` falls through to normal prepaid
  credit metering — this is the fail-closed default (see
  `api-ts/src/middleware/x402Payment.ts`, the `edgeReceipt` branch runs only
  when `CF_GATEWAY_TRUST_ENABLED === 'true'` AND the secret is non-empty AND a
  receipt was supplied AND it verifies; any missing piece falls through
  silently).
- **Why inbound header stripping matters:** without stripping, a client could
  set `x-suwappu-edge-payment` itself on a direct request and attempt to
  forge/replay a value, so the Worker unconditionally deletes any
  client-supplied copy of the header before proxying — even when Gateway
  trust isn't configured at all (`cloudflare/suwappu-router.worker.js`).
- **Replay is bounded, not eliminated:** the receipt only binds
  `(version, timestamp, method, path)` — it is not bound to a specific
  request body, quote ID, or nonce. A captured receipt could in principle be
  replayed against the *same* method+path within the ±300s skew window. This
  is an acceptable tradeoff because (a) the Gateway itself already charged for
  that specific request at the edge — reuse just means the origin also treats
  a second, different call to the same path as "already paid," a bounded
  under-charge, not a fund-theft vector — and (b) 300s is short enough that
  exploiting it requires an active MITM position on Cloudflare's own edge
  network, which is a far larger compromise than this feature's blast radius.
  If tighter binding is ever needed, extend the signed payload with a
  request-body hash or a Gateway-issued nonce.

## Rollout order

1. **Origin env first** (`CF_GATEWAY_TRUST_SECRET` set, `CF_GATEWAY_TRUST_ENABLED=false`) —
   so the secret exists before anything can verify against it, and metering
   behavior is unchanged until explicitly flipped on.
2. **Then the Worker** (`GATEWAY_HMAC_SECRET`, `GATEWAY_PAID_PREFIXES`,
   `GATEWAY_SETTLEMENT_HEADER` — all three, confirmed against Cloudflare's
   early-access docs — deploy) — verify manually that receipts are stamped
   and verify correctly against the origin secret, with trust still OFF so a
   bad receipt can't cause a double-charge or an accidental bypass in
   production.
3. **Prove the edge actually 402s unpaid traffic** (step 4 above) before
   trusting anything — this is the check that rules out the misconfig/rule-
   drift bypass, not just confirms the signature works.
4. **Then flip `CF_GATEWAY_TRUST_ENABLED=true`** on the origin.
5. **Then create the Cloudflare Gateway pricing rules** from
   `GET /v1/agent/pricing` (REST endpoints only, never `/mcp`), and only then
   start sending real Gateway-billed traffic through `api.suwappu.bot`.

## Code references

- `api-ts/src/lib/edgePaymentTrust.ts` — receipt format, `signEdgeReceipt`,
  `verifyEdgeReceipt` (pure, unit-tested in
  `api-ts/src/__tests__/edgePaymentTrust.test.ts`).
- `api-ts/src/middleware/x402Payment.ts` — `chargeAgentForCall`'s `edgeReceipt`
  param, the `{ kind: 'edge' }` `ChargeResult`, and the `x402_edge_settled`
  structured audit log line emitted on every edge-trusted call (via
  `lib/logger.ts`'s pino `logger`); wired into both `meteredPayment()` (REST)
  and the MCP `tools/call` handler (`api-ts/src/routes/mcp.ts`, which shares
  this same `chargeAgentForCall` code path so it gets the same audit log for
  free — no separate log site needed there).
- `api-ts/src/config/EnvService.ts` — `CF_GATEWAY_TRUST_ENABLED`,
  `CF_GATEWAY_TRUST_SECRET`.
- `cloudflare/suwappu-router.worker.js` — unconditional inbound header strip,
  plus receipt stamping gated on all three of `GATEWAY_HMAC_SECRET`,
  `GATEWAY_PAID_PREFIXES`, and a non-empty `GATEWAY_SETTLEMENT_HEADER` value
  on the specific request (fail-closed if any is missing).
- `cloudflare/wrangler.toml` — commented-out `GATEWAY_PAID_PREFIXES` /
  `GATEWAY_SETTLEMENT_HEADER` examples and the
  `wrangler secret put GATEWAY_HMAC_SECRET` instruction (the secret itself is
  intentionally not in this file).
- `GET /v1/agent/pricing` (`api-ts/src/routes/agent.ts`) — pricing manifest
  (REST + MCP tool prices; only the REST subset should ever back a Gateway
  pricing rule).
