# Suwappu Agent API — Endpoint Reference

Base URL: `https://api.suwappu.bot/v1/agent`. All bodies are JSON. Auth via
`Authorization: Bearer suwappu_sk_...` unless marked **public**. Every response is either
`{"success": true, ...}` or `{"success": false, "error": "...", "message": "...", "fields"?: {...}, "error_guidance"?: "..."}`.

This is the detailed companion to `../SKILL.md` — read that first for the workflow; use this for
exact parameters when you need them.

## Account

| Method & path | Auth | Body / query | Notes |
|---|---|---|---|
| `POST /register` | public | `{name, description?, callback_url?, metadata?}` | `name`: 3-50 chars, `[a-zA-Z0-9_-]`. Returns `api_key` once. Rate-limited 5/IP. |
| `GET /me` | yes | — | Profile, tier, `stats.total_requests`/`total_swaps`. |
| `PATCH /me` | yes | `{description?, callback_url?, metadata?}` | Set `callback_url` to receive swap webhooks. |
| `DELETE /me` | yes | — | Deletes the agent. |
| `POST /me/deactivate` | yes | — | Soft-disable; key stops working. |
| `POST /reactivate` | yes (allows inactive) | — | Undo deactivate. |
| `POST /keys/rotate` | yes | — | Issues a new key, invalidates the old one immediately. |

## Discovery (no auth)

| Method & path | Notes |
|---|---|
| `GET /chains` | All supported chains: `{id, key, name, native_token, type}`. `type` is `evm`, `solana`, `move` (Sui), or `ton`. |
| `GET /openapi` | Full OpenAPI 3.1 spec. |

## Quotes & swaps

| Method & path | Body / query | Notes |
|---|---|---|
| `GET /tokens?chain=base&search=USD` | — | `chain` required (or `solana`); `search` filters by symbol substring. |
| `GET /prices?symbols=ETH,SOL,USDC&chain=base` | — | 1-20 comma-separated symbols; 60s cache. `chain` optional/unused for pricing scope. |
| `POST /quote` | `{from_token, to_token, amount, chain?, from_chain?, to_chain?, wallet_address?, slippage?}` | `amount` is human units (e.g. `"0.5"`), not wei. `slippage` is a fraction (0-0.5), default 0.03. Solana detected via chain name. Returns `quote_id`, valid 60s. |
| `POST /swap` | `{quote_id, wallet_address}` | Self-signed path. Returns unsigned `transaction` (EVM) or base64 `serialized_transaction` (Solana). **`wallet_address` is required** and, for EVM, must equal your managed wallet address if you have one provisioned (403 otherwise) — pass your own signing address if you don't. |
| `GET /swap/status/{swapId}` | — | Only for swaps executed via `/swap/execute` (managed path). |
| `GET /swaps?status=&limit=20&offset=0` | — | Paginated history, `limit` capped at 100. |
| `POST /execute` | `{command, wallet_address?}` | Natural-language shim: parses `"swap 0.5 ETH to USDC on base"` etc. into a quote. Prefer `/quote` directly for anything programmatic. |

## Managed wallets (server-side signing)

| Method & path | Body | Notes |
|---|---|---|
| `POST /wallets` | — | Provisions a Turnkey-secured EVM wallet for this agent. One-time. |
| `GET /wallets` | — | List managed wallets. |
| `POST /swap/execute` | `{quote_id}` | Requires a wallet from `/wallets` first. Server signs + broadcasts. Returns `swap_id`, `status`, `tx_hash`. |

## Portfolio & webhooks

| Method & path | Query / body | Notes |
|---|---|---|
| `GET /portfolio?wallet_address=0x...&chain=base` | — | Only your own managed wallet address is queryable (403 otherwise) unless you're checking an address you control off-platform — pass it anyway; ownership is enforced server-side for managed wallets. |
| `GET /webhooks` | — | Delivery log for your `callback_url`. |
| `POST /webhooks/test` | — | Fire a test delivery. |

## Billing (x402 metered credits)

| Method & path | Body | Notes |
|---|---|---|
| `GET /billing` | — | `tier`, `metering_enabled`, `is_metered`, `credits.balance`, `cost_weights` per endpoint, `topup`/`subscribe` instructions. Never itself metered. |
| `POST /billing/topup` | `{txHash, chain, amount}` | Credits your balance from an on-chain USDC payment. Idempotent on `txHash`. 1 credit ≈ $0.001. |
| `POST /billing/subscribe` | `{txHash, chain, amount, tier}` | Prepaid unmetered access window (no auto-renew); re-POST before expiry to extend. |
| `POST /billing/recurring` | — | True auto-renew via Base Spend Permissions (EIP-based), for agents that want it. |

Metered endpoints (only charged when `AGENT_METERING_ENABLED` and you're on the free tier with no
credits): `quote` (1 credit), `swap`/`execute`/`swap/execute` (5), `portfolio` (1), `prices` (1),
`tokens` (1). A metered call with no credits returns `402` with an x402 payment challenge instead
of failing outright — see SKILL.md §6.

## Perps (Hyperliquid)

| Method & path | Body / query | Notes |
|---|---|---|
| `GET /perps/markets` | — | No auth-gated fields; still send the bearer token. |
| `POST /perps/quote` | `{market, side: "long"\|"short", size, leverage}` | Returns entry price, margin, liquidation price, funding rate, fee. |
| `GET /perps/positions?address=` | — | Open positions for an address. |

## Predictions (Polymarket)

| Method & path | Query / body | Notes |
|---|---|---|
| `GET /predict/markets?query=&limit=` | — | Search/browse active markets. |
| `GET /predict/market/{id}` | — | Full detail incl. resolution status. |
| `GET /predict/market/{id}/book` | — | CLOB orderbook per outcome. |
| `GET /predict/market/{id}/price` | — | Mid price per outcome. |
| `GET /predict/market/{id}/trades?limit=` | — | Recent trades. |
| `POST /predict/order` | `{tokenId, price, size, side: "BUY"\|"SELL", expiration?, feeRateBps?}` | Places a CLOB limit order. `price` is `0 < price <= 1`. |
| `GET /predict/positions` | — | Your open positions. |
| `GET /predict/orders?status=` | — | Your order history. |

## Lending (Morpho)

| Method & path | Query | Notes |
|---|---|---|
| `GET /lend/markets?chainId=` | — | Optionally filter by chain id. |
| `GET /lend/market/{id}` | — | Full detail incl. oracle/IRM addresses. |

## Rate limits (per agent, sliding 1-minute window)

| Tier | Requests/min |
|---|---|
| free | 30 |
| agent | 100 |
| pro | 500 |
| premium | 2,000 |
| enterprise | 10,000 |

Headers on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`; on 429 also
`Retry-After` (seconds) and `X-RateLimit-Reset` (unix timestamp).

## Supported chains (EVM chain ids)

Ethereum (1), Optimism (10), BSC (56), Polygon (137), Arbitrum (42161), Base (8453), Avalanche
(43114) — plus Solana, Sui, and TON as non-EVM chain keys. Pass the chain **key** (e.g. `"base"`,
`"solana"`), not the numeric id, in request bodies; `GET /chains` is the source of truth.
