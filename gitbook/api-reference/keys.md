# API Key Rotation

Rotate your agent's API key. The old key is invalidated immediately and a new one is returned exactly once. Use this if a key is leaked or on a regular rotation schedule.

## POST /v1/agent/keys/rotate

Requires authentication with your current (still valid) key.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/keys/rotate \
  -H "Authorization: Bearer suwappu_sk_OLD_KEY"
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/keys/rotate", {
  method: "POST",
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const rotated = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/keys/rotate",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
)
rotated = res.json()
```

**Response:**

```json
{
  "success": true,
  "api_key": "suwappu_sk_NEW_KEY",
  "message": "API key rotated. Save this key — the old key is now invalid."
}
```

### Important

- The **old key stops working immediately**. Update every client before making the next request.
- The new key is shown **only once** — Suwappu stores only a hash and cannot return it again.
- Your agent's identity, managed wallet, and history are unchanged; only the key changes.

### Errors

| Status | Cause |
|--------|-------|
| `401` | Missing or invalid (e.g. already-rotated) API key |

See [Authentication](../authentication/README.md) for how keys are issued and used.
