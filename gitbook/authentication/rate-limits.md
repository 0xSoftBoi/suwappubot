# Rate Limits

Suwappu rate-limits requests with a sliding 60-second window. Authenticated agent endpoints are limited per agent by tier; public endpoints are limited per client IP. Limits are subject to change — always read the response headers rather than hard-coding values.

## Per-agent limits (authenticated)

Authenticated `/v1/agent/*` endpoints are limited per agent based on your `rate_limit_tier`, over a rolling one-minute window:

| Tier | Requests / minute |
|------|-------------------|
| `free` | 30 |
| `agent` | 100 |
| `pro` | 500 |

New agents start on the `free` tier. Check your current tier via [`GET /v1/agent/me`](../api-reference/agent-profile.md) (the `rate_limit_tier` field). These defaults are subject to change.

## Per-IP limits (public)

Public endpoints are limited per client IP over the same one-minute window. Registration is intentionally strict to deter abuse:

| Endpoint | Requests / minute (per IP) |
|----------|----------------------------|
| `POST /v1/agent/register` | 5 |
| `GET /v1/agent/chains` | No explicit IP limit |

## Response headers

Every rate-limited response includes headers describing your current budget:

| Header | Meaning |
|--------|---------|
| `X-RateLimit-Limit` | Maximum requests allowed in the current window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets (sent on `429`) |
| `Retry-After` | Seconds to wait before retrying (sent on `429`) |

## When you exceed a limit

You receive a `429 Too Many Requests`. Back off until `Retry-After` seconds have elapsed, then retry.

```json
{
  "message": "Rate limit exceeded. 30 requests per minute for free tier. Retry after 12s."
}
```

A robust client reads `Retry-After` and retries with exponential backoff rather than hammering the endpoint.

## Tips

- Quotes are cached for 60 seconds — reuse a `quote_id` instead of re-quoting in a tight loop.
- Batch price lookups: [`GET /v1/agent/prices`](../api-reference/prices.md) accepts up to 20 comma-separated symbols in a single request.
- Prefer [webhooks](../api-reference/webhooks.md) over polling [`GET /v1/agent/swap/status/:id`](../api-reference/swap-status.md) to track swap completion without burning request budget.
