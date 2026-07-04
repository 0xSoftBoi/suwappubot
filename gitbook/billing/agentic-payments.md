# Agentic Payments (x402)

Suwappu meters pay-per-call usage using the [x402](https://x402.org) protocol: a paid endpoint or MCP tool call that would run you out of credits returns an HTTP `402 Payment Required` challenge instead of failing outright. x402-aware clients (`x402-axios`, `x402-fetch`, or your own retry logic) parse the challenge, settle the payment, and retry the original request automatically.

This only applies to the `free` rate-limit tier. Agents on `agent`, `pro`, `premium`, or `enterprise` bypass metering entirely — see [Pricing](pricing.md) for the tier table.

## The flow

```
1. Agent calls a metered endpoint (e.g. POST /v1/agent/quote, or an MCP tools/call)
2. Suwappu checks the agent's credit balance
   - Bypass tier or free tool (0 credits) → request proceeds, no charge
   - Sufficient balance → credits deducted atomically, request proceeds
   - Insufficient balance → HTTP 402 with an x402 challenge body
3. Client either:
   a) Tops up credits (POST /v1/agent/billing/topup) and retries, or
   b) Settles this single call on-chain and retries with an X-PAYMENT header
      (requires the x402 facilitator to be enabled server-side)
4. Retry succeeds
```

## The 402 challenge

When a call is rejected for insufficient credits, the response is HTTP `402` with this body:

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "base",
      "maxAmountRequired": "1000",
      "resource": "/v1/agent/quote",
      "description": "Suwappu agent API call: quote (1 credit)",
      "mimeType": "application/json",
      "payTo": "0x...",
      "maxTimeoutSeconds": 120,
      "asset": "0x...",
      "extra": { "name": "USD Coin", "version": "2" }
    }
  ],
  "error": "insufficient_credits",
  "cost_credits": 1,
  "credit_usd_value": 0.001,
  "topup": "POST /v1/agent/billing/topup with {txHash, chain, amount}",
  "subscribe": "POST /v1/agent/billing/subscribe with {txHash, chain, amount, tier}"
}
```

The same payload is also echoed as a base64-encoded `X-Payment-Required` header and a compact `Accept-Payment` header (`x402 network=... asset=... payTo=...`), so header-only x402 clients can react without parsing the body.

`accepts[0]` is a standard x402 `PaymentRequirements` object: `scheme: "exact"`, USDC on Base, `maxAmountRequired` in USDC base units (6 decimals). Off-the-shelf x402 clients construct the `X-PAYMENT` payload from this automatically.

## Settling the payment

You have two options once you see a 402:

### Option A — top up credits, then retry

Pay USDC to the `payTo` collector address (any amount — it doesn't have to match the single-call cost), then submit the transaction hash:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/billing/topup \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"txHash": "0xabc...", "chain": "base", "amount": 5}'
```

**Body:** `{ txHash: string, chain: string (default "base"), amount: number }` — `amount` is the USDC amount you actually paid.

Suwappu verifies the payment on-chain via the internal x402 verifier before crediting your balance. The endpoint is idempotent on `txHash` — retrying with the same hash never double-credits.

**Response:**

```json
{
  "success": true,
  "already_processed": false,
  "tx_hash": "0xabc...",
  "credits_added": 5000,
  "balance": 5000,
  "message": "Credited 5000 credits."
}
```

`credits_added = amount / 0.001`, so $5 buys 5,000 credits. Retry your original call once the topup succeeds.

### Option B — settle the single call on-chain (facilitator path)

If your client supports x402 natively (e.g. `x402-fetch`), it can sign and attach an `X-PAYMENT` header to the retried request instead of pre-funding a credit balance. Suwappu verifies and settles this via its configured facilitator and, on success, lets the single call through with a `X-Payment-Response` header containing the settlement tx hash. This requires the facilitator to be enabled on the deploy — if it isn't, fall back to Option A.

## Subscriptions (bypass metering entirely)

Instead of paying per call, buy a prepaid 30-day access window on `pro`, `premium`, or `enterprise` and every metered call is free for the window's duration.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/billing/subscribe \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"txHash": "0xabc...", "chain": "base", "amount": 9.99, "tier": "pro"}'
```

**Body:** `{ txHash: string, chain: string (default "base"), amount: number, tier: "pro" | "premium" | "enterprise" }` — `amount` must be ≥ the tier's USD price (see [Pricing](pricing.md)).

**Response:**

```json
{
  "success": true,
  "already_processed": false,
  "tx_hash": "0xabc...",
  "tier": "pro",
  "expires_at": "2026-08-01T12:00:00.000Z",
  "auto_renew": false,
  "renew": "Prepaid window — re-POST before expiry to extend; time stacks.",
  "message": "Prepaid pro access window active until 2026-08-01T12:00:00.000Z (no auto-renew). Metered API + MCP calls are free for the window."
}
```

This is a **prepaid window, not a recurring subscription** — there's no auto-renew. Re-POST before expiry to extend; if you renew early, the new 30 days stacks on top of the remaining time rather than resetting it. Idempotent on `txHash`.

## True auto-renew (Base Spend Permissions)

For real recurring billing (no manual re-POST), register a [Base Spend Permission](https://docs.base.org/base-account/improve-ux/spend-permissions) that lets Suwappu's operator pull the tier price once per period:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/billing/recurring \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tier": "pro",
    "signature": "0x...",
    "permission": {
      "account": "0x...",
      "spender": "0x...",
      "token": "0x...",
      "allowance": "9990000",
      "period": 2592000,
      "start": 1750000000,
      "end": 1781536000,
      "salt": "1",
      "extraData": "0x"
    }
  }'
```

The `permission` object is an EIP-712 `SpendPermission` you sign client-side with the paying account's wallet (`account`). Suwappu validates that `spender` is its own operator address, `token` is the configured USDC contract, and `allowance` covers at least the tier price before registering it — a bad signature or mismatched fields is rejected server-side. A scheduler then calls `spend()` each `period` to pull the tier price automatically. Cancel by revoking the permission on-chain.

## Human users (non-agent)

Telegram/webapp users subscribe via Stripe checkout or crypto, not the agent bearer-token flow above:

- `GET /billing/stripe/checkout?tier=pro` — creates a Stripe checkout session (redirects by default; add `&format=json` for the URL as JSON)
- `POST /billing/crypto` — crypto-native subscription for human users (same USDC/tier mechanics as `/v1/agent/billing/subscribe`, authenticated via Telegram session instead of a bearer key)

## Checking your status

```bash
curl https://api.suwappu.bot/v1/agent/billing \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

Returns your current tier, whether metering applies to you (`is_metered`), credit balance (`balance`, `lifetime_purchased`, `lifetime_used`), the live cost weights for REST and MCP, and your active subscription window if any.
