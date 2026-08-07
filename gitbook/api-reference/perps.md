# Perpetual Futures

Suwappu's **Agent API** exposes HyperLiquid market discovery, indicative position quotes, and address-based position reads. It does **not** currently expose an Agent API endpoint to open, close, or modify a perpetual position.

Use these endpoints for research, risk checks, dashboards, and strategy signals. If your product needs execution, keep that as a separate integration until an execution endpoint is explicitly documented here and in the OpenAPI contract.

## GET /v1/agent/perps/markets

List the supported HyperLiquid markets. This route is public.

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
      "markPrice": 3245.8,
      "fundingRate": 0
    }
  ]
}
```

The current service returns `fundingRate: 0` because live funding is not yet fetched on this path. Do not interpret that placeholder as a real zero-funding observation.

## POST /v1/agent/perps/quote

Get an **indicative** quote for a hypothetical position. This does not place an order.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market` | string | Yes | Market symbol, for example `"ETH-USD"` |
| `side` | string | Yes | `"long"` or `"short"` |
| `size` | number | Yes | Positive position size in base-asset units |
| `leverage` | number | Yes | Leverage multiplier from 1 through 20 |

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
  "fundingRate": 0,
  "fee": 0.32458
}
```

`entryPrice` is based on the market midpoint, `liquidationPrice` is an approximation, and `fundingRate` is currently a placeholder `0` (this quote path does not fetch live funding). The quote also does not model order-book depth or actual fill slippage. Treat it as a research estimate, not an executable fill guarantee.

## GET /v1/agent/perps/positions

Read the open HyperLiquid positions for a wallet. The `address` query parameter is required.

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
      "fundingRate": 0
    }
  ]
}
```

On the current positions path, `fundingRate` is also a placeholder `0`. `liquidationPrice` is returned as `0` when HyperLiquid reports no liquidation price; treat that as unavailable rather than a real zero-price liquidation level.

## No Agent API execution endpoint

There is intentionally no `/perps/order`, `/perps/open`, or `/perps/close` route in the current Agent API. The Telegram product has separate HyperLiquid trading code, but that does not make execution available to Agent API, SDK, MCP, or A2A callers.

See [Perpetual Futures Research](../guides/perps-trading.md) for a safe strategy-research pattern.
