# Get Portfolio

`GET /portfolio` | Auth: Required

Get token balances and total USD value for a wallet address. Supports both EVM and Solana wallets.

## Request

### Parameters

Query string parameters:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wallet_address` | string | Yes | Wallet address. `0x`-prefixed hex for EVM chains, or base58-encoded for Solana. |
| `chain` | string | No | Filter to a specific chain key (e.g., `"base"`, `"solana"`). If omitted, returns balances across all supported chains. |

### Example

```
GET /portfolio?wallet_address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chain=ethereum
```

## Response

**Status: 200 OK**

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true`. |
| `wallet_address` | string | The queried wallet address. |
| `total_usd` | number | Total portfolio value in USD across all returned balances. |
| `balances` | array | List of token balances with non-zero amounts. |
| `balances[].symbol` | string | Token symbol. |
| `balances[].chain` | string | Chain key where this balance exists. |
| `balances[].balance` | string | Human-readable token balance (decimal string). |
| `balances[].usd_value` | number | Current USD value of this balance. |

### Example

```json
{
  "success": true,
  "wallet_address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "total_usd": 48250.75,
  "balances": [
    {
      "symbol": "ETH",
      "chain": "ethereum",
      "balance": "12.5",
      "usd_value": 43755.25
    },
    {
      "symbol": "USDC",
      "chain": "ethereum",
      "balance": "3200.00",
      "usd_value": 3200.00
    },
    {
      "symbol": "DAI",
      "chain": "ethereum",
      "balance": "1295.50",
      "usd_value": 1295.50
    }
  ]
}
```

### Solana Example

```
GET /portfolio?wallet_address=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU&chain=solana
```

```json
{
  "success": true,
  "wallet_address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "total_usd": 2180.40,
  "balances": [
    {
      "symbol": "SOL",
      "chain": "solana",
      "balance": "14.2",
      "usd_value": 2070.36
    },
    {
      "symbol": "USDC",
      "chain": "solana",
      "balance": "110.04",
      "usd_value": 110.04
    }
  ]
}
```

## Errors

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `"wallet_address is required"` | The `wallet_address` query parameter is missing. |
| 400 | `"Invalid wallet address format"` | The address is not a valid EVM or Solana address. |
| 400 | `"Unknown chain 'xyz'"` | The provided chain key does not match any supported chain. |
| 401 | `"Invalid or missing API key"` | The API key is missing, malformed, or revoked. |

## Code Examples

### curl

```bash
# EVM wallet on all chains
curl "https://api.suwappu.bot/v1/agent/portfolio?wallet_address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" \
  -H "Authorization: Bearer suwappu_sk_your_api_key"

# Solana wallet
curl "https://api.suwappu.bot/v1/agent/portfolio?wallet_address=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU&chain=solana" \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

### Python

```python
import requests

response = requests.get(
    "https://api.suwappu.bot/v1/agent/portfolio",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
    params={
        "wallet_address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        "chain": "ethereum",
    },
)

data = response.json()
print(f"Total value: ${data['total_usd']:.2f}")

for balance in data["balances"]:
    print(f"  {balance['symbol']}: {balance['balance']} (${balance['usd_value']:.2f})")
```

### TypeScript

```typescript
const params = new URLSearchParams({
  wallet_address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  chain: "ethereum",
});

const response = await fetch(
  `https://api.suwappu.bot/v1/agent/portfolio?${params}`,
  {
    headers: { Authorization: "Bearer suwappu_sk_your_api_key" },
  }
);

const { total_usd, balances } = await response.json();
console.log(`Total value: $${total_usd.toFixed(2)}`);

balances.forEach((b) => {
  console.log(`  ${b.symbol}: ${b.balance} ($${b.usd_value.toFixed(2)})`);
});
```
