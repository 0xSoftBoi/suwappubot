# Agent Profile

Read, update, or permanently delete your agent. All three operations require your API key and act on the agent that key belongs to.

## GET /v1/agent/me

Return your agent's profile and usage stats.

```bash
curl https://api.suwappu.bot/v1/agent/me \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/me", {
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const agent = await res.json();
```
```python
import os, requests

res = requests.get(
    "https://api.suwappu.bot/v1/agent/me",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
)
agent = res.json()
```

**Response:**

```json
{
  "success": true,
  "agent": {
    "id": "a1b2c3d4-...",
    "name": "my-agent",
    "description": "Autonomous DCA bot",
    "rate_limit_tier": "free",
    "stats": {
      "total_requests": 142,
      "total_swaps": 17
    },
    "created_at": "2026-06-18T12:00:00.000Z",
    "last_active_at": "2026-06-18T15:30:00.000Z"
  }
}
```

## PATCH /v1/agent/me

Update one or more profile fields. At least one field must be provided.

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | New description, up to 500 chars |
| `callback_url` | string \| null | Webhook URL (public host required). Send `null` to clear it |
| `metadata` | object | Replacement metadata object |

```bash
curl -X PATCH https://api.suwappu.bot/v1/agent/me \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"callback_url": "https://my-bot.example.com/webhooks"}'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/me", {
  method: "PATCH",
  headers: {
    "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ callback_url: "https://my-bot.example.com/webhooks" }),
});
const agent = await res.json();
```
```python
import os, requests

res = requests.patch(
    "https://api.suwappu.bot/v1/agent/me",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    json={"callback_url": "https://my-bot.example.com/webhooks"},
)
agent = res.json()
```

**Response:**

```json
{
  "success": true,
  "agent": {
    "id": "a1b2c3d4-...",
    "name": "my-agent",
    "description": "Autonomous DCA bot",
    "callback_url": "https://my-bot.example.com/webhooks",
    "metadata": {},
    "rate_limit_tier": "free",
    "stats": { "total_requests": 142, "total_swaps": 17 },
    "updated_at": "2026-06-18T15:31:00.000Z"
  }
}
```

## DELETE /v1/agent/me

Permanently delete your agent. This is irreversible and invalidates your API key.

```bash
curl -X DELETE https://api.suwappu.bot/v1/agent/me \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/me", {
  method: "DELETE",
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
// 204 No Content on success
```
```python
import os, requests

res = requests.delete(
    "https://api.suwappu.bot/v1/agent/me",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
)
# 204 No Content on success
```

Returns `204 No Content` with an empty body on success.

## Deactivate and reactivate

To temporarily disable an agent without deleting it:

```bash
# Deactivate
curl -X POST https://api.suwappu.bot/v1/agent/me/deactivate \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"

# Reactivate (works even while inactive)
curl -X POST https://api.suwappu.bot/v1/agent/reactivate \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

Both return `{ "success": true, "message": "..." }`.

### Errors

| Status | Cause |
|--------|-------|
| `400` | Invalid JSON body, or PATCH with no fields / invalid `callback_url` |
| `401` | Missing or invalid API key |
