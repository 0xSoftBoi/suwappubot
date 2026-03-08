# Webhooks

Manage and test webhook event delivery. Webhook events are sent to the `callback_url` configured in your agent profile via `PATCH /me`.

---

## List Webhook Events

`GET /webhooks` | Auth: Required

Retrieve a paginated list of webhook delivery attempts.

### Request

#### Query Parameters

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `status` | string | No | -- | Filter by delivery status: `"pending"`, `"delivered"`, or `"failed"` |
| `event_type` | string | No | -- | Filter by event type (e.g., `"swap.completed"`) |
| `limit` | integer | No | 20 | Number of results per page (max 100) |
| `offset` | integer | No | 0 | Number of results to skip for pagination |

### Response

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the request succeeded |
| `events` | array | List of webhook event objects |
| `pagination` | object | Pagination metadata |

#### Event Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique event identifier |
| `event_type` | string | Type of event (e.g., `"swap.completed"`, `"swap.failed"`) |
| `status` | string | Delivery status: `"pending"`, `"delivered"`, or `"failed"` |
| `attempts` | integer | Number of delivery attempts made |
| `last_error` | string \| null | Error message from the most recent failed attempt |
| `response_status` | integer \| null | HTTP status code returned by your callback endpoint |
| `callback_url` | string | The URL the event was sent to |
| `created_at` | string | ISO 8601 timestamp when the event was created |
| `delivered_at` | string \| null | ISO 8601 timestamp when the event was successfully delivered |

#### Pagination Object

| Field | Type | Description |
|-------|------|-------------|
| `total` | integer | Total number of matching events |
| `limit` | integer | Current page size |
| `offset` | integer | Current offset |
| `has_more` | boolean | Whether more results exist beyond this page |

### Example Response

```json
{
  "success": true,
  "events": [
    {
      "id": "evt_9f3a1b2c",
      "event_type": "swap.completed",
      "status": "delivered",
      "attempts": 1,
      "last_error": null,
      "response_status": 200,
      "callback_url": "https://yourapp.com/webhooks/suwappu",
      "created_at": "2026-03-07T14:30:00Z",
      "delivered_at": "2026-03-07T14:30:01Z"
    },
    {
      "id": "evt_7d4e5f6a",
      "event_type": "swap.failed",
      "status": "failed",
      "attempts": 3,
      "last_error": "Connection timeout",
      "response_status": null,
      "callback_url": "https://yourapp.com/webhooks/suwappu",
      "created_at": "2026-03-07T12:15:00Z",
      "delivered_at": null
    }
  ],
  "pagination": {
    "total": 87,
    "limit": 20,
    "offset": 0,
    "has_more": true
  }
}
```

---

## Test Webhook

`POST /webhooks/test` | Auth: Required

Send a test event to your configured `callback_url`. You must have a `callback_url` set in your agent profile (via `PATCH /me`) before calling this endpoint.

### Request

No body required.

### Response

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the test delivery succeeded |
| `callback_url` | string | The URL the test event was sent to |
| `status_code` | integer | HTTP status code returned by your callback endpoint |
| `response_time_ms` | integer | Round-trip response time in milliseconds |

### Example Response

```json
{
  "success": true,
  "callback_url": "https://yourapp.com/webhooks/suwappu",
  "status_code": 200,
  "response_time_ms": 142
}
```

---

## Errors

| Status | Error | Cause |
|--------|-------|-------|
| 400 | `"No callback_url configured"` | You have not set a `callback_url` in your agent profile |
| 400 | `"Invalid status filter"` | The `status` parameter is not `"pending"`, `"delivered"`, or `"failed"` |
| 400 | `"limit must be between 1 and 100"` | The `limit` parameter is out of range |
| 401 | `"Unauthorized"` | Missing or invalid API key |

---

## Code Examples

### curl

```bash
# List webhook events
curl "https://api.suwappu.bot/v1/agent/webhooks?status=failed&limit=10" \
  -H "Authorization: Bearer suwappu_sk_your_api_key"

# Test webhook delivery
curl -X POST https://api.suwappu.bot/v1/agent/webhooks/test \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

### Python

```python
import requests

headers = {"Authorization": "Bearer suwappu_sk_your_api_key"}

# List webhook events
response = requests.get(
    "https://api.suwappu.bot/v1/agent/webhooks",
    headers=headers,
    params={"status": "failed", "limit": 10},
)
data = response.json()
if data["success"]:
    for event in data["events"]:
        print(f"{event['event_type']}: {event['status']} (attempts: {event['attempts']})")

# Test webhook
response = requests.post(
    "https://api.suwappu.bot/v1/agent/webhooks/test",
    headers=headers,
)
data = response.json()
if data["success"]:
    print(f"Delivered to {data['callback_url']} in {data['response_time_ms']}ms")
```

### TypeScript

```typescript
const headers = {
  Authorization: "Bearer suwappu_sk_your_api_key",
};

// List webhook events
const params = new URLSearchParams({ status: "failed", limit: "10" });
const listResponse = await fetch(
  `https://api.suwappu.bot/v1/agent/webhooks?${params}`,
  { headers }
);
const listData = await listResponse.json();
if (listData.success) {
  for (const event of listData.events) {
    console.log(
      `${event.event_type}: ${event.status} (attempts: ${event.attempts})`
    );
  }
}

// Test webhook
const testResponse = await fetch(
  "https://api.suwappu.bot/v1/agent/webhooks/test",
  { method: "POST", headers }
);
const testData = await testResponse.json();
if (testData.success) {
  console.log(
    `Delivered to ${testData.callback_url} in ${testData.response_time_ms}ms`
  );
}
```
