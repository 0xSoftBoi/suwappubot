# Swap Status

`GET /swap/status/{swapId}` | Auth: Required

Retrieve the current status of a swap by its ID. Use this endpoint to poll for transaction completion after executing a swap via `POST /swap/execute`.

## Request

### Path Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `swapId` | integer | Yes | The swap ID returned from `POST /swap/execute` |

### Example Request

```
GET /swap/status/4821
```

## Response

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the request succeeded |
| `swap_id` | integer | The swap identifier |
| `status` | string | Current status: `"submitted"`, `"pending"`, `"completed"`, or `"failed"` |
| `tx_hash` | string \| null | Transaction hash, or `null` if not yet broadcast |
| `from_token` | string | Source token symbol (e.g., `"ETH"`) |
| `to_token` | string | Destination token symbol (e.g., `"USDC"`) |

### Status Lifecycle

```
submitted → pending → completed
                    → failed
```

- **submitted** -- The transaction has been signed and sent to the network.
- **pending** -- The transaction is waiting for on-chain confirmation.
- **completed** -- The swap executed successfully and is confirmed on-chain.
- **failed** -- The transaction reverted or could not be confirmed.

### Example Response

```json
{
  "success": true,
  "swap_id": 4821,
  "status": "completed",
  "tx_hash": "0x8a3c...f29e",
  "from_token": "ETH",
  "to_token": "USDC"
}
```

## Errors

| Status | Error | Cause |
|--------|-------|-------|
| 401 | `"Unauthorized"` | Missing or invalid API key |
| 404 | `"Swap not found"` | No swap exists with the given ID, or it belongs to a different agent |

## Code Examples

### curl

```bash
curl https://api.suwappu.bot/v1/agent/swap/status/4821 \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

### Python

```python
import requests

response = requests.get(
    "https://api.suwappu.bot/v1/agent/swap/status/4821",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
)

data = response.json()
if data["success"]:
    print(f"Swap {data['swap_id']}: {data['status']}")
    print(f"{data['from_token']} → {data['to_token']}, tx: {data['tx_hash']}")
```

### TypeScript

```typescript
const response = await fetch(
  "https://api.suwappu.bot/v1/agent/swap/status/4821",
  {
    headers: {
      Authorization: "Bearer suwappu_sk_your_api_key",
    },
  }
);

const data = await response.json();
if (data.success) {
  console.log(`Swap ${data.swap_id}: ${data.status}`);
  console.log(`${data.from_token} → ${data.to_token}, tx: ${data.tx_hash}`);
}
```
