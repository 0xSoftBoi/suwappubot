# Perpetual Futures

Suwappu's **Agent API** exposes supported Hyperliquid market discovery, indicative position quotes, and address-based position reads. It does **not** currently expose an Agent API endpoint to open, close, or modify a perpetual position.

Use these endpoints for research, risk checks, dashboards, and strategy signals. If your product needs execution, keep that as a separate integration until an execution endpoint is explicitly documented here and in the OpenAPI contract.

## GET /v1/agent/perps/markets

List the supported Hyperliquid markets. This route is public.

```bash
curl https://api.suwappu.bot/v1/agent/perps/markets
```

**Response shape:**

```json
{
  "markets": [
    {
      "name": "ETH-USD",
      "asset": "ETH",
      "szDecimals": 4,
      "maxLeverage": 20,
      "venueMaxLeverage": 25,
      "markPrice": 3246.8,
      "fundingRate": 0.000125
    }
  ]
}
```

Field semantics:

| Field | Meaning |
|---|---|
| `maxLeverage` | Maximum accepted by the current Suwappu quote route for this market; never above the current 20x Suwappu ceiling |
| `venueMaxLeverage` | Raw `maxLeverage` reported by Hyperliquid for the venue market |
| `markPrice` | Current Hyperliquid `markPx` |
| `fundingRate` | Current raw Hyperliquid market `funding` rate |

The mark/funding values come from Hyperliquid's `metaAndAssetCtxs` market snapshot. Suwappu fails the request if a returned supported market has malformed required mark/funding data rather than silently converting missing data to zero.

## POST /v1/agent/perps/quote

Get an **indicative** quote for a hypothetical position. This does not place an order.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market` | string | Yes | Market `name` returned by `GET /v1/agent/perps/markets`, for example `"ETH-USD"` |
| `side` | string | Yes | `"long"` or `"short"` |
| `size` | number | Yes | Positive position size in base-asset units |
| `leverage` | number | Yes | Leverage from 1 through that market's returned `maxLeverage` |

```bash
curl -X POST https://api.suwappu.bot/v1/agent/perps/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "market": "ETH-USD",
    "side": "long",
    "size": 0.5,
    "leverage": 10
  }'
```

**Response shape:**

```json
{
  "market": "ETH-USD",
  "side": "long",
  "size": 0.5,
  "leverage": 10,
  "entryPrice": 3245.8,
  "margin": 162.29,
  "liquidationPrice": 2953.678,
  "fundingRate": 0.000125,
  "fee": 0.32458
}
```

`entryPrice` uses Hyperliquid's current `midPx` when available and falls back to the mark price. `liquidationPrice` is an approximation. `fundingRate` is the current raw market funding rate, not a forecast of the position's funding P&L. The quote does not model order-book depth, actual fill slippage, or a guaranteed fill.

## GET /v1/agent/perps/positions

Read open Hyperliquid positions for a wallet. The `address` query parameter is required.

This Agent API route accepts a `suwappu_sk_*` agent Bearer key. Suwappu's first-party terminal can also reach the same route with its user-session authentication. The hosted MCP `perps_positions` tool has a narrower ownership contract: the requested EVM address must be the authenticated agent's managed wallet.

```bash
curl "https://api.suwappu.bot/v1/agent/perps/positions?address=0xYOUR_HYPERLIQUID_ADDRESS" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

**Response shape:**

```json
{
  "positions": [
    {
      "id": "ETH-0",
      "market": "ETH-USD",
      "side": "long",
      "size": 0.5,
      "leverage": 10,
      "entryPrice": 3245.8,
      "markPrice": 3302.1,
      "margin": 162.29,
      "unrealizedPnl": 28.15,
      "liquidationPrice": 2921.22,
      "fundingRate": 0.000125
    }
  ]
}
```

`fundingRate` is the current raw market rate for the position's asset; it is not the position's accrued funding P&L. `liquidationPrice` is returned as `0` when Hyperliquid reports no liquidation price; treat zero as unavailable rather than a real zero-price liquidation level.

The position state and market funding context come from separate Hyperliquid reads. Do not treat the combined position object as an atomic exchange snapshot.

## No Agent API execution endpoint

There is intentionally no `/perps/order`, `/perps/open`, or `/perps/close` route in the current Agent API. The Telegram product has separate Hyperliquid trading code, but that does not make execution available to Agent API, SDK, MCP, or A2A callers.

See [Build a Standalone Perps Risk Monitor](../guides/perps-trading.md) for restart-safe alert state, operating economics, and the direct-Hyperliquid boundary.
