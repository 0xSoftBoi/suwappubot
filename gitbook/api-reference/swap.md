# Swap (Unsigned Transaction)

Build an unsigned transaction from a quote so you can sign and broadcast it yourself. Use this for self-custody. If you want Suwappu to sign with your managed wallet instead, use [`POST /v1/agent/swap/execute`](swap-execute.md).

## POST /v1/agent/swap

Requires authentication.

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `quote_id` | string | Yes | A `quote_id` from [`POST /v1/agent/quote`](quote.md), issued within the last 60 seconds |
| `wallet_address` | string | Yes | The wallet that will sign. For EVM this must be your agent's managed wallet |

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "0x9f3c...", "wallet_address": "0xAbC...123"}'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/swap", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ quote_id: "0x9f3c...", wallet_address: "0xAbC...123" }),
});
const swap = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/swap",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    json={"quote_id": "0x9f3c...", "wallet_address": "0xAbC...123"},
)
swap = res.json()
```

### Response (EVM)

```json
{
  "success": true,
  "status": "ready",
  "message": "Transaction ready for signing",
  "quote_id": "0x9f3c...",
  "chain_type": "evm",
  "swap": {
    "from_chain": "base",
    "to_chain": "base",
    "from_token": "ETH",
    "to_token": "USDC",
    "amount_in": "500000000000000000",
    "expected_amount_out": "1620591000",
    "minimum_amount_out": "1572973000"
  },
  "transaction": {
    "to": "0x1111...",
    "from": "0xAbC...123",
    "value": "500000000000000000",
    "data": "0x...",
    "chain_id": 8453,
    "gas_limit": "210000",
    "gas_price": "..."
  },
  "instructions": [
    "1. Sign this transaction with your wallet",
    "2. Submit the signed transaction to the chain RPC",
    "3. Monitor the transaction hash for confirmation"
  ]
}
```

### Response (Solana)

For a Solana quote, the response returns a base64-encoded transaction to deserialize, sign, and submit:

```json
{
  "success": true,
  "status": "ready",
  "message": "Solana transaction ready for signing",
  "quote_id": "jupiter_...",
  "chain": "solana",
  "transaction": {
    "type": "solana",
    "serialized_transaction": "<base64>",
    "last_valid_block_height": 287654321
  }
}
```

### Notes

- Amounts in this response are in smallest units (wei / lamports), not human-readable decimals.
- The EVM transaction is built with `from: wallet_address`, so that address must be your agent's managed wallet — otherwise the request returns `403`.
- This endpoint does **not** broadcast. To have Suwappu sign and submit, use [`POST /v1/agent/swap/execute`](swap-execute.md).

### Errors

| Status | Cause |
|--------|-------|
| `400` | Missing/invalid body, `quote_id` missing, or the quote is expired / not found / belongs to another agent |
| `403` | `wallet_address` is not your managed wallet (EVM) |
| `401` | Missing or invalid API key |
