# Swap Execute (Managed Wallet)

Execute a quoted swap end-to-end using your agent's managed wallet. Suwappu signs and broadcasts the transaction — you only send a `quote_id`. This is the simplest path and requires no key handling on your side.

## POST /v1/agent/swap/execute

Requires authentication and a managed wallet (create one with [`POST /v1/agent/wallets`](wallets.md)).

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `quote_id` | string | Yes | A `quote_id` from [`POST /v1/agent/quote`](quote.md), issued within the last 60 seconds |

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "0x9f3c..."}'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/swap/execute", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ quote_id: "0x9f3c..." }),
});
const swap = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/swap/execute",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    json={"quote_id": "0x9f3c..."},
)
swap = res.json()
```

### Response

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

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `swap_id` | number | Identifier to poll via [`GET /v1/agent/swap/status/:swapId`](swap-status.md) |
| `status` | string | Initial swap status, e.g. `pending` |
| `tx_hash` | string \| null | Transaction hash once broadcast, otherwise `null` |
| `tracking.poll_url` | string | Status endpoint for this swap |
| `tracking.webhook_note` | string | Whether webhook notifications are configured |

### How it works

The wallet's private key lives in Turnkey's secure enclave. When you call this endpoint, Suwappu builds the transaction from your cached quote, signs it server-side with your managed wallet, and broadcasts it. The call is idempotent per `(agent, quote_id)`, so retrying the same `quote_id` will not double-submit.

### Errors

| Status | Cause |
|--------|-------|
| `400` | Missing/invalid body; no managed wallet found; or the quote is expired / not found / belongs to another agent |
| `401` | Missing or invalid API key |

If you would rather sign yourself, use [`POST /v1/agent/swap`](swap.md) to get an unsigned transaction. Track completion via [Swap Status](swap-status.md) or [Webhooks](webhooks.md).
