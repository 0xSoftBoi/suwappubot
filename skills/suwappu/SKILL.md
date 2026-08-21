---
name: suwappu
description: "Build with the Suwappu REST API: cross-chain quotes, simulation, self-custody or managed swaps, managed-wallet portfolio/prices, Polymarket research and orders, Hyperliquid market research, and Morpho lending-market research."
license: MIT
---

# Suwappu — Cross-Chain DEX API

Suwappu is a cross-chain DeFi API for AI agents: routed swaps,
Hyperliquid market research, Polymarket prediction markets, and Morpho lending-market data —
all over plain REST (curl/fetch), with optional TypeScript/Python SDKs and an MCP server for
deeper tool integration.

This skill is **API-first**: every example is a `curl` call. Use it directly, or reach for the
SDKs when you're already writing TS/Python and want typed methods instead of raw HTTP. Check the
published registry version before relying on a source-only method; the repository can be ahead of
npm/PyPI. REST + the live OpenAPI spec remain the compatibility baseline.

**Non-custodial by design**: Suwappu never holds signing authority over a self-custodied wallet
end-to-end. Swap endpoints return an **unsigned** transaction; you sign and broadcast it with your
own wallet. A separate *managed wallet* flow exists for agents that want the API to hold a
Turnkey-secured key and execute server-side — see "Self-signed vs managed swaps" below.

## 1. Get an API key (self-register)

No signup UI needed — register directly:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
```

Response (trimmed):

```json
{
  "success": true,
  "agent": { "id": "...", "name": "my-agent", "api_key": "suwappu_sk_...", "created_at": "..." },
  "important": "SAVE YOUR API KEY! It cannot be retrieved later."
}
```

`name` must be 3-50 chars, alphanumeric plus `_`/`-`. **Save `api_key` immediately** — it is shown
exactly once and cannot be recovered; if lost, register a new agent (or use `POST
/v1/agent/keys/rotate` once authenticated).

Rate limit on registration itself: 5 requests per IP. If you're building on top of the TypeScript
SDK, `suwappu register --name my-agent --save` does this and writes the key to
`~/.config/suwappu/config.json` for you.

## 2. Auth

Send the key on every authenticated request:

```
Authorization: Bearer suwappu_sk_...
```

```bash
export SUWAPPU_API_KEY=suwappu_sk_...
curl https://api.suwappu.bot/v1/agent/me -H "Authorization: Bearer $SUWAPPU_API_KEY"
```

Most application calls require auth. `POST /register`, `GET /chains`, and `GET /openapi` are
public; MCP has a few additional public discovery tools.

## 3. Get a quote

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from_token":"ETH","to_token":"USDC","amount":"0.5","chain":"base"}'
```

For a **cross-chain** quote, pass `from_chain`/`to_chain` instead of (or in addition to) `chain`.
Response includes `quote_id`, the route, price impact, gas/bridge fee estimate, and
`expires_in_seconds` (60s — quotes are single-use and short-lived, re-quote if it expires). Solana
uses Jupiter under the hood; EVM chains use Li.Fi. Both return the same shape.

Add `wallet_address` to the quote request to get back ready-to-sign `transaction` data in the same
call (skips the separate `POST /swap` round trip below).

## 4. Simulate before execution

Dry-run the cached quote before you request a signable transaction or a managed broadcast:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/simulate \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"quote_id":"<from step 3>","wallet_address":"0xYourWallet"}'
```

Inspect `would_execute`, `checks`, `warnings`, expected output, price impact, and fee/gas
estimates. Simulation moves no funds and never signs or broadcasts.

## 5. Execute a swap: self-signed vs managed

Suwappu supports two execution models. Pick one per agent, not per call — mixing them per swap
adds no value.

### A. Self-signed (default, recommended for most agents)

You hold the keys. Suwappu returns an **unsigned** transaction; you sign and broadcast.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"quote_id":"<from step 3>","wallet_address":"0xYourWallet"}'
```

Returns `status: "ready"`, a swap summary, and:
- **EVM**: `transaction: {to, from, value, data, chain_id, gas_limit, gas_price}` — sign with any
  EVM wallet (ethers/viem/web3.py) and submit to the chain's RPC.
