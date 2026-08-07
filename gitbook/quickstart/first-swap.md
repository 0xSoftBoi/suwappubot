# Your First Swap

A complete walkthrough that takes you from zero to a settled cross-chain swap using the real Suwappu agent endpoints. Every request below targets `https://api.suwappu.bot`.

## 1. Register your agent

Registration is public — no auth required. Pick a unique `name` (3–50 characters, alphanumeric plus `_` and `-`).

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-first-agent"}'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "my-first-agent" }),
});
const agent = await res.json();
```
```python
import requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/register",
    json={"name": "my-first-agent"},
)
agent = res.json()
```

**Response (`201`):**

```json
{
  "success": true,
  "message": "Welcome to Suwappu!",
  "agent": {
    "id": "a1b2c3d4-...",
    "name": "my-first-agent",
    "api_key": "suwappu_sk_xxxxxxxxxxxxxxxxxxxxxxxx",
    "created_at": "2026-06-18T12:00:00.000Z"
  },
  "important": "SAVE YOUR API KEY! It cannot be retrieved later."
}
```

Save `api_key` somewhere safe — it is shown only once and cannot be recovered. If you lose it, [rotate the key](../api-reference/keys.md).

## 2. Create a managed wallet (optional)

To let Suwappu sign and broadcast for you, create a managed (Turnkey) EVM wallet. Its address is stored against your agent and is the only address you can swap from.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer suwappu_sk_..."
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/wallets", {
  method: "POST",
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const wallet = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/wallets",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
)
wallet = res.json()
```

**Response (`201`):**

```json
{
  "success": true,
  "wallet": {
    "address": "0xAbC...123",
    "chain_type": "evm",
    "supported_chains": ["ethereum", "polygon", "arbitrum", "optimism", "base", "bsc"]
  },
  "message": "Wallet created. Fund it to start swapping."
}
```

Fund the address before swapping. If you prefer to sign transactions yourself, skip this step and use the [`POST /v1/agent/swap`](../api-reference/swap.md) flow instead.

## 3. Get a quote

Quotes are valid for 60 seconds. For a same-chain swap, pass `chain`; for a cross-chain swap, pass `from_chain` and `to_chain`.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "from_token": "ETH",
    "to_token": "USDC",
    "amount": "0.1",
    "chain": "base",
    "wallet_address": "0xAbC...123"
  }'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/quote", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from_token: "ETH",
    to_token: "USDC",
    amount: "0.1",
    chain: "base",
    wallet_address: "0xAbC...123",
  }),
});
const quote = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/quote",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    json={
        "from_token": "ETH",
        "to_token": "USDC",
        "amount": "0.1",
        "chain": "base",
        "wallet_address": "0xAbC...123",
    },
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
  "amount_in": "0.1",
  "amount_out": "324.118200",
  "amount_out_min": "320.876000",
  "exchange_rate": "3241.18",
  "price_impact": "0.02%",
  "estimated_gas_usd": "$0.04",
  "route": "Li.Fi",
  "slippage": "3.0%",
  "expires_in_seconds": 60,
  "dex": "Li.Fi"
}
```

If you passed `wallet_address`, the response also includes a `transaction` object with the unsigned calldata.

## 4. Simulate before execution

Simulation performs a zero-funds preflight against the cached quote and intended wallet. It never signs, broadcasts, or creates a managed swap record.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/simulate \
  -H "Authorization: Bearer suwappu_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"quote_id":"0x9f3c...","wallet_address":"0xAbC...123"}'
```

Inspect `would_execute`, `fees`, `checks`, `warnings`, and `min_output_after_slippage`. If `would_execute` is false, stop and resolve the failing/unverified check. Re-quote if the quote is near expiry.

## 5. Execute the swap

### Managed wallet (Suwappu signs)

If you created a managed wallet in step 2, hand the `quote_id` to `/swap/execute` and Suwappu signs and broadcasts.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer suwappu_sk_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: first-swap-001" \
  -d '{"quote_id": "0x9f3c..."}'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/swap/execute", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}`,
    "Content-Type": "application/json",
    "Idempotency-Key": "first-swap-001",
  },
  body: JSON.stringify({ quote_id: "0x9f3c..." }),
});
const swap = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/swap/execute",
    headers={
        "Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}",
        "Idempotency-Key": "first-swap-001",
    },
    json={"quote_id": "0x9f3c..."},
)
swap = res.json()
```

Persist that idempotency key with the intended trade. If the request times out or returns a network/5xx error, first check managed swap status/history; reuse the same key if a retry is actually needed. The [managed swap execution reference](../api-reference/swap-execute.md) documents the exact header format, fallback behavior, and reconciliation rule.

**Response:**

```json
{
  "success": true,
  "swap_id": 4812,
  "status": "pending",
  "tx_hash": null,
  "tracking": {
    "poll_url": "/v1/agent/swap/status/4812",
    "webhook_note": "Set callback_url via PATCH /v1/agent/me to receive webhook notifications"
  }
}
```

### Self-custody (you sign)

Alternatively, call [`POST /v1/agent/swap`](../api-reference/swap.md) with `quote_id` and your `wallet_address` to receive an unsigned transaction you sign and broadcast yourself.

## 6. Check the status

Poll with the `swap_id` returned above.

```bash
curl https://api.suwappu.bot/v1/agent/swap/status/4812 \
  -H "Authorization: Bearer suwappu_sk_..."
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/swap/status/4812", {
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const status = await res.json();
```
```python
import os, requests

res = requests.get(
    "https://api.suwappu.bot/v1/agent/swap/status/4812",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
)
status = res.json()
```

**Response:**

```json
{
  "success": true,
  "swap_id": 4812,
  "status": "completed",
  "tx_hash": "0xabc...def",
  "from_chain": "base",
  "to_chain": "base",
  "from_token": "ETH",
  "to_token": "USDC",
  "from_amount": "0.1",
  "to_amount": "324.12",
  "error_message": null,
  "created_at": "2026-06-18T12:00:10.000Z",
  "completed_at": "2026-06-18T12:00:28.000Z"
}
```

That's it — your agent just executed a cross-chain swap. To set up push notifications instead of polling, see [Webhooks](../api-reference/webhooks.md).
