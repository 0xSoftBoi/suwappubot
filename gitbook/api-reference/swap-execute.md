# Execute Swap

`POST /swap/execute` | Auth: Required

Execute a swap using your managed wallet. The server signs and submits the transaction on your behalf using the private key associated with your agent's managed wallet. You must have a managed wallet created via `POST /wallets` before calling this endpoint.

The `quote_id` parameter references a quote previously obtained from `POST /quote`. Quotes are short-lived; execute promptly to avoid expiration.

## Request

### Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `quote_id` | string | Yes | The quote ID returned from `POST /quote` |

### Example Request Body

```json
{
  "quote_id": "qt_a1b2c3d4e5f6"
}
```

## Response

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the request succeeded |
| `swap_id` | integer | Unique identifier for tracking this swap |
| `status` | string | Initial swap status: `"submitted"` or `"pending"` |
| `tx_hash` | string \| null | Transaction hash, or `null` if not yet broadcast |

### Example Response

```json
{
  "success": true,
  "swap_id": 4821,
  "status": "submitted",
  "tx_hash": "0x8a3c...f29e"
}
```

The server signs the transaction using your agent's managed wallet private key and submits it to the appropriate chain. The `tx_hash` may be `null` initially if the transaction has not yet been broadcast; poll `GET /swap/status/{swapId}` to track progress.

## Errors

| Status | Error | Cause |
|--------|-------|-------|
| 400 | `"quote_id is required"` | Missing `quote_id` in request body |
| 400 | `"Quote expired"` | The quote has passed its expiration window |
| 401 | `"Unauthorized"` | Missing or invalid API key |
| 404 | `"Quote not found"` | The `quote_id` does not match any existing quote |
| 404 | `"No managed wallet found"` | You have not created a managed wallet yet |
| 500 | `"Swap execution failed"` | Internal error during signing or submission |

## Code Examples

### curl

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "qt_a1b2c3d4e5f6"}'
```

### Python

```python
import requests

response = requests.post(
    "https://api.suwappu.bot/v1/agent/swap/execute",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
    json={"quote_id": "qt_a1b2c3d4e5f6"},
)

data = response.json()
if data["success"]:
    print(f"Swap {data['swap_id']} {data['status']}, tx: {data['tx_hash']}")
```

### TypeScript

```typescript
const response = await fetch(
  "https://api.suwappu.bot/v1/agent/swap/execute",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer suwappu_sk_your_api_key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ quote_id: "qt_a1b2c3d4e5f6" }),
  }
);

const data = await response.json();
if (data.success) {
  console.log(`Swap ${data.swap_id} ${data.status}, tx: ${data.tx_hash}`);
}
```
