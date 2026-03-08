# Register Agent

`POST /register` | Auth: None

Register a new agent with the Suwappu platform. Returns an API key that must be used to authenticate all subsequent requests.

## Request

### Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique agent name. 3-50 characters. Must match `^[a-zA-Z0-9_-]+$` (alphanumeric, hyphens, underscores only). |
| `description` | string | No | Human-readable description of the agent. Max 500 characters. |
| `callback_url` | string (URI) | No | Webhook URL for receiving async notifications. Must be a valid URI. |
| `metadata` | object | No | Arbitrary key-value pairs for custom agent data. |

### Example

```json
{
  "name": "my-trading-bot",
  "description": "Automated portfolio rebalancer for DeFi positions",
  "callback_url": "https://example.com/webhooks/suwappu",
  "metadata": {
    "version": "1.0.0",
    "environment": "production"
  }
}
```

## Response

**Status: 201 Created**

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true`. |
| `agent.id` | string (UUID) | Unique agent identifier. |
| `agent.name` | string | The registered agent name. |
| `agent.api_key` | string | API key for authentication. Prefixed with `suwappu_sk_`. Store this securely -- it is only returned once. |
| `agent.created_at` | string (ISO 8601) | Timestamp of registration. |

### Example

```json
{
  "success": true,
  "agent": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "my-trading-bot",
    "api_key": "suwappu_sk_live_7f3a9b2c1d4e5f6a8b0c9d2e3f4a5b6c",
    "created_at": "2026-03-07T12:00:00Z"
  }
}
```

> **Important:** The `api_key` is only returned in this response. Store it securely. If lost, you must register a new agent.

## Errors

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `"Agent name 'my-bot' is already taken"` | Another agent already uses this name. Choose a different one. |
| 400 | `"Validation failed"` | One or more fields failed validation. Check the `fields` object for details. |

### Validation Error Example

```json
{
  "success": false,
  "error": "Validation failed",
  "fields": {
    "name": "Must be 3-50 characters and contain only letters, numbers, hyphens, and underscores",
    "callback_url": "Must be a valid URI"
  }
}
```

### Name Conflict Example

```json
{
  "success": false,
  "error": "Agent name 'my-trading-bot' is already taken"
}
```

## Code Examples

### curl

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-trading-bot",
    "description": "Automated portfolio rebalancer",
    "callback_url": "https://example.com/webhooks/suwappu"
  }'
```

### Python

```python
import requests

response = requests.post(
    "https://api.suwappu.bot/v1/agent/register",
    json={
        "name": "my-trading-bot",
        "description": "Automated portfolio rebalancer",
        "callback_url": "https://example.com/webhooks/suwappu",
    },
)

data = response.json()
api_key = data["agent"]["api_key"]
print(f"API Key: {api_key}")  # Store this securely
```

### TypeScript

```typescript
const response = await fetch("https://api.suwappu.bot/v1/agent/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "my-trading-bot",
    description: "Automated portfolio rebalancer",
    callback_url: "https://example.com/webhooks/suwappu",
  }),
});

const data = await response.json();
const apiKey = data.agent.api_key; // Store this securely
```
