# Swap Execute (Managed Wallet)

Execute a quoted swap end-to-end using your agent's managed wallet. Suwappu signs and broadcasts the transaction — you only send a `quote_id`. This is the simplest path and requires no key handling on your side.

## POST /v1/agent/swap/execute

Requires authentication and a managed wallet (create one with [`POST /v1/agent/wallets`](wallets.md)).

For live automation, send an `Idempotency-Key` header. Use one durable key per economic intent and persist it before submission. Valid keys are 1–64 characters from `A-Z`, `a-z`, `0-9`, `_`, `.`, `:`, and `-`.

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `quote_id` | string | Yes | A `quote_id` from [`POST /v1/agent/quote`](quote.md), issued within the last 60 seconds |

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: rebalance-2026-08-06-001" \
  -d '{"quote_id": "0x9f3c..."}'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/swap/execute", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}`,
    "Content-Type": "application/json",
    "Idempotency-Key": "rebalance-2026-08-06-001",
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
        "Idempotency-Key": "rebalance-2026-08-06-001",
    },
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

The wallet's private key lives in Turnkey's secure enclave. When you call this endpoint, Suwappu builds the transaction from your cached quote, signs it server-side with your managed wallet, and broadcasts it.

Without a client header, Suwappu derives an idempotency key from the authenticated agent plus the `quote_id` (or approval ID). With `Idempotency-Key`, the client-supplied intent ID takes precedence and is bound to the trade's economic terms. That is the safer automation contract because a timed-out request may require a fresh quote while still representing the **same** intended trade.

On a timeout, network error, or HTTP 5xx, the on-chain outcome can be unknown. Reconcile status/history first and retry with the **same persisted `Idempotency-Key`**; do not mint a new key or blindly create a new economic intent.

### Errors

| Status | Cause |
|--------|-------|
| `400` | Missing/invalid body; no managed wallet found; or the quote is expired / not found / belongs to another agent |
| `401` | Missing or invalid API key |
| `5xx` | Server/upstream failure; execution outcome may be unknown — reconcile before retrying |

If you would rather sign yourself, use [`POST /v1/agent/swap`](swap.md) to get an unsigned transaction. Track completion via [Swap Status](swap-status.md) or [Webhooks](webhooks.md).
