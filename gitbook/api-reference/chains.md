# List Chains

`GET /chains` | Auth: None

List all supported blockchain networks. This endpoint is public and does not require authentication.

## Request

No parameters required.

## Response

**Status: 200 OK**

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true`. |
| `chains` | array | List of supported chains. |
| `chains[].id` | number | Numeric chain ID (EVM chain ID, or internal ID for non-EVM chains). |
| `chains[].key` | string | Short lowercase identifier used in other endpoints (e.g., `"base"`, `"solana"`). |
| `chains[].name` | string | Human-readable chain name. |
| `chains[].native_token` | string | Symbol of the chain's native gas token. |
| `chains[].type` | string | Chain type: `"evm"` or `"solana"`. |

### Example

```json
{
  "success": true,
  "chains": [
    {
      "id": 1,
      "key": "ethereum",
      "name": "Ethereum",
      "native_token": "ETH",
      "type": "evm"
    },
    {
      "id": 10,
      "key": "optimism",
      "name": "Optimism",
      "native_token": "ETH",
      "type": "evm"
    },
    {
      "id": 56,
      "key": "bsc",
      "name": "BNB Smart Chain",
      "native_token": "BNB",
      "type": "evm"
    },
    {
      "id": 137,
      "key": "polygon",
      "name": "Polygon",
      "native_token": "MATIC",
      "type": "evm"
    },
    {
      "id": 42161,
      "key": "arbitrum",
      "name": "Arbitrum One",
      "native_token": "ETH",
      "type": "evm"
    },
    {
      "id": 8453,
      "key": "base",
      "name": "Base",
      "native_token": "ETH",
      "type": "evm"
    },
    {
      "id": 43114,
      "key": "avalanche",
      "name": "Avalanche C-Chain",
      "native_token": "AVAX",
      "type": "evm"
    },
    {
      "id": 900,
      "key": "solana",
      "name": "Solana",
      "native_token": "SOL",
      "type": "solana"
    }
  ]
}
```

## Errors

This endpoint has no endpoint-specific errors. Standard server errors (500) may still occur.

## Code Examples

### curl

```bash
curl https://api.suwappu.bot/v1/agent/chains
```

### Python

```python
import requests

response = requests.get("https://api.suwappu.bot/v1/agent/chains")

chains = response.json()["chains"]
for chain in chains:
    print(f"{chain['name']} ({chain['key']}) - {chain['type']}")
```

### TypeScript

```typescript
const response = await fetch("https://api.suwappu.bot/v1/agent/chains");
const { chains } = await response.json();

chains.forEach((chain) => {
  console.log(`${chain.name} (${chain.key}) - ${chain.type}`);
});
```
