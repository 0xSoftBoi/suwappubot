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
        │  + if GATEWAY_HMAC_SECRET + path in          │
        │    GATEWAY_PAID_PREFIXES: stamps a fresh     │
        │    HMAC-signed receipt header                │
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
   Then set `GATEWAY_PAID_PREFIXES` (a plain var, not a secret) in
   `cloudflare/wrangler.toml`'s `[vars]` block — see the commented example
   already in that file — to the comma-separated path prefixes the Gateway is
   configured to charge for, e.g. `/v1/agent/,/mcp`. Deploy with
   `bunx wrangler deploy`.
4. **Flip `CF_GATEWAY_TRUST_ENABLED=true`** on Railway's api-ts service once
   you've confirmed (via a manual curl through the Worker) that the
   `x-suwappu-edge-payment` header is present and verifies.
5. **Create Cloudflare Gateway pricing rules** from
   `GET /v1/agent/pricing` (public, unauthenticated, unmetered) — it returns
   the exact per-REST-endpoint and per-MCP-tool credit/USD prices, plus
   `network` / `asset` / `pay_to`, so the Gateway's rule-based pricing always
   matches what the origin would otherwise have charged.

## Security model

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
2. **Then the Worker** (`GATEWAY_HMAC_SECRET`, `GATEWAY_PAID_PREFIXES`, deploy) —
   verify manually that receipts are stamped and verify correctly against the
   origin secret, with trust still OFF so a bad receipt can't cause a
   double-charge or an accidental bypass in production.
3. **Then flip `CF_GATEWAY_TRUST_ENABLED=true`** on the origin.
4. **Then create the Cloudflare Gateway pricing rules** from
   `GET /v1/agent/pricing`, and only then start sending real Gateway-billed
   traffic through `api.suwappu.bot`.

## Code references

- `api-ts/src/lib/edgePaymentTrust.ts` — receipt format, `signEdgeReceipt`,
  `verifyEdgeReceipt` (pure, unit-tested in
  `api-ts/src/__tests__/edgePaymentTrust.test.ts`).
- `api-ts/src/middleware/x402Payment.ts` — `chargeAgentForCall`'s `edgeReceipt`
  param and the `{ kind: 'edge' }` `ChargeResult`; wired into both
  `meteredPayment()` (REST) and the MCP `tools/call` handler
  (`api-ts/src/routes/mcp.ts`).
- `api-ts/src/config/EnvService.ts` — `CF_GATEWAY_TRUST_ENABLED`,
  `CF_GATEWAY_TRUST_SECRET`.
- `cloudflare/suwappu-router.worker.js` — header stripping + receipt stamping.
- `cloudflare/wrangler.toml` — commented-out `GATEWAY_PAID_PREFIXES` example
  and the `wrangler secret put GATEWAY_HMAC_SECRET` instruction (the secret
  itself is intentionally not in this file).
- `GET /v1/agent/pricing` (`api-ts/src/routes/agent.ts`) — pricing manifest.
