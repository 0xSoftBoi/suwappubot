# Tokens

List the tokens Suwappu recognizes by symbol on each chain. Use it to resolve a symbol to its on-chain address and decimals before quoting.

## GET /v1/agent/tokens

Requires authentication.

### Query parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chain` | string | No | Chain key (e.g. `base`, `solana`). Omit to return tokens for all chains |
| `search` | string | No | Case-insensitive symbol substring filter (e.g. `USD`) |

### List tokens on one chain

```bash
curl "https://api.suwappu.bot/v1/agent/tokens?chain=base" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/tokens?chain=base", {
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const tokens = await res.json();
```
```python
import os, requests

res = requests.get(
    "https://api.suwappu.bot/v1/agent/tokens",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    params={"chain": "base"},
)
tokens = res.json()
```

**Response:**

```json
{
  "success": true,
  "chain": "Base",
  "chain_id": 8453,
  "tokens": [
    { "symbol": "ETH", "address": "0xEeee...EEeE", "decimals": 18 },
    { "symbol": "USDC", "address": "0x833589...2913", "decimals": 6 }
  ]
}
```

### List tokens across all chains

Omit `chain` to receive a grouped list:

```bash
curl "https://api.suwappu.bot/v1/agent/tokens?search=USDC" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/tokens?search=USDC", {
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const tokens = await res.json();
```
```python
import os, requests

res = requests.get(
    "https://api.suwappu.bot/v1/agent/tokens",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    params={"search": "USDC"},
)
tokens = res.json()
```

**Response:**

```json
{
  "success": true,
  "chains": [
    {
      "chain": "Ethereum",
      "chain_id": 1,
      "tokens": [{ "symbol": "USDC", "address": "0xA0b8...eB48", "decimals": 6 }]
    },
    {
      "chain": "Solana",
      "chain_id": "solana",
      "tokens": [{ "symbol": "USDC", "address": "EPjF...Dt1v", "decimals": 6 }]
    }
  ]
}
```

### Notes

- `chain_id` is numeric for EVM chains and the string `"solana"` for Solana.
- The symbols listed are the common, pre-resolved tokens. You can also pass any token address directly to [`POST /v1/agent/quote`](quote.md).

### Errors

| Status | Cause |
|--------|-------|
| `400` | Unknown `chain` value (the response lists supported chains) |
| `401` | Missing or invalid API key |
