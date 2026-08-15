# Swap Status

Look up the current status of a single swap by its ID. Poll this after [`POST /v1/agent/swap/execute`](swap-execute.md), or use [Webhooks](webhooks.md) to be notified instead.

## GET /v1/agent/swap/status/:swapId

Requires authentication. `:swapId` is the numeric `swap_id` returned by the execute endpoint. You can only read swaps belonging to your own agent.

```bash
curl https://api.suwappu.bot/v1/agent/swap/status/4812 \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
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

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `swap_id` | number | The swap's ID |
| `status` | string | Current status (e.g. `pending`, `completed`, `failed`) |
| `tx_hash` | string \| null | On-chain transaction hash once broadcast |
| `from_chain` / `to_chain` | string | Source and destination chains |
| `from_token` / `to_token` | string | Token symbols |
| `from_amount` / `to_amount` | string | Input and output amounts |
| `error_message` | string \| null | Failure reason when `status` is `failed` |
| `created_at` / `completed_at` | string \| null | Timestamps |

### Errors

| Status | Cause |
|--------|-------|
| `400` | `swapId` is not a valid integer, or the swap was not found for your agent |
| `401` | Missing or invalid API key |

For a list of all your swaps, see [Swap History](swap-history.md).
