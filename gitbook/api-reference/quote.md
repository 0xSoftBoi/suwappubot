# Quote

Get a swap quote with pricing, route, and a `quote_id` you can hand to the swap endpoints. Quotes work for same-chain and cross-chain swaps across EVM chains (via Li.Fi) and Solana (via Jupiter), and are valid for 60 seconds.

## POST /v1/agent/quote

Requires authentication.

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from_token` | string | Yes | Source token symbol or address (e.g. `ETH`) |
| `to_token` | string | Yes | Destination token symbol or address (e.g. `USDC`) |
| `amount` | string | Yes | Human-readable input amount (e.g. `"0.5"`). Must be > 0 and ≤ 1,000,000 |
| `chain` | string | No | Chain key for a same-chain swap (e.g. `base`). Defaults to `ethereum` |
| `from_chain` | string | No | Source chain for a cross-chain swap |
| `to_chain` | string | No | Destination chain for a cross-chain swap |
| `wallet_address` | string | No | Your managed EVM wallet. When provided, the response includes executable `transaction` data |
| `slippage` | number | No | Slippage tolerance as a decimal (e.g. `0.03` = 3%), 0–0.5. Defaults to 3% |

### Same-chain (EVM)

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from_token": "ETH", "to_token": "USDC", "amount": "0.5", "chain": "base"}'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/quote", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ from_token: "ETH", to_token: "USDC", amount: "0.5", chain: "base" }),
});
const quote = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/quote",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    json={"from_token": "ETH", "to_token": "USDC", "amount": "0.5", "chain": "base"},
)
quote = res.json()
```

**Response:**

```json
{
  "success": true,
  "quote_id": "0x9f3c...",
  "from_chain": "Base",
  "from_chain_id": 8453,
  "to_chain": "Base",
  "to_chain_id": 8453,
  "chain_type": "evm",
  "from_token": { "symbol": "ETH", "address": "0xEee...", "decimals": 18 },
  "to_token": { "symbol": "USDC", "address": "0x833...", "decimals": 6 },
  "amount_in": "0.5",
  "amount_out": "1620.591000",
  "amount_out_min": "1572.973000",
  "exchange_rate": "3241.18",
  "price_impact": "0.03%",
  "estimated_gas_usd": "$0.04",
  "bridge_fee_usd": "$0.00",
  "route": "Li.Fi",
  "slippage": "3.0%",
  "estimated_time_seconds": 30,
  "expires_in_seconds": 60,
  "dex": "Li.Fi"
}
```

When `wallet_address` is provided, the response also includes a `transaction` object (`to`, `value`, `data`, `chain_id`, `gas_limit`) you can sign directly.

### Solana (via Jupiter)

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from_token": "SOL", "to_token": "USDC", "amount": "1", "chain": "solana"}'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/quote", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ from_token: "SOL", to_token: "USDC", amount: "1", chain: "solana" }),
});
const quote = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/quote",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    json={"from_token": "SOL", "to_token": "USDC", "amount": "1", "chain": "solana"},
)
quote = res.json()
```

Solana responses set `chain_type: "solana"`, `dex: "Jupiter"`, and include a `route` describing the AMM hops.

### Cross-chain

Pass `from_chain` and `to_chain` instead of `chain`:

```json
{
  "from_token": "USDC",
  "to_token": "ETH",
  "amount": "100",
  "from_chain": "arbitrum",
  "to_chain": "base"
}
```

### Notes

- The returned `quote_id` is required by [`POST /v1/agent/swap`](swap.md) and [`POST /v1/agent/swap/execute`](swap-execute.md).
- Quotes are bound to your agent and expire after 60 seconds.
- Starknet swaps are not handled here — they are processed by the bot backend and return `400` if requested.

### Errors

| Status | Cause |
|--------|-------|
| `400` | Invalid JSON, validation error, unknown chain, unknown token, or invalid amount |
| `401` | Missing or invalid API key |
