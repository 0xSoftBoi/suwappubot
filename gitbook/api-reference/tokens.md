# List Tokens

`GET /tokens` | Auth: Required

List available tokens, optionally filtered by chain or symbol. Returns token contract addresses and decimals needed for building swap transactions.

## Request

### Parameters

Query string parameters:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chain` | string | No | Filter by chain key (e.g., `"base"`, `"solana"`, `"ethereum"`). Use values from `GET /chains`. |
| `search` | string | No | Filter by token symbol substring. Case-insensitive. |

### Example

```
GET /tokens?chain=base&search=USD
```

## Response

**Status: 200 OK**

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true`. |
| `chain` | string | The chain key that was queried. Present when `chain` parameter is provided. |
| `chain_id` | number | The numeric chain ID. Present when `chain` parameter is provided. |
| `tokens` | array | List of matching tokens. |
| `tokens[].symbol` | string | Token symbol (e.g., `"USDC"`). |
| `tokens[].address` | string | Contract address on the specified chain. Native tokens use the zero address. |
| `tokens[].decimals` | number | Number of decimal places for the token. |

### Example

```json
{
  "success": true,
  "chain": "base",
  "chain_id": 8453,
  "tokens": [
    {
      "symbol": "ETH",
      "address": "0x0000000000000000000000000000000000000000",
      "decimals": 18
    },
    {
      "symbol": "WETH",
      "address": "0x4200000000000000000000000000000000000006",
      "decimals": 18
    },
    {
      "symbol": "USDC",
      "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "decimals": 6
    },
    {
      "symbol": "DAI",
      "address": "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
      "decimals": 18
    }
  ]
}
```

## Errors

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `"Unknown chain 'xyz'"` | The provided chain key does not match any supported chain. Use `GET /chains` to see valid values. |
| 401 | `"Invalid or missing API key"` | The API key is missing, malformed, or revoked. |

## Code Examples

### curl

```bash
# List all tokens on Base
curl "https://api.suwappu.bot/v1/agent/tokens?chain=base" \
  -H "Authorization: Bearer suwappu_sk_your_api_key"

# Search for USDC across all chains
curl "https://api.suwappu.bot/v1/agent/tokens?search=USDC" \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

### Python

```python
import requests

response = requests.get(
    "https://api.suwappu.bot/v1/agent/tokens",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
    params={"chain": "base", "search": "USD"},
)

tokens = response.json()["tokens"]
for token in tokens:
    print(f"{token['symbol']} - {token['address']} ({token['decimals']} decimals)")
```

### TypeScript

```typescript
const params = new URLSearchParams({ chain: "base", search: "USD" });

const response = await fetch(
  `https://api.suwappu.bot/v1/agent/tokens?${params}`,
  {
    headers: { Authorization: "Bearer suwappu_sk_your_api_key" },
  }
);

const { tokens } = await response.json();
tokens.forEach((token) => {
  console.log(`${token.symbol} - ${token.address} (${token.decimals} decimals)`);
});
```
