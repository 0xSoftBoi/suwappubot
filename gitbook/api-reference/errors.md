# Error Codes

Suwappu returns conventional HTTP status codes and a JSON body describing what went wrong. Successful responses include `"success": true`; error responses include an `"error"` field and usually a human-readable `"message"`.

## Error response shape

```json
{
  "error": "Validation Error",
  "message": "amount must be a positive number",
  "fields": { "amount": "amount must be a positive number" }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Short error category |
| `message` | string | Human-readable explanation (when available) |
| `fields` | object | Per-field validation messages (on validation errors) |
| `resource` | string | The missing resource (on some 404s) |
| `service` | string | The upstream service (on some 502s) |

Some endpoints also return `success: false` alongside `error`, plus a `hint` suggesting the fix.

## Status codes

| Status | `error` | Meaning |
|--------|---------|---------|
| `400` | Validation Error | Invalid JSON, a failed field validation, unknown chain/token, expired or missing quote, or an invalid amount |
| `401` | Unauthorized | Missing or invalid API key, or invalid webhook signature |
| `403` | Forbidden | `wallet_address` is not your agent's managed wallet, or you tried to act on another agent's resource |
| `404` | Not Found | The requested resource does not exist |
| `429` | — | Rate limit exceeded. See `Retry-After` and the `X-RateLimit-*` headers |
| `500` | Internal Error / Database Error | An unexpected server-side failure |
| `502` | External Service Error | An upstream provider (e.g. a swap aggregator or RPC) failed |

## Validation errors

Validation failures (`400`) return a `fields` map keyed by the offending field, so you can surface precise feedback:

```json
{
  "error": "Validation Error",
  "message": "Validation error",
  "fields": {
    "from_token": "from_token is required",
    "amount": "amount must be a positive number"
  }
}
```

## Quote errors

A swap or execute call with an expired, missing, or cross-agent `quote_id` returns:

```json
{
  "success": false,
  "error": "Quote expired or not found",
  "hint": "Request a new quote using POST /v1/agent/quote"
}
```

Quotes are valid for 60 seconds — request a fresh one and retry.

## Rate-limit errors

A `429` includes timing headers and a descriptive message:

```json
{
  "message": "Rate limit exceeded. 30 requests per minute for free tier. Retry after 12s."
}
```

Honor the `Retry-After` header before retrying. See [Rate Limits](../authentication/rate-limits.md).

## Handling errors

- Always check the HTTP status before parsing the body as success.
- Retry `429`, `502`, and transient `500`s with exponential backoff; do not retry `400`/`401`/`403` without fixing the request.
- Read `fields` to map validation errors back to user input.
