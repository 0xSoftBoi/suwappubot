# Prices

Fetch current USD prices and 24-hour change for token symbols. Prices are cached for 60 seconds and sourced from CoinGecko.

## GET /v1/agent/prices

Requires authentication.

### Query parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `symbols` | string | Yes | 1–20 comma-separated token symbols (e.g. `ETH,SOL,USDC`) |

```bash
curl "https://api.suwappu.bot/v1/agent/prices?symbols=ETH,SOL,USDC" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/prices?symbols=ETH,SOL,USDC", {
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const prices = await res.json();
```
```python
import os, requests

res = requests.get(
    "https://api.suwappu.bot/v1/agent/prices",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    params={"symbols": "ETH,SOL,USDC"},
)
prices = res.json()
```

**Response:**

```json
{
  "success": true,
  "prices": {
    "ETH": { "usd": 3241.18, "change_24h": 1.92 },
    "SOL": { "usd": 168.40, "change_24h": -0.74 },
    "USDC": { "usd": 1.0, "change_24h": 0.01 }
  }
}
```

If any requested symbol isn't recognized, the response includes an `unknown_symbols` array:

```json
{
  "success": true,
  "prices": { "ETH": { "usd": 3241.18, "change_24h": 1.92 } },
  "unknown_symbols": ["FOO"]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `prices` | object | Map of uppercased symbol to a price object |
| `prices[SYM].usd` | number | Current USD price |
| `prices[SYM].change_24h` | number \| null | 24-hour percentage change, or `null` if unavailable |
| `unknown_symbols` | string[] | Requested symbols with no known price mapping (omitted when empty) |

### Supported symbols

Common majors are mapped, including `ETH`, `SOL`, `BNB`, `USDC`, `USDT`, `BTC`, `DAI`, `WBTC`, `ARB`, `OP`, `AVAX`, `MATIC`, `WETH`, `BONK`, `JUP`, and `RAY`. Calling the endpoint without `symbols` returns the full supported list in the error response.

### Errors

| Status | Cause |
|--------|-------|
| `400` | `symbols` missing, empty, or more than 20 symbols provided |
| `401` | Missing or invalid API key |
