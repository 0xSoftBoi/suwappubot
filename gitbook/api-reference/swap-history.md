# Swap History

`GET /swaps` | Auth: Required

Retrieve a paginated list of your past swaps. Optionally filter by status.

## Request

### Query Parameters

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `status` | string | No | -- | Filter by swap status: `"submitted"`, `"pending"`, `"completed"`, or `"failed"` |
| `limit` | integer | No | 20 | Number of results per page (max 100) |
| `offset` | integer | No | 0 | Number of results to skip for pagination |

### Example Request

```
GET /swaps?status=completed&limit=10&offset=0
```

## Response

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the request succeeded |
| `swaps` | array | List of swap objects |
| `pagination` | object | Pagination metadata |

### Swap Object

| Field | Type | Description |
|-------|------|-------------|
| `swap_id` | integer | Unique swap identifier |
| `status` | string | `"submitted"`, `"pending"`, `"completed"`, or `"failed"` |
| `tx_hash` | string \| null | Transaction hash |
| `from_token` | string | Source token symbol |
| `to_token` | string | Destination token symbol |

### Pagination Object

| Field | Type | Description |
|-------|------|-------------|
| `total` | integer | Total number of matching swaps |
| `limit` | integer | Current page size |
| `offset` | integer | Current offset |
| `has_more` | boolean | Whether more results exist beyond this page |

### Example Response

```json
{
  "success": true,
  "swaps": [
    {
      "swap_id": 4821,
      "status": "completed",
      "tx_hash": "0x8a3c...f29e",
      "from_token": "ETH",
      "to_token": "USDC"
    },
    {
      "swap_id": 4755,
      "status": "failed",
      "tx_hash": "0x91b7...a3c2",
      "from_token": "USDC",
      "to_token": "DAI"
    }
  ],
  "pagination": {
    "total": 42,
    "limit": 10,
    "offset": 0,
    "has_more": true
  }
}
```

## Errors

| Status | Error | Cause |
|--------|-------|-------|
| 400 | `"Invalid status filter"` | The `status` value is not one of the accepted statuses |
| 400 | `"limit must be between 1 and 100"` | The `limit` parameter is out of range |
| 401 | `"Unauthorized"` | Missing or invalid API key |

## Code Examples

### curl

```bash
curl "https://api.suwappu.bot/v1/agent/swaps?status=completed&limit=10&offset=0" \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

### Python

```python
import requests

response = requests.get(
    "https://api.suwappu.bot/v1/agent/swaps",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
    params={"status": "completed", "limit": 10, "offset": 0},
)

data = response.json()
if data["success"]:
    for swap in data["swaps"]:
        print(f"Swap {swap['swap_id']}: {swap['from_token']} → {swap['to_token']} ({swap['status']})")
    if data["pagination"]["has_more"]:
        print(f"More results available (total: {data['pagination']['total']})")
```

### TypeScript

```typescript
const params = new URLSearchParams({
  status: "completed",
  limit: "10",
  offset: "0",
});

const response = await fetch(
  `https://api.suwappu.bot/v1/agent/swaps?${params}`,
  {
    headers: {
      Authorization: "Bearer suwappu_sk_your_api_key",
    },
  }
);

const data = await response.json();
if (data.success) {
  for (const swap of data.swaps) {
    console.log(
      `Swap ${swap.swap_id}: ${swap.from_token} → ${swap.to_token} (${swap.status})`
    );
  }
  if (data.pagination.has_more) {
    console.log(`More results available (total: ${data.pagination.total})`);
  }
}
```