- **Solana**: `transaction: {serialized_transaction}` (base64) — deserialize, sign, and
  `sendTransaction`.

Then track the swap on-chain yourself. Suwappu never sees a self-custody broadcast, so managed
swap status/history must not be used as proof that this transaction landed.

### B. Managed wallet (server-side signing)

For agents that want Suwappu to hold a key (Turnkey TEE-secured, 2FA + spend limits enforced
server-side) and execute the full swap in one call:

```bash
# One-time: provision a managed wallet
curl -X POST https://api.suwappu.bot/v1/agent/wallets -H "Authorization: Bearer $SUWAPPU_API_KEY"

# Then, per swap:
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: my-strategy-2026-08-06-001" \
  -d '{"quote_id":"<from step 3>"}'
```

Returns `swap_id`, `status`, and `tx_hash` (once mined) — Suwappu signs and broadcasts for you.
Only use this on an agent you trust with fund custody; the managed wallet is still non-custodial
to *you* (Turnkey enclave, exportable anytime) but is custodial *to the agent process*.

**Always show the user the quote (route, price impact, fee) and get explicit confirmation before
calling either swap endpoint.** Preserve `quote_id` end-to-end for audit.

If a managed execution times out or returns a network/5xx error, its on-chain outcome can be
unknown. Reuse the same `Idempotency-Key` (1–64 chars from `A-Za-z0-9_.:-`) and reconcile swap
status/history before deciding whether to submit again. Never blind-retry a money-moving POST.

## 6. Check status

```bash
curl https://api.suwappu.bot/v1/agent/swap/status/<swapId> -H "Authorization: Bearer $SUWAPPU_API_KEY"
curl https://api.suwappu.bot/v1/agent/swaps -H "Authorization: Bearer $SUWAPPU_API_KEY"          # history
curl "https://api.suwappu.bot/v1/agent/portfolio?wallet_address=0x..." -H "Authorization: Bearer $SUWAPPU_API_KEY"
```

`swap-status` only applies to swaps executed via `/swap/execute` (managed). For self-signed
swaps, poll the transaction hash on-chain (or a block explorer / Blockscout MCP) — Suwappu has no
visibility into a transaction it didn't broadcast.

## 7. Handle 402 Payment Required (x402)

