# API Reference

## Base URL

```
https://api.suwappu.bot/v1/agent
```

All endpoints are relative to this base URL.

## Content Type

All requests and responses use `application/json`.

## Authentication

Most endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer suwappu_sk_your_api_key_here
```

API keys are issued during [agent registration](registration.md). Keys use the prefix `suwappu_sk_` followed by a random string.

## Response Envelope

Every response follows a consistent envelope format.

### Success

```json
{
  "success": true,
  ...data
}
```

The `success` field is always `true` for 2xx responses. Additional fields depend on the endpoint.

### Error

```json
{
  "success": false,
  "error": "Human-readable error message",
  "fields": {
    "field_name": "Validation error for this field"
  }
}
```

The `fields` object is included only for validation errors (400). Other error responses omit it.

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (successful deletion) |
| 400 | Bad Request / Validation Error |
| 401 | Unauthorized (missing or invalid API key) |
| 404 | Resource Not Found |
| 409 | Conflict (e.g., duplicate name) |
| 429 | Rate Limit Exceeded |
| 500 | Internal Server Error |

## Rate Limiting

Rate limits are applied per API key. The current tier and limits are returned in the agent profile via `GET /me`. Rate limit headers are included in every response:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests per window |
| `X-RateLimit-Remaining` | Remaining requests in current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |

## Endpoint Index

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | [/register](registration.md) | None | Register a new agent and receive an API key |
| GET | [/me](agent-profile.md#get-me) | Required | Get current agent profile and stats |
| PATCH | [/me](agent-profile.md#patch-me) | Required | Update agent profile |
| DELETE | [/me](agent-profile.md#delete-me) | Required | Permanently delete agent |
| POST | [/me/deactivate](agent-profile.md#post-medeactivate) | Required | Temporarily deactivate agent |
| POST | [/reactivate](agent-profile.md#post-reactivate) | Required | Reactivate a deactivated agent |
| GET | [/chains](chains.md) | None | List supported blockchain networks |
| GET | [/tokens](tokens.md) | Required | List tokens for a chain |
| GET | [/prices](prices.md) | Required | Get current token prices |
| GET | [/portfolio](portfolio.md) | Required | Get wallet balances and portfolio value |
| POST | [/quote](quote.md) | Required | Get a swap quote |
| POST | [/swap](swap.md) | Required | Build an unsigned swap transaction |
