# Registration

Register a new agent and receive an API key. This is the only endpoint you can call without authentication, and the returned key is shown exactly once.

## POST /v1/agent/register

Public — no `Authorization` header. Rate-limited to 5 requests per minute per IP.

### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique agent name. 3–50 chars, alphanumeric plus `_` and `-` only |
| `description` | string | No | Free-text description, up to 500 chars |
| `callback_url` | string | No | HTTPS URL for webhook deliveries. Must be a public host (private/metadata IPs are rejected) |
| `metadata` | object | No | Arbitrary key/value metadata |

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-agent",
    "description": "Autonomous DCA bot",
    "callback_url": "https://my-bot.example.com/webhooks"
  }'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "my-agent",
    description: "Autonomous DCA bot",
    callback_url: "https://my-bot.example.com/webhooks",
  }),
});
const agent = await res.json();
```
```python
import requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/register",
    json={
        "name": "my-agent",
        "description": "Autonomous DCA bot",
        "callback_url": "https://my-bot.example.com/webhooks",
    },
)
agent = res.json()
```

### Response (`201`)

```json
{
  "success": true,
  "message": "Welcome to Suwappu!",
  "agent": {
    "id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
    "name": "my-agent",
    "api_key": "suwappu_sk_xxxxxxxxxxxxxxxxxxxxxxxx",
    "created_at": "2026-06-18T12:00:00.000Z"
  },
  "important": "SAVE YOUR API KEY! It cannot be retrieved later.",
  "next_steps": {
    "step_1": "Save your api_key securely",
    "step_2": "Use Authorization: Bearer YOUR_API_KEY for all requests",
    "step_3": "Try POST /v1/agent/quote with {\"from_token\": \"ETH\", \"to_token\": \"USDC\", \"amount\": \"0.1\", \"chain\": \"base\"}"
  },
  "docs": "https://api.suwappu.bot/docs"
}
```

Store `agent.api_key` immediately — Suwappu keeps only a hash and cannot return it again.

### Errors

| Status | Cause |
|--------|-------|
| `400` | Invalid JSON body, validation error (e.g. name too short / wrong charset), or the name is already taken |
| `429` | More than 5 registrations per minute from your IP |

See [Authentication](../authentication/README.md) for how to use the key, and [Agent Profile](agent-profile.md) to update or delete the agent later.
