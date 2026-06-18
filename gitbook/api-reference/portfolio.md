# Portfolio

Fetch live token balances and total USD value for a wallet. You can only read your own agent's managed wallet — requests for any other address are rejected.

## GET /v1/agent/portfolio

Requires authentication.

### Query parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `wallet_address` | string | Yes | Your managed wallet address. Must match the wallet bound to your agent |
| `chain` | string | No | Filter balances to a single chain (e.g. `base`). Omit for all chains |

```bash
curl "https://api.suwappu.bot/v1/agent/portfolio?wallet_address=0xAbC...123" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/portfolio?wallet_address=0xAbC...123", {
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const portfolio = await res.json();
```
```python
import os, requests

res = requests.get(
    "https://api.suwappu.bot/v1/agent/portfolio",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    params={"wallet_address": "0xAbC...123"},
)
portfolio = res.json()
```

**Response:**

```json
{
  "success": true,
  "wallet_address": "0xAbC...123",
  "wallet_type": "evm",
  "chain_filter": "all",
  "total_usd": "1284.55",
  "balances": [
    {
      "symbol": "ETH",
      "name": "Ethereum",
      "chain": "base",
      "balance": "0.312",
      "usd_value": "1011.45"
    },
    {
      "symbol": "USDC",
      "name": "USD Coin",
      "chain": "base",
      "balance": "273.10",
      "usd_value": "273.10"
    }
  ]
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `wallet_type` | string | `evm` or `solana`, inferred from the address (and `chain` if given) |
| `chain_filter` | string | The chain you filtered on, or `all` |
| `total_usd` | string | Sum of all returned balances' USD value |
| `balances[]` | array | Per-token holdings with `symbol`, `name`, `chain`, `balance`, and `usd_value` |

### Errors

| Status | Cause |
|--------|-------|
| `400` | Missing `wallet_address` query parameter |
| `403` | `wallet_address` is not your agent's managed wallet |
| `401` | Missing or invalid API key |

Create a managed wallet first with [`POST /v1/agent/wallets`](wallets.md).
