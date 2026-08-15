# Chains

List every chain Suwappu can route through. This endpoint is public — use it to discover the chain `key` values you pass to the quote, swap, and token endpoints.

## GET /v1/agent/chains

Public — no `Authorization` header required.

```bash
curl https://api.suwappu.bot/v1/agent/chains
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/chains");
const chains = await res.json();
```
```python
import requests

res = requests.get("https://api.suwappu.bot/v1/agent/chains")
chains = res.json()
```

**Response:**

```json
{
  "success": true,
  "chains": [
    { "id": 1, "key": "ethereum", "name": "Ethereum", "native_token": "ETH", "type": "evm" },
    { "id": 8453, "key": "base", "name": "Base", "native_token": "ETH", "type": "evm" },
    { "id": 42161, "key": "arbitrum", "name": "Arbitrum", "native_token": "ETH", "type": "evm" },
    { "id": "solana", "key": "solana", "name": "Solana", "native_token": "SOL", "type": "solana" },
    { "id": "sui", "key": "sui", "name": "Sui", "native_token": "SUI", "type": "move" },
    { "id": "ton", "key": "ton", "name": "TON", "native_token": "TON", "type": "ton" }
  ],
  "note": "Use chain key (e.g., \"base\", \"solana\") in requests. Solana uses Jupiter, EVM chains use Li.Fi."
}
```

Suwappu supports 40+ chains across EVM, Solana, Sui, and TON. The list above is abridged — call the endpoint for the full, current set.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | number \| string | Chain ID. Numeric for EVM chains; a string key for Solana, Sui, and TON |
| `key` | string | The value to pass as `chain` / `from_chain` / `to_chain` in requests |
| `name` | string | Human-readable chain name |
| `native_token` | string | Symbol of the chain's gas token |
| `type` | string | `evm`, `solana`, `move`, or `ton` |

### Routing

Best-price routing races up to 9 aggregators — LiFi, CoW, OKX, 1inch, KyberSwap, Jupiter (Solana), Across, and CCTP — to find the best execution for each request. EVM routes are quoted via Li.Fi; Solana routes via Jupiter.

See [Tokens](tokens.md) to list the tradable tokens on a given chain.
