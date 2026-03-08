# Authentication

The Suwappu Agent API uses Bearer token authentication. Every authenticated request must include your API key in the `Authorization` header.

## Bearer Token Format

```
Authorization: Bearer suwappu_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

API keys follow this format:

- **Prefix**: `suwappu_sk_`
- **Body**: Alphanumeric characters, hyphens, and underscores (`[a-zA-Z0-9_-]+`)
- **Minimum length**: 32 characters total (including the prefix)

## Getting an API Key

Call the registration endpoint to create an agent and receive your key. This endpoint is public and does not require authentication.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name":"my-agent","description":"My trading agent"}'
```

**Response:**

```json
{
  "success": true,
  "agent": {
    "id": "a1b2c3d4-5678-90ab-cdef-1234567890ab",
    "name": "my-agent",
    "api_key": "suwappu_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "created_at": "2025-01-15T10:30:00Z"
  }
}
```

Store your API key securely. It is shown only once at registration time.

## Using Your Key

Include the key in the `Authorization` header on every authenticated request:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer suwappu_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6" \
  -d '{"from_token":"USDC","to_token":"ETH","amount":"100.00","chain":"ethereum"}'
```

If the key is missing, malformed, or revoked, the API returns a `401 Unauthorized` response:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing API key"
  }
}
```

## Key Rotation

Rotate your API key without re-registering. The old key is immediately invalidated and a new one is returned.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/keys/rotate \
  -H "Authorization: Bearer suwappu_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
```

**Response:**

```json
{
  "success": true,
  "api_key": "suwappu_sk_x9y8z7w6v5u4t3s2r1q0p9o8n7m6l5k4",
  "rotated_at": "2025-01-20T14:00:00Z"
}
```

Update your application to use the new key immediately after rotation. The previous key will no longer work.

## Public Endpoints

The following endpoints do not require authentication:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/register` | Create a new agent and receive an API key |
| `GET` | `/chains` | List supported blockchain networks |
| `GET` | `/openapi` | OpenAPI specification for the API |

All other endpoints require a valid Bearer token.

## Security Best Practices

- Never expose your API key in client-side code, public repositories, or logs.
- Use environment variables or a secrets manager to store keys.
- Rotate keys periodically and immediately if you suspect a compromise.
- Each agent should have its own dedicated key.

## Next Steps

- Review [Rate Limits](rate-limits.md) to understand request quotas for each tier.
- See [Quick Start](../quickstart/README.md) for a full walkthrough of the swap flow.
