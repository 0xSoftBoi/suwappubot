# Swap History

List your agent's past swaps with pagination and optional status filtering. Returns swaps newest-first.

## GET /v1/agent/swaps

Requires authentication. Returns only swaps belonging to your own agent.

### Query parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | No | Filter by status (e.g. `completed`, `pending`, `failed`) |
| `limit` | number | No | Page size, 1–100. Defaults to 20 |
| `offset` | number | No | Number of records to skip. Defaults to 0 |

```bash
curl "https://api.suwappu.bot/v1/agent/swaps?status=completed&limit=10" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/swaps?status=completed&limit=10", {
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const history = await res.json();
```
```python
import os, requests

res = requests.get(
    "https://api.suwappu.bot/v1/agent/swaps",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    params={"status": "completed", "limit": 10},
)
history = res.json()
```

**Response:**

```json
{
  "success": true,
  "swaps": [
    {
      "swap_id": 4812,
      "status": "completed",
      "tx_hash": "0xabc...def",
      "from_chain": "base",
      "to_chain": "base",
      "from_token": "ETH",
      "to_token": "USDC",
      "from_amount": "0.1",
      "to_amount": "324.12",
      "created_at": "2026-06-18T12:00:10.000Z",
      "completed_at": "2026-06-18T12:00:28.000Z"
    }
  ],
  "pagination": {
    "total": 17,
    "limit": 10,
    "offset": 0,
    "has_more": true
  }
}
```

### Pagination

| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Total swaps matching the filter |
| `limit` | number | Page size used |
| `offset` | number | Offset used |
| `has_more` | boolean | Whether more records exist beyond this page |

Increase `offset` by `limit` to walk through pages.

### Errors

| Status | Cause |
|--------|-------|
| `401` | Missing or invalid API key |

For a single swap, see [Swap Status](swap-status.md).
