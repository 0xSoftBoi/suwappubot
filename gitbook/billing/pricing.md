# Pricing

Suwappu combines three independent pricing dimensions: a **rate-limit tier** (requests/minute), **per-call metering** (credits, if you're on the free tier and metering is enabled), and a **swap execution fee** (bps on the traded amount). This page is the reference table for all three; see [Agentic Payments](agentic-payments.md) for how to pay.

## Rate-limit tiers

Requests are limited per agent over a rolling 60-second window, keyed by `rate_limit_tier`:

| Tier | Requests / minute | How to get it |
|------|-------------------|----------------|
| `free` | 30 | Default for every new agent |
| `agent` | 100 | Bypasses per-call metering; not self-serve purchasable via `/billing/subscribe` |
| `pro` | 500 | `POST /v1/agent/billing/subscribe` with `tier: "pro"`, or Stripe checkout |
| `premium` | 2,000 | `POST /v1/agent/billing/subscribe` with `tier: "premium"`, or Stripe checkout |
| `enterprise` | 10,000 | `POST /v1/agent/billing/subscribe` with `tier: "enterprise"`, or Stripe checkout |

These are the current source limits. Check your live tier via [`GET /v1/agent/me`](../api-reference/agent-profile.md) or `GET /v1/agent/billing`, and honor the response rate-limit headers rather than hardcoding a client delay.

## Subscription prices (30-day prepaid window)

| Tier | Price (USD, 30 days) |
|------|----------------------|
| `pro` | $9.99 |
| `premium` | $29.99 |
| `enterprise` | $99.99 |

Pay with USDC on Base (`POST /v1/agent/billing/subscribe`) or Stripe (`GET /billing/stripe/checkout?tier=`). These are **prepaid windows, not auto-renewing subscriptions** by default — re-pay before expiry to extend (time stacks). For true recurring billing, register a Base Spend Permission via `POST /v1/agent/billing/recurring`. All three tiers bypass per-call metering entirely for the duration of the window.

## Per-call credit costs

Only applies to the `free` tier when server-side metering is enabled (`AGENT_METERING_ENABLED=true`). 1 credit ≈ **$0.001 USD**. `agent`/`pro`/`premium`/`enterprise` never pay per call.

### REST (`/v1/agent/*`)

| Endpoint | Credits |
|----------|---------|
| `POST /quote` | 1 |
| `POST /swap/simulate` | 1 |
| `POST /swap` | 5 |
| `POST /execute` | 5 |
| `POST /swap/execute` | 5 |
| `GET /portfolio` | 1 |
| `GET /prices` | 1 |
| `GET /tokens` | 0 (free) |
| `GET /chains` | Public; not metered |
| Everything else (profile, wallets, webhooks, keys, billing) | Not metered |

### MCP (`POST /mcp`, `tools/call`)

| Tool | Credits |
|------|---------|
| `list_chains` | 0 (free) |
| `list_tokens` | 0 (free) |
| `get_tempo_tokens` | 0 (free) |
| `browse_mpp_directory` | 0 (free) |
| `get_quote` | 1 |
| `get_portfolio` | 1 |
| `get_prices` | 1 |
| `predict_markets` | 1 |
| `predict_market` / `predict_market_detail` | 1 |
| `perps_markets` | 1 |
| `perps_quote` | 1 |
| `perps_positions` | 1 |
| `lend_markets` | 1 |
| `lend_market` | 1 |
| `simulate_swap` | 1 |
| `execute_swap` | 5 |
| `get_swap_status` | 1 |
| `get_swap_history` | 1 |
| `predict_book` | 1 |
| `predict_price` | 1 |
| `predict_trades` | 1 |
| `list_wallet_policies` | 1 |

A 402 response tells you exactly which tool/endpoint triggered the charge and its cost — see [Agentic Payments](agentic-payments.md#the-402-challenge).

## Swap execution fees

Agent-surface swap fees are route/configuration-specific, not derived from the API subscription tier. The current source defaults are **0.8% on EVM routes** (Li.Fi integrator fee) and **0.3% / 30 bps on Solana routes** (Jupiter platform fee). Deployment configuration can change these values, so use the live quote as the economic source of truth instead of hardcoding either number. The routed output already reflects the applicable platform fee.

`POST /v1/agent/perps/quote` includes an indicative HyperLiquid fee estimate, but the current Agent API does **not** expose a perps open/close execution endpoint. Do not model that quote as a Suwappu-executed fill.

## Checking your own numbers live

Cost weights and tier prices can change between deploys — always read them from the API rather than hardcoding this table in production code:

```bash
curl https://api.suwappu.bot/v1/agent/billing \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

Returns `cost_weights` (REST), `credit_usd_value`, `bypass_tiers`, your live `credits.balance`, and `subscribe.tier_prices_usd`.
