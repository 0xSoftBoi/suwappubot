# Perpetual Futures

Trade perpetual futures on HyperLiquid through the Suwappu API. Supports 10 markets with up to 20x leverage.

## GET /v1/agent/perps/markets

List available perpetual futures markets.

```bash
curl https://api.suwappu.bot/v1/agent/perps/markets \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

**Response:**

```json
{
  "success": true,
  "markets": [
    {
      "symbol": "BTC-USD",
      "markPrice": "67234.50",
      "indexPrice": "67230.00",
      "fundingRate": "0.0001",
      "openInterest": "12500000",
      "volume24h": "890000000",
      "maxLeverage": 20
    },
    {
      "symbol": "ETH-USD",
      "markPrice": "3245.80",
      "indexPrice": "3245.20",
      "fundingRate": "0.00008",
      "openInterest": "5600000",
      "volume24h": "340000000",
      "maxLeverage": 20
    }
  ]
}
```

Available markets: `BTC-USD`, `ETH-USD`, `SOL-USD`, `ARB-USD`, `AVAX-USD`, `DOGE-USD`, `MATIC-USD`, `OP-USD`, `SUI-USD`, `APT-USD`.

## POST /v1/agent/perps/quote

Get a quote for opening a perpetual position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `market` | string | Yes | Market symbol (e.g., `"ETH-USD"`) |
| `side` | string | Yes | `"long"` or `"short"` |
| `size` | string | Yes | Position size in base asset units |
| `leverage` | number | Yes | Leverage multiplier (1-20) |

```bash
curl -X POST https://api.suwappu.bot/v1/agent/perps/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "market": "ETH-USD",
    "side": "long",
    "size": "0.5",
    "leverage": 10
  }'
```

**Response:**

```json
{
  "success": true,
  "quote": {
    "market": "ETH-USD",
    "side": "long",
    "size": "0.5",
    "leverage": 10,
    "entryPrice": "3245.80",
    "liquidationPrice": "2921.22",
    "margin": "162.29",
    "fee": "0.97",
    "fundingRate": "0.00008"
  }
}
```

## GET /v1/agent/perps/positions

List open perpetual positions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | string | No | Filter by wallet address |

```bash
curl https://api.suwappu.bot/v1/agent/perps/positions \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

**Response:**

```json
{
  "success": true,
  "positions": [
    {
      "market": "ETH-USD",
      "side": "long",
      "size": "0.5",
      "entryPrice": "3245.80",
      "markPrice": "3302.10",
      "pnl": "28.15",
      "pnlPercent": "17.33",
      "leverage": 10,
      "liquidationPrice": "2921.22",
      "margin": "162.29"
    }
  ]
}
```
