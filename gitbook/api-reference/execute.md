# Execute (Natural Language)

Send a plain-English command and let Suwappu parse it into an action. The endpoint understands swap, quote/price, and balance/portfolio commands, and returns a structured result you can act on.

## POST /v1/agent/execute

Requires authentication.

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | Yes | The natural-language instruction, up to 500 chars |
| `wallet_address` | string | No | Your managed EVM wallet. When provided, swap commands return executable `transaction` data |

```bash
curl -X POST https://api.suwappu.bot/v1/agent/execute \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"command": "swap 0.5 ETH to USDC on base", "wallet_address": "0xAbC...123"}'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/execute", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ command: "swap 0.5 ETH to USDC on base", wallet_address: "0xAbC...123" }),
});
const result = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/execute",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    json={"command": "swap 0.5 ETH to USDC on base", "wallet_address": "0xAbC...123"},
)
result = res.json()
```

### Response (swap command)

```json
{
  "success": true,
  "action": "swap",
  "status": "quoted",
  "message": "Quote ready: 0.5 ETH -> 1620.591000 USDC on Base",
  "quote_id": "0x9f3c...",
  "from_token": "ETH",
  "to_token": "USDC",
  "amount_in": "0.5",
  "amount_out": "1620.591000",
  "chain": "Base",
  "chain_id": 8453,
  "exchange_rate": "3241.18",
  "gas_usd": "0.04",
  "route": "Li.Fi",
  "has_transaction": true,
  "transaction": {
    "to": "0x1111...",
    "value": "500000000000000000",
    "data": "0x...",
    "chain_id": 8453
  },
  "next_step": "Sign and submit the transaction to execute the swap"
}
```

A swap command produces a quote (and a `transaction` when `wallet_address` is supplied). Sign and submit it yourself, or take the `quote_id` to [`POST /v1/agent/swap/execute`](swap-execute.md) for managed execution.

### Supported commands

| Pattern | Example | Result |
|---------|---------|--------|
| `swap <amount> <token> to <token> on <chain>` | `swap 0.5 ETH to USDC on base` | Returns a quote (and tx if `wallet_address` given) |
| `quote <amount> <token> to <token>` | `quote 1 ETH to USDC` | Parses intent; points to `/v1/agent/quote` for full pricing |
| `check balance` / mentions `portfolio` | `check my balance` | Points to `/v1/agent/portfolio` |

An unrecognized command returns `action: "unknown"` with the list of supported commands and examples.

### Notes

- If `wallet_address` is provided it must be your agent's own managed wallet, or the request returns `403`.
- The `chain` defaults to `ethereum` when not specified in the command.
- For precise, structured swaps, prefer [`POST /v1/agent/quote`](quote.md) over natural language.

### Errors

| Status | Cause |
|--------|-------|
| `400` | Invalid JSON, empty/oversized command, or unparseable swap format |
| `403` | `wallet_address` is not your managed wallet |
| `401` | Missing or invalid API key |
