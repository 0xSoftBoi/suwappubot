# Rotate API Key

`POST /keys/rotate` | Auth: Required

Rotate your API key. The current key is immediately invalidated and a new key is returned. Store the new key securely -- it will not be shown again.

## Request

No body required. Authenticate with your current API key.

## Response

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the request succeeded |
| `api_key` | string | The new API key (prefixed with `suwappu_sk_`) |
| `message` | string | Confirmation message |

### Example Response

```json
{
  "success": true,
  "api_key": "suwappu_sk_new_8f3a1b9c4d2e7f6a",
  "message": "API key rotated. Old key is now invalid."
}
```

> **Warning:** Your old API key is immediately invalidated the moment this request succeeds. All subsequent requests must use the new key. Store it securely -- you will not be able to retrieve it again.

## Errors

| Status | Error | Cause |
|--------|-------|-------|
| 401 | `"Unauthorized"` | Missing or invalid API key |
| 500 | `"Key rotation failed"` | Internal error during key generation |

## Code Examples

### curl

```bash
curl -X POST https://api.suwappu.bot/v1/agent/keys/rotate \
  -H "Authorization: Bearer suwappu_sk_your_current_key"
```

### Python

```python
import requests

response = requests.post(
    "https://api.suwappu.bot/v1/agent/keys/rotate",
    headers={"Authorization": "Bearer suwappu_sk_your_current_key"},
)

data = response.json()
if data["success"]:
    new_key = data["api_key"]
    print(f"New key: {new_key}")
    # IMPORTANT: Update your stored key immediately
    # The old key no longer works
```

### TypeScript

```typescript
const response = await fetch(
  "https://api.suwappu.bot/v1/agent/keys/rotate",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer suwappu_sk_your_current_key",
    },
  }
);

const data = await response.json();
if (data.success) {
  const newKey = data.api_key;
  console.log(`New key: ${newKey}`);
  // IMPORTANT: Update your stored key immediately
  // The old key no longer works
}
```
