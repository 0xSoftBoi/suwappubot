# Build Swap Transaction

`POST /swap` | Auth: Required

Build an unsigned swap transaction. The response contains raw transaction data that the caller must sign and submit to the blockchain. This endpoint does **not** execute the swap -- it only prepares the transaction.

> For server-side signing with managed wallets, use `POST /swap/execute` instead (not covered in this reference).

## Request

### Body

There are two usage modes:

**Mode 1: Using a quote** (recommended)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `quote_id` | string | Yes | Quote ID from `POST /quote`. Must not be expired (60s TTL). |
| `wallet_address` | string | Yes | Address that will sign and submit the transaction. |

**Mode 2: Direct swap (no quote)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wallet_address` | string | Yes | Address that will sign and submit the transaction. |
| `from_token` | string | Yes | Source token symbol. |
| `to_token` | string | Yes | Destination token symbol. |
| `amount` | string | Yes | Human-readable amount to swap. |
| `chain` | string | No | Chain key. Defaults to `"ethereum"`. |
| `slippage` | number | No | Max slippage as a decimal (0-1). Default: `0.03`. |

### Example (With Quote)

```json
{
  "quote_id": "qt_8f3a9b2c1d4e5f6a7b8c9d0e",
  "wallet_address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
}
```

### Example (Direct)

```json
{
  "wallet_address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "from_token": "ETH",
  "to_token": "USDC",
  "amount": "0.5",
  "chain": "base",
  "slippage": 0.01
}
```

## Response

**Status: 200 OK**

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true`. |
| `transaction.to` | string | Contract address to send the transaction to. |
| `transaction.data` | string | Hex-encoded calldata. |
| `transaction.value` | string | Native token value in wei (hex-encoded). `"0x0"` for ERC-20 to ERC-20 swaps. |
| `transaction.gas_estimate` | string | Estimated gas limit (hex-encoded). |
| `transaction.chain_id` | number | Chain ID for the transaction. |
| `meta.from_token` | string | Source token symbol. |
| `meta.to_token` | string | Destination token symbol. |
| `meta.amount_in` | string | Human-readable input amount. |
| `meta.expected_out` | string | Human-readable expected output amount. |
| `meta.min_out` | string | Minimum output after slippage. |

### Example

```json
{
  "success": true,
  "transaction": {
    "to": "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD",
    "data": "0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a0...",
    "value": "0x6f05b59d3b20000",
    "gas_estimate": "0x3d090",
    "chain_id": 8453
  },
  "meta": {
    "from_token": "ETH",
    "to_token": "USDC",
    "amount_in": "0.5",
    "expected_out": "1748.21",
    "min_out": "1730.73"
  }
}
```

> **Important:** The response contains an unsigned transaction. You must sign it with the private key of `wallet_address` and broadcast it to the chain yourself.

## Errors

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `"wallet_address is required"` | Missing required field. |
| 400 | `"Provide quote_id or (from_token, to_token, amount)"` | Neither a quote ID nor direct swap parameters were provided. |
| 400 | `"Quote has expired"` | The `quote_id` is older than 60 seconds. Request a new quote. |
| 400 | `"Invalid quote_id"` | The `quote_id` does not exist. |
| 400 | `"Insufficient liquidity for this trade"` | The swap cannot be completed at the requested size. |
| 400 | `"Unknown token 'XYZ' on chain 'base'"` | Token not supported on the specified chain. |
| 401 | `"Invalid or missing API key"` | The API key is missing, malformed, or revoked. |

## Code Examples

### curl

```bash
# Using a quote
curl -X POST https://api.suwappu.bot/v1/agent/swap \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "quote_id": "qt_8f3a9b2c1d4e5f6a7b8c9d0e",
    "wallet_address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
  }'
```

### Python

```python
import requests

# Step 1: Get a quote
quote_resp = requests.post(
    "https://api.suwappu.bot/v1/agent/quote",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
    json={
        "from_token": "ETH",
        "to_token": "USDC",
        "amount": "0.5",
        "chain": "base",
    },
)
quote = quote_resp.json()

# Step 2: Build the swap transaction
swap_resp = requests.post(
    "https://api.suwappu.bot/v1/agent/swap",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
    json={
        "quote_id": quote["quote_id"],
        "wallet_address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    },
)
swap = swap_resp.json()

tx = swap["transaction"]
print(f"Send tx to: {tx['to']}")
print(f"Value: {tx['value']}")
print(f"Expected out: {swap['meta']['expected_out']} USDC")

# Step 3: Sign and submit the transaction using your web3 library
# e.g., web3.eth.account.sign_transaction(tx, private_key)
```

### TypeScript

```typescript
// Step 1: Get a quote
const quoteResp = await fetch("https://api.suwappu.bot/v1/agent/quote", {
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
  }),
});
const quote = await quoteResp.json();

// Step 2: Build the swap transaction
const swapResp = await fetch("https://api.suwappu.bot/v1/agent/swap", {
  method: "POST",
  headers: {
    Authorization: "Bearer suwappu_sk_your_api_key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    quote_id: quote.quote_id,
    wallet_address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  }),
});
const swap = await swapResp.json();

console.log(`Send tx to: ${swap.transaction.to}`);
console.log(`Expected out: ${swap.meta.expected_out} USDC`);

// Step 3: Sign and submit using your wallet/signer
// e.g., await signer.sendTransaction(swap.transaction);
```
