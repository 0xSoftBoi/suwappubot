# Get Prices

`GET /prices` | Auth: Required

Get current USD prices and 24-hour change for one or more token symbols.

## Request

### Parameters

Query string parameters:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `symbols` | string | Yes | Comma-separated list of token symbols. Max 20 symbols per request. Case-insensitive. Example: `"ETH,SOL,USDC"`. |

### Supported Symbols

`ETH`, `SOL`, `BNB`, `USDC`, `USDT`, `BTC`, `DAI`, `WBTC`, `ARB`, `OP`, `AVAX`, `MATIC`, `WETH`, `BONK`, `JUP`, `RAY`

### Example

```
GET /prices?symbols=ETH,SOL,USDC
```

## Response

**Status: 200 OK**

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true`. |
| `prices` | object | Map of symbol to price data. |
| `prices.<SYMBOL>.usd` | number | Current price in USD. |
| `prices.<SYMBOL>.change_24h` | number | Percentage change over the last 24 hours. Positive or negative. |
| `unknown_symbols` | array | Symbols from the request that were not recognized. Empty array if all symbols matched. |

### Example

```json
{
  "success": true,
  "prices": {
    "ETH": {
      "usd": 3500.42,
      "change_24h": 2.5
    },
    "SOL": {
      "usd": 145.80,
      "change_24h": -1.3
    },
    "USDC": {
      "usd": 1.0,
      "change_24h": 0.01
    }
  },
  "unknown_symbols": []
}
```

### Example with Unknown Symbols

```json
{
  "success": true,
  "prices": {
    "ETH": {
      "usd": 3500.42,
      "change_24h": 2.5
    }
  },
  "unknown_symbols": ["FAKECOIN"]
}
```

## Errors

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `"symbols parameter is required"` | The `symbols` query parameter is missing. |
| 400 | `"Too many symbols. Maximum 20 per request."` | More than 20 symbols were provided. |
| 401 | `"Invalid or missing API key"` | The API key is missing, malformed, or revoked. |

## Code Examples

### curl

```bash
curl "https://api.suwappu.bot/v1/agent/prices?symbols=ETH,SOL,USDC" \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

### Python

```python
import requests

response = requests.get(
    "https://api.suwappu.bot/v1/agent/prices",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
    params={"symbols": "ETH,SOL,USDC"},
)

data = response.json()
for symbol, price_data in data["prices"].items():
    print(f"{symbol}: ${price_data['usd']:.2f} ({price_data['change_24h']:+.1f}%)")
```

### TypeScript

```typescript
const response = await fetch(
  "https://api.suwappu.bot/v1/agent/prices?symbols=ETH,SOL,USDC",
  {
    headers: { Authorization: "Bearer suwappu_sk_your_api_key" },
  }
);

const { prices, unknown_symbols } = await response.json();

for (const [symbol, data] of Object.entries(prices)) {
  console.log(`${symbol}: $${data.usd} (${data.change_24h}%)`);
}

if (unknown_symbols.length > 0) {
  console.warn("Unknown symbols:", unknown_symbols);
}
```
