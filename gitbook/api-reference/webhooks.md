# Webhooks

Receive signed HTTP callbacks when your swaps and other events change state, instead of polling. Set a `callback_url` on your agent, verify the signature on each delivery, and inspect delivery history through the API.

## Setting your callback URL

Configure where Suwappu posts events via [`PATCH /v1/agent/me`](agent-profile.md) (or at registration). The URL must be a public HTTPS host — private and cloud-metadata addresses are rejected.

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
const profile = await res.json();
```
```python
import os, requests

res = requests.patch(
    "https://api.suwappu.bot/v1/agent/me",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    json={"callback_url": "https://my-bot.example.com/webhooks"},
)
profile = res.json()
```

## Delivery format

Suwappu POSTs a JSON body to your `callback_url` with these headers:

| Header | Description |
|--------|-------------|
| `X-Suwappu-Event` | Event type (e.g. `webhook.test`) |
| `X-Suwappu-Delivery` | Unique delivery UUID |
| `X-Suwappu-Timestamp` | Unix timestamp (seconds) of the delivery |
| `X-Suwappu-Signature` | HMAC-SHA256 signature of the raw body |

Example payload:

```json
{
  "event": "webhook.test",
  "timestamp": "2026-06-18T12:00:00.000Z",
  "data": { "message": "Test webhook from Suwappu", "agent_id": "a1b2c3d4-..." }
}
```

## Verifying the signature

The signature is `HMAC-SHA256(body, key)` where `key` is the **SHA-256 hash of your API key** (the raw `suwappu_sk_...` bytes). Compute the same HMAC over the raw request body and compare in constant time.

```ts
import crypto from 'crypto'

function verify(rawBody: string, signature: string, apiKey: string): boolean {
  const signingKey = crypto.createHash('sha256').update(apiKey).digest()
  const expected = crypto.createHmac('sha256', signingKey).update(rawBody).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))
}
```

Reject any request whose signature does not match.

## Testing delivery

Send a test event to your configured `callback_url`:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/webhooks/test \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/webhooks/test", {
  method: "POST",
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const result = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/webhooks/test",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
)
result = res.json()
```

**Response:**

```json
{
  "success": true,
  "callback_url": "https://my-bot.example.com/webhooks",
  "status_code": 200,
  "response_time_ms": 142
}
```

Your endpoint must respond within 10 seconds. A non-2xx or timeout is reported in the response.

## Listing delivery history

Inspect past webhook deliveries and their outcomes.

### GET /v1/agent/webhooks

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | No | Filter by delivery status |
| `event_type` | string | No | Filter by event type |
| `limit` | number | No | Page size, 1–100. Defaults to 20 |
| `offset` | number | No | Records to skip. Defaults to 0 |

```bash
curl "https://api.suwappu.bot/v1/agent/webhooks?limit=20" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/webhooks?limit=20", {
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const history = await res.json();
```
```python
import os, requests

res = requests.get(
    "https://api.suwappu.bot/v1/agent/webhooks",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    params={"limit": 20},
)
history = res.json()
```

**Response:**

```json
{
  "success": true,
  "events": [
    {
      "id": 91,
      "event_type": "swap.completed",
      "status": "delivered",
      "attempts": 1,
      "last_error": null,
      "response_status": 200,
      "callback_url": "https://my-bot.example.com/webhooks",
      "created_at": "2026-06-18T12:00:28.000Z",
      "delivered_at": "2026-06-18T12:00:29.000Z"
    }
  ],
  "pagination": { "total": 1, "limit": 20, "offset": 0, "has_more": false }
}
```

### Errors

| Status | Cause |
|--------|-------|
| `400` | No `callback_url` configured (for `/webhooks/test`), or invalid query parameters |
| `401` | Missing or invalid API key |
