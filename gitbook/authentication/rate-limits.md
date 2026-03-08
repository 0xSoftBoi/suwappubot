# Rate Limits

The Suwappu Agent API enforces rate limits using a sliding window mechanism. Limits vary by tier and are applied per API key.

## Tiers

| Tier | Requests per Minute | Description |
|------|---------------------|-------------|
| **Free** | 30 | Default tier for newly registered agents |
| **Agent** | 100 | For active trading agents |
| **Pro** | 500 | For high-frequency and production workloads |

All limits use a **1-minute sliding window**. The window tracks requests over the last 60 seconds, not fixed calendar minutes.

## Response Headers

Every API response includes rate limit headers so you can track your usage in real time:

| Header | Description | Example |
|--------|-------------|---------|
| `X-RateLimit-Limit` | Maximum requests allowed per minute for your tier | `30` |
| `X-RateLimit-Remaining` | Requests remaining in the current window | `27` |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets | `1705312260` |

**Example response headers:**

```
HTTP/1.1 200 OK
Content-Type: application/json
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 27
X-RateLimit-Reset: 1705312260
```

## Handling 429 Too Many Requests

When you exceed your rate limit, the API returns a `429` status with a `Retry-After` header indicating how many seconds to wait before retrying.

**Response:**

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 12
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1705312260
```

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Retry after 12 seconds."
  }
}
```

## Public Endpoints

Public endpoints (`POST /register`, `GET /chains`, `GET /openapi`) are not subject to per-key rate limiting.

## Code Examples

### Python

```python
import time
import requests

BASE_URL = "https://api.suwappu.bot/v1/agent"
API_KEY = "suwappu_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_KEY}",
}


def request_with_retry(method: str, url: str, max_retries: int = 3, **kwargs):
    """Make an API request with automatic retry on rate limit."""
    for attempt in range(max_retries):
        response = requests.request(method, url, headers=headers, **kwargs)

        # Log rate limit status
        remaining = response.headers.get("X-RateLimit-Remaining")
        limit = response.headers.get("X-RateLimit-Limit")
        if remaining is not None:
            print(f"Rate limit: {remaining}/{limit} requests remaining")

        # If not rate limited, return the response
        if response.status_code != 429:
            response.raise_for_status()
            return response.json()

        # Rate limited — wait and retry
        retry_after = int(response.headers.get("Retry-After", 5))
        print(f"Rate limited. Retrying in {retry_after}s (attempt {attempt + 1}/{max_retries})")
        time.sleep(retry_after)

    raise Exception("Max retries exceeded due to rate limiting")


# Usage
quote = request_with_retry(
    "POST",
    f"{BASE_URL}/quote",
    json={
        "from_token": "USDC",
        "to_token": "ETH",
        "amount": "500.00",
        "chain": "ethereum",
    },
)
print(quote)
```

### TypeScript

```typescript
const BASE_URL = "https://api.suwappu.bot/v1/agent";
const API_KEY = "suwappu_sk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_KEY}`,
};

async function requestWithRetry(
  method: string,
  url: string,
  body?: object,
  maxRetries = 3
): Promise<any> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Log rate limit status
    const remaining = response.headers.get("X-RateLimit-Remaining");
    const limit = response.headers.get("X-RateLimit-Limit");
    if (remaining !== null) {
      console.log(`Rate limit: ${remaining}/${limit} requests remaining`);
    }

    // If not rate limited, return the response
    if (response.status !== 429) {
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      return response.json();
    }

    // Rate limited — wait and retry
    const retryAfter = parseInt(response.headers.get("Retry-After") ?? "5", 10);
    console.log(
      `Rate limited. Retrying in ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})`
    );
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
  }

  throw new Error("Max retries exceeded due to rate limiting");
}

// Usage
const quote = await requestWithRetry("POST", `${BASE_URL}/quote`, {
  from_token: "USDC",
  to_token: "ETH",
  amount: "500.00",
  chain: "ethereum",
});
console.log(quote);
```

## Best Practices

- **Monitor headers proactively.** Check `X-RateLimit-Remaining` on every response and throttle before hitting zero.
- **Always respect `Retry-After`.** Do not retry immediately — the server tells you exactly how long to wait.
- **Use exponential backoff as a fallback.** If `Retry-After` is absent for any reason, back off exponentially (e.g., 1s, 2s, 4s).
- **Batch where possible.** Reduce request count by batching operations rather than making many individual calls.
- **Upgrade your tier** if you consistently hit rate limits in production.
