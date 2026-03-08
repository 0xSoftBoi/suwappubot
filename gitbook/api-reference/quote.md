# Get Quote

`POST /quote` | Auth: Required

Get a swap quote with estimated output amount and exchange rate. The returned `quote_id` can be passed to `POST /swap` to execute the trade without re-specifying parameters.

## Request

### Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from_token` | string | Yes | Source token symbol (e.g., `"ETH"`, `"USDC"`). |
| `to_token` | string | Yes | Destination token symbol (e.g., `"USDC"`, `"DAI"`). |
| `amount` | string | Yes | Human-readable amount to swap (e.g., `"0.5"`, `"1000"`). Not in smallest units. |
| `chain` | string | No | Chain key for same-chain swaps. Defaults to `"ethereum"`. |
| `from_chain` | string | No | Source chain for cross-chain swaps. Overrides `chain` for the source side. |
| `to_chain` | string | No | Destination chain for cross-chain swaps. Overrides `chain` for the destination side. |
| `wallet_address` | string | No | Wallet address to tailor the quote (e.g., for gas estimation). |
| `slippage` | number | No | Maximum acceptable slippage as a decimal between 0 and 1. Default: `0.03` (3%). |

> For same-chain swaps, use `chain`. For cross-chain swaps, use `from_chain` and `to_chain` instead.

### Example (Same-Chain)

```json
{
  "from_token": "ETH",
  "to_token": "USDC",
  "amount": "0.5",
  "chain": "base",
  "slippage": 0.01
}
```

### Example (Cross-Chain)

```json
{
  "from_token": "ETH",
  "to_token": "USDC",
  "amount": "1.0",
  "from_chain": "ethereum",
  "to_chain": "base",
  "wallet_address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
}
```

## Response

**Status: 200 OK**

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true`. |
| `quote_id` | string | Unique quote identifier. Valid for 60 seconds. Pass to `POST /swap` to execute. |
| `from_token.symbol` | string | Source token symbol. |
| `from_token.chain` | string | Source chain key. |
| `from_token.address` | string | Source token contract address. |
| `to_token.symbol` | string | Destination token symbol. |
| `to_token.chain` | string | Destination chain key. |
| `to_token.address` | string | Destination token contract address. |
| `amount_in` | string | Amount of source token to be swapped (human-readable). |
| `amount_out` | string | Estimated amount of destination token to be received (human-readable). |
| `exchange_rate` | string | Rate of `to_token` per `from_token`. |
| `expires_in_seconds` | number | Seconds until this quote expires. Always `60`. |

### Example

```json
{
  "success": true,
  "quote_id": "qt_8f3a9b2c1d4e5f6a7b8c9d0e",
  "from_token": {
    "symbol": "ETH",
    "chain": "base",
    "address": "0x0000000000000000000000000000000000000000"
  },
  "to_token": {
    "symbol": "USDC",
    "chain": "base",
    "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  },
  "amount_in": "0.5",
  "amount_out": "1748.21",
  "exchange_rate": "3496.42",
  "expires_in_seconds": 60
}
```

> **Note:** The `quote_id` is valid for 60 seconds. After expiry, you must request a new quote.

## Errors

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `"from_token is required"` | Missing required field. |
| 400 | `"Unknown token 'XYZ' on chain 'base'"` | The specified token is not available on the given chain. |
| 400 | `"Unknown chain 'xyz'"` | The specified chain is not supported. |
| 400 | `"Amount must be a positive number"` | The `amount` value is not a valid positive number. |
| 400 | `"Slippage must be between 0 and 1"` | The `slippage` value is out of range. |
| 400 | `"Cross-chain route not available"` | No route exists between the specified chains for these tokens. |
| 401 | `"Invalid or missing API key"` | The API key is missing, malformed, or revoked. |

## Code Examples

### curl

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "from_token": "ETH",
    "to_token": "USDC",
    "amount": "0.5",
    "chain": "base",
    "slippage": 0.01
  }'
```

### Python

```python
import requests

response = requests.post(
    "https://api.suwappu.bot/v1/agent/quote",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
    json={
        "from_token": "ETH",
        "to_token": "USDC",
        "amount": "0.5",
        "chain": "base",
        "slippage": 0.01,
    },
)

data = response.json()
print(f"Quote ID: {data['quote_id']}")
print(f"Rate: 1 {data['from_token']['symbol']} = {data['exchange_rate']} {data['to_token']['symbol']}")
print(f"You receive: {data['amount_out']} {data['to_token']['symbol']}")
print(f"Expires in: {data['expires_in_seconds']}s")
```

### TypeScript

```typescript
const response = await fetch("https://api.suwappu.bot/v1/agent/quote", {
  method: "POST",
  headers: {
    Authorization: "Bearer suwappu_sk_your_api_key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from_token: "ETH",
    to_token: "USDC",
    amount: "0.5",
    chain: "base",
    slippage: 0.01,
  }),
});

const data = await response.json();
console.log(`Quote ID: ${data.quote_id}`);
console.log(`You receive: ${data.amount_out} ${data.to_token.symbol}`);
console.log(`Expires in: ${data.expires_in_seconds}s`);
```
