# Webhook Setup

Webhooks let your agent receive real-time notifications when swaps complete or fail, instead of polling `GET /swap/status`. Suwappu sends an HTTP POST request to your callback URL whenever a swap event occurs.

## How It Works

1. **Set your callback URL** -- Update your agent profile with `PATCH /me`
2. **Test delivery** -- Send a test webhook to verify your endpoint works
3. **Handle events** -- Process incoming webhook payloads in your application
4. **Monitor** -- View recent webhook events via `GET /webhooks`

## Step 1: Set Your Callback URL

Configure the webhook endpoint in your agent profile:

```bash
curl -X PATCH https://api.suwappu.bot/v1/agent/me \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"callback_url": "https://your-server.com/webhooks/suwappu"}'
```

#### Response

```json
{
  "success": true,
  "agent": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "my-trading-bot",
    "description": "Automated portfolio rebalancer",
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

To remove the webhook, set `callback_url` to `null`:

```bash
curl -X PATCH https://api.suwappu.bot/v1/agent/me \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"callback_url": null}'
```

## Step 2: Test Webhook Delivery

Send a test event to verify your endpoint is reachable and working:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/webhooks/test \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

This sends a test payload to your configured `callback_url`. Check your server logs to confirm receipt.

## Step 3: Handle Webhook Events

### Event Types

| Event | Description |
|-------|-------------|
| `swap.completed` | A swap has been confirmed on-chain |
| `swap.failed` | A swap transaction reverted or could not be confirmed |

### Webhook Payload

Suwappu sends a `POST` request to your callback URL with a JSON body:

```json
{
  "event": "swap.completed",
  "timestamp": "2026-03-07T14:30:00Z",
  "data": {
    "swap_id": 4821,
    "status": "completed",
    "tx_hash": "0x8a3c...f29e",
    "from_token": "ETH",
    "to_token": "USDC",
    "chain": "base"
  }
}
```

Your endpoint should return a `200` status code to acknowledge receipt. If the endpoint returns a non-2xx status or times out, Suwappu will retry delivery.

## Step 4: View Webhook Events

List recent webhook deliveries for your agent:

```bash
curl https://api.suwappu.bot/v1/agent/webhooks \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

## Complete Example: curl

```bash
API_KEY="suwappu_sk_your_api_key"
BASE="https://api.suwappu.bot/v1/agent"

# Set callback URL
curl -X PATCH "$BASE/me" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"callback_url": "https://your-server.com/webhooks/suwappu"}'

# Test delivery
curl -X POST "$BASE/webhooks/test" \
  -H "Authorization: Bearer $API_KEY"

# View webhook events
curl "$BASE/webhooks" \
  -H "Authorization: Bearer $API_KEY"
```

## Complete Example: Python Flask Receiver

A minimal webhook receiver using Flask:

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route("/webhooks/suwappu", methods=["POST"])
def handle_webhook():
    payload = request.get_json()
    event = payload["event"]
    data = payload["data"]

    if event == "swap.completed":
        print(f"Swap {data['swap_id']} completed!")
        print(f"  {data['from_token']} -> {data['to_token']} on {data['chain']}")
        print(f"  TX: {data['tx_hash']}")
    elif event == "swap.failed":
        print(f"Swap {data['swap_id']} failed!")
        print(f"  {data['from_token']} -> {data['to_token']} on {data['chain']}")

    return jsonify({"received": True}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
```

Install dependencies:

```bash
pip install flask
```

Run the receiver:

```bash
python webhook_receiver.py
```

## Complete Example: Python Setup Script

A script that configures the webhook and tests it:

```python
import requests

API_KEY = "suwappu_sk_your_api_key"
BASE_URL = "https://api.suwappu.bot/v1/agent"
headers = {"Authorization": f"Bearer {API_KEY}"}

CALLBACK_URL = "https://your-server.com/webhooks/suwappu"

# Set the callback URL
response = requests.patch(
    f"{BASE_URL}/me",
    headers=headers,
    json={"callback_url": CALLBACK_URL},
)
print(f"Callback URL set: {response.json()['success']}")

# Test delivery
response = requests.post(f"{BASE_URL}/webhooks/test", headers=headers)
print(f"Test webhook sent: {response.json()}")

# View recent events
response = requests.get(f"{BASE_URL}/webhooks", headers=headers)
events = response.json()
print(f"Recent events: {events}")
```

## Complete Example: TypeScript

```typescript
const API_KEY = "suwappu_sk_your_api_key";
const BASE_URL = "https://api.suwappu.bot/v1/agent";
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

const CALLBACK_URL = "https://your-server.com/webhooks/suwappu";

// Set the callback URL
const patchRes = await fetch(`${BASE_URL}/me`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ callback_url: CALLBACK_URL }),
});
const patchData = await patchRes.json();
console.log(`Callback URL set: ${patchData.success}`);

// Test delivery
const testRes = await fetch(`${BASE_URL}/webhooks/test`, {
  method: "POST",
  headers,
});
const testData = await testRes.json();
console.log(`Test webhook sent:`, testData);

// View recent events
const eventsRes = await fetch(`${BASE_URL}/webhooks`, {
  headers: { Authorization: `Bearer ${API_KEY}` },
});
const events = await eventsRes.json();
console.log("Recent events:", events);
```

## Webhook Receiver in TypeScript (Node.js)

A minimal receiver using the built-in Node.js HTTP server:

```typescript
import { createServer } from "node:http";

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhooks/suwappu") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const payload = JSON.parse(body);
      const { event, data } = payload;

      if (event === "swap.completed") {
        console.log(`Swap ${data.swap_id} completed! TX: ${data.tx_hash}`);
      } else if (event === "swap.failed") {
        console.log(`Swap ${data.swap_id} failed.`);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ received: true }));
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(8080, () => console.log("Webhook receiver on :8080"));
```

## Tips

- **Use HTTPS** for your callback URL. Suwappu will not deliver webhooks to plain HTTP endpoints in production.
- **Respond quickly**. Return a `200` status code as fast as possible. Process the event asynchronously if your handler involves heavy work.
- **Idempotency**. Webhooks may be delivered more than once. Use the `swap_id` to deduplicate events.
- **Verify the source**. Check that incoming requests originate from Suwappu by validating headers or using a secret path in your callback URL.
