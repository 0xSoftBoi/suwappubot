# Webhook Setup

Instead of polling for swap status, register a `callback_url` and Suwappu will POST signed events to your server as swaps progress. Every delivery is signed with HMAC-SHA256 so you can verify it came from Suwappu, and you can inspect delivery history or fire a test event at any time.

## Step 1: Set Your Callback URL

Set your webhook endpoint on your agent profile:

```bash
curl -X PATCH https://api.suwappu.bot/v1/agent/me \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"callback_url": "https://your-server.com/webhooks/suwappu"}'
```

Once a `callback_url` is set, swap-execution responses note that you will receive webhook notifications there.

## Step 2: Receive Events

Suwappu POSTs a JSON body to your URL. The payload shape is:

```json
{
  "event": "webhook.test",
  "timestamp": "2026-06-18T12:00:00Z",
  "data": {
    "message": "Test webhook from Suwappu",
    "agent_id": "your-agent-uuid"
  }
}
```

Each delivery carries these headers:

| Header | Description |
|--------|-------------|
| `X-Suwappu-Event` | The event type (e.g. `webhook.test`) |
| `X-Suwappu-Delivery` | A unique delivery UUID |
| `X-Suwappu-Timestamp` | Unix timestamp (seconds) when the delivery was signed |
| `X-Suwappu-Signature` | HMAC-SHA256 signature of the raw JSON body (hex) |

## Step 3: Verify the Signature

The signing key is the **SHA-256 hash of your API key** (the raw `suwappu_sk_...` string, hashed to 32 bytes). The signature is the hex HMAC-SHA256 of the exact raw request body using that key.

```javascript
import crypto from 'crypto'

function verifySuwappuWebhook(rawBody, signatureHeader, apiKey) {
  // Signing key = sha256(apiKey) as raw bytes
  const signingKey = crypto.createHash('sha256').update(apiKey).digest()
  const expected = crypto
    .createHmac('sha256', signingKey)
    .update(rawBody)
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader),
  )
}

// Express example
app.post('/webhooks/suwappu', express.raw({ type: '*/*' }), (req, res) => {
  const sig = req.header('X-Suwappu-Signature')
  if (!verifySuwappuWebhook(req.body, sig, process.env.SUWAPPU_API_KEY)) {
    return res.status(401).send('invalid signature')
  }
  const event = JSON.parse(req.body.toString())
  console.log('Received', event.event, event.data)
  res.sendStatus(200)
})
```

```python
import hashlib, hmac

def verify_suwappu_webhook(raw_body: bytes, signature_header: str, api_key: str) -> bool:
    signing_key = hashlib.sha256(api_key.encode()).digest()
    expected = hmac.new(signing_key, raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

Always verify against the **raw** request body, before any JSON parsing or re-serialization.

## Step 4: Send a Test Event

Fire a test delivery to confirm your endpoint is reachable and your verification works:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/webhooks/test \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

```json
{
  "success": true,
  "callback_url": "https://your-server.com/webhooks/suwappu",
  "status_code": 200,
  "response_time_ms": 142
}
```

If no `callback_url` is configured, the test returns an error hinting you to set one via `PATCH /v1/agent/me`. Deliveries time out after 10 seconds, so respond quickly with a `2xx`.

## Step 5: Inspect Delivery History

List recent webhook events, optionally filtered by status or event type:

```bash
curl "https://api.suwappu.bot/v1/agent/webhooks?status=delivered" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

## Best Practices

- **Respond fast.** Acknowledge with `2xx` immediately and do heavy work asynchronously — deliveries time out at 10 seconds.
- **Verify every delivery.** Reject any request whose signature does not match.
- **Treat deliveries as at-least-once.** Use the `X-Suwappu-Delivery` ID to deduplicate.
- **Keep your endpoint public and HTTPS.** Suwappu only POSTs to the URL you configured.
