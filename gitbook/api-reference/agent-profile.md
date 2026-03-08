# Agent Profile

Manage the authenticated agent's profile, stats, and lifecycle.

---

## GET /me

`GET /me` | Auth: Required

Retrieve the current agent's profile and usage statistics.

### Request

No parameters required.

### Response

**Status: 200 OK**

#### Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true`. |
| `agent.id` | string (UUID) | Unique agent identifier. |
| `agent.name` | string | Agent name. |
| `agent.description` | string \| null | Agent description. |
| `agent.rate_limit_tier` | string | Current rate limit tier (e.g., `"standard"`, `"premium"`). |
| `agent.stats.total_requests` | number | Total API requests made. |
| `agent.stats.total_swaps` | number | Total swap transactions executed. |
| `agent.created_at` | string (ISO 8601) | Registration timestamp. |
| `agent.last_active_at` | string (ISO 8601) | Timestamp of last API request. |

#### Example

```json
{
  "success": true,
  "agent": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "my-trading-bot",
    "description": "Automated portfolio rebalancer for DeFi positions",
    "rate_limit_tier": "standard",
    "stats": {
      "total_requests": 14832,
      "total_swaps": 247
    },
    "created_at": "2026-01-15T08:30:00Z",
    "last_active_at": "2026-03-07T14:22:10Z"
  }
}
```

### Errors

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `"Invalid or missing API key"` | The API key is missing, malformed, or revoked. |

### Code Examples

#### curl

```bash
curl https://api.suwappu.bot/v1/agent/me \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

#### Python

```python
import requests

response = requests.get(
    "https://api.suwappu.bot/v1/agent/me",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
)

agent = response.json()["agent"]
print(f"Total swaps: {agent['stats']['total_swaps']}")
```

#### TypeScript

```typescript
const response = await fetch("https://api.suwappu.bot/v1/agent/me", {
  headers: { Authorization: "Bearer suwappu_sk_your_api_key" },
});

const { agent } = await response.json();
console.log(`Total swaps: ${agent.stats.total_swaps}`);
```

---

## PATCH /me

`PATCH /me` | Auth: Required

Update the authenticated agent's profile. At least one field must be provided.

### Request

#### Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | string | No | Updated description. Max 500 characters. |
| `callback_url` | string (URI) \| null | No | Updated webhook URL. Set to `null` to remove. |
| `metadata` | object | No | Updated metadata. Replaces existing metadata entirely. |

At least one field must be provided.

#### Example

```json
{
  "description": "Updated portfolio rebalancer v2.0",
  "callback_url": "https://example.com/webhooks/suwappu/v2",
  "metadata": {
    "version": "2.0.0",
    "environment": "production"
  }
}
```

### Response

**Status: 200 OK**

Returns the full updated agent profile (same shape as `GET /me`).

#### Example

```json
{
  "success": true,
  "agent": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "my-trading-bot",
    "description": "Updated portfolio rebalancer v2.0",
    "rate_limit_tier": "standard",
    "stats": {
      "total_requests": 14833,
      "total_swaps": 247
    },
    "created_at": "2026-01-15T08:30:00Z",
    "last_active_at": "2026-03-07T14:25:00Z"
  }
}
```

### Errors

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `"At least one field must be provided"` | The request body is empty or contains no updatable fields. |
| 400 | `"Validation failed"` | One or more fields failed validation. Check the `fields` object. |
| 401 | `"Invalid or missing API key"` | The API key is missing, malformed, or revoked. |

### Code Examples

#### curl

```bash
curl -X PATCH https://api.suwappu.bot/v1/agent/me \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated portfolio rebalancer v2.0"}'
```

#### Python

```python
import requests

response = requests.patch(
    "https://api.suwappu.bot/v1/agent/me",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
    json={"description": "Updated portfolio rebalancer v2.0"},
)

agent = response.json()["agent"]
```

#### TypeScript

```typescript
const response = await fetch("https://api.suwappu.bot/v1/agent/me", {
  method: "PATCH",
  headers: {
    Authorization: "Bearer suwappu_sk_your_api_key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ description: "Updated portfolio rebalancer v2.0" }),
});

const { agent } = await response.json();
```

---

## DELETE /me

`DELETE /me` | Auth: Required

Permanently delete the authenticated agent and all associated data. This action is irreversible.

### Request

No parameters required.

### Response

**Status: 204 No Content**

No response body.

### Errors

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `"Invalid or missing API key"` | The API key is missing, malformed, or revoked. |

### Code Examples

#### curl

```bash
curl -X DELETE https://api.suwappu.bot/v1/agent/me \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

#### Python

```python
import requests

response = requests.delete(
    "https://api.suwappu.bot/v1/agent/me",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
)

assert response.status_code == 204
```

#### TypeScript

```typescript
const response = await fetch("https://api.suwappu.bot/v1/agent/me", {
  method: "DELETE",
  headers: { Authorization: "Bearer suwappu_sk_your_api_key" },
});

console.log(response.status); // 204
```

---

## POST /me/deactivate

`POST /me/deactivate` | Auth: Required

Temporarily deactivate the agent. The agent's data is preserved, but the API key will stop working for all other endpoints until reactivated. Use this instead of deletion when you want to pause operations.

### Request

No parameters required.

### Response

**Status: 200 OK**

#### Example

```json
{
  "success": true,
  "message": "Agent deactivated. Use POST /reactivate to restore access.",
  "agent": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "my-trading-bot",
    "status": "deactivated",
    "deactivated_at": "2026-03-07T14:30:00Z"
  }
}
```

### Errors

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `"Invalid or missing API key"` | The API key is missing, malformed, or revoked. |
| 409 | `"Agent is already deactivated"` | The agent is already in a deactivated state. |

### Code Examples

#### curl

```bash
curl -X POST https://api.suwappu.bot/v1/agent/me/deactivate \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

#### Python

```python
import requests

response = requests.post(
    "https://api.suwappu.bot/v1/agent/me/deactivate",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
)

print(response.json()["message"])
```

#### TypeScript

```typescript
const response = await fetch(
  "https://api.suwappu.bot/v1/agent/me/deactivate",
  {
    method: "POST",
    headers: { Authorization: "Bearer suwappu_sk_your_api_key" },
  }
);

const data = await response.json();
console.log(data.message);
```

---

## POST /reactivate

`POST /reactivate` | Auth: Required

Reactivate a previously deactivated agent. The same API key resumes working for all endpoints.

### Request

No parameters required.

### Response

**Status: 200 OK**

#### Example

```json
{
  "success": true,
  "message": "Agent reactivated successfully.",
  "agent": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "my-trading-bot",
    "status": "active",
    "reactivated_at": "2026-03-07T15:00:00Z"
  }
}
```

### Errors

| Status | Error | Description |
|--------|-------|-------------|
| 401 | `"Invalid or missing API key"` | The API key is missing, malformed, or revoked. |
| 409 | `"Agent is already active"` | The agent is not in a deactivated state. |

### Code Examples

#### curl

```bash
curl -X POST https://api.suwappu.bot/v1/agent/reactivate \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

#### Python

```python
import requests

response = requests.post(
    "https://api.suwappu.bot/v1/agent/reactivate",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
)

print(response.json()["message"])
```

#### TypeScript

```typescript
const response = await fetch(
  "https://api.suwappu.bot/v1/agent/reactivate",
  {
    method: "POST",
    headers: { Authorization: "Bearer suwappu_sk_your_api_key" },
  }
);

const data = await response.json();
console.log(data.message);
```