Suwappu meters some tiers per-call using prepaid credits, with on-chain top-up via the
[x402](https://x402.org) protocol. A metered call with no credits returns:

```
HTTP 402
X-Payment-Required: <base64 x402 challenge>
{"error":"insufficient_credits","cost_credits":1,"accepts":[{...EIP-3009 USDC payment...}],
 "topup":"POST /v1/agent/billing/topup with {txHash, chain, amount}"}
```

Two ways to resolve it:
1. **Top up credits**: pay USDC on-chain to the `payTo` address in the challenge, then
   `POST /v1/agent/billing/topup {"txHash":"0x...","chain":"base","amount":"5.00"}`. Idempotent on
   `txHash` — safe to retry.
2. **Pay per call**: if you're using an x402-aware HTTP client (`x402-fetch`/`x402-axios`), it can
   auto-construct the `X-PAYMENT` header from the challenge and settle that single call on-chain —
   no code change needed beyond swapping your fetch client.

Check your standing any time: `GET /v1/agent/billing` (balance, tier, whether you're currently
metered, cost per endpoint). The `agent`/`pro`/`premium`/`enterprise` tiers bypass per-call
metering; `free` is the metered tier when server-side metering is enabled. See `bypass_tiers` in
the live response rather than hardcoding this policy.

## 8. Handle rate limits

Every response carries `X-RateLimit-Limit` / `X-RateLimit-Remaining`. A 429 adds `Retry-After`
(seconds). Limits are per-agent, sliding 1-minute window: `free` 30/min, `agent` 100/min, `pro`
500/min, `premium` 2000/min, `enterprise` 10000/min. Back off using `Retry-After`, don't hardcode a
delay — the window resets continuously, not on a fixed clock tick.

## 9. Error recovery

All errors share one shape:

```json
{"success": false, "error": "Validation Error", "message": "amount must be a positive number",
 "fields": {"amount": "..."}, "error_guidance": "..."}
```

Read `message` and `fields` first — validation errors almost always name the bad field.
`error_guidance` (when present) is written for an agent, not a human: it's the fastest path to a
fix. Common cases:

| Status | Likely cause | Fix |
|---|---|---|
| 400 | Bad token/chain name, expired `quote_id`, missing `wallet_address` | Re-check `fields`; quotes expire in 60s — re-quote |
| 401 | Missing/invalid `Authorization` header | Confirm `Bearer suwappu_sk_...`, not a stale/rotated key |
| 402 | Metered endpoint, no credits | See §7 |
| 403 | Wallet-scoped read/command failed ownership, or org policy blocked the trade | Check the endpoint's wallet requirements and policy `reason` in the body |
| 404 | Unknown swap id / market id | Re-check the id came from a real prior response |
| 429 | Rate limited | Back off `Retry-After` seconds |
| 500/502 | Suwappu-side or upstream failure | Retry read-only calls with backoff. For execution POSTs, reconcile first and reuse the same idempotency key; the outcome can be unknown. |

Cross-agent quote hijacking is blocked server-side (a `quote_id` only redeems for the agent that
created it) — a 400 "Quote expired or not found" on a fresh quote usually means a typo in the id,
not a real hijack attempt.

## Other markets (same auth, same error shape)

```bash
# Perps research (Hyperliquid — no Agent API open/close endpoint)
curl https://api.suwappu.bot/v1/agent/perps/markets
curl -X POST https://api.suwappu.bot/v1/agent/perps/quote -H "Authorization: Bearer $SUWAPPU_API_KEY" \
  -H "Content-Type: application/json" -d '{"market":"ETH","side":"long","size":0.5,"leverage":10}'

# Predictions (Polymarket)
curl "https://api.suwappu.bot/v1/agent/predict/markets?query=election&limit=20"
curl https://api.suwappu.bot/v1/agent/predict/market/<id>

# Lending research (Morpho — read-only market data)
curl https://api.suwappu.bot/v1/agent/lend/markets
```

See `references/endpoints.md` for the full parameter reference (kept out of this file to stay
lean — read it on demand, not up front).

## Deeper discovery

- **llms.txt** (machine-readable endpoint index): `https://api.suwappu.bot/llms.txt`
- **OpenAPI 3.1 spec**: `GET https://api.suwappu.bot/v1/agent/openapi`
- **MCP server** (JSON-RPC 2.0 tool-calling instead of raw REST): `POST https://api.suwappu.bot/mcp`.
  Source 0.6 advertises 22 tools; call `tools/list` at runtime for the canonical deployed set.
  Its historical `execute_swap` tool prepares an unsigned self-custody transaction and never
  signs/broadcasts. Perps and lending MCP tools are research/read-only surfaces.
- **Agent Card** (A2A discovery): `GET https://api.suwappu.bot/.well-known/agent.json`
- **TypeScript SDK**: `@suwappu/sdk` (npm) — typed client + `suwappu` CLI (`suwappu --help`).
- **Python SDK source**: `packages/sdk-python`; verify the current PyPI version before installing.
- **Full docs**: https://suwappu.bot/docs

## Safety checklist

- Never put `SUWAPPU_API_KEY` in committed files or logs — env var or secret manager only.
- Self-signed swaps: you (or the user's wallet) sign, not Suwappu. Managed swaps: only enable on
  an agent you trust with spend authority, and note the spend-limit guardrails are enforced
  server-side regardless (2FA + per-swap/hourly/daily caps + tx simulation).
- Always show quote details (route, price impact, fee, `expires_in_seconds`) and get user
  confirmation before calling `/swap`, `/swap/execute`, or any order-placing endpoint.
- Do not hardcode swap fees into an agent. EVM and Solana agent-surface fee configuration can
  differ, and pricing can change; use the quote/live pricing docs in the economic decision.
