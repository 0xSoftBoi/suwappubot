# A2A Protocol

The A2A (Agent-to-Agent) protocol lets other agents talk to Suwappu in natural language over JSON-RPC 2.0. You send a message like `"swap 0.5 ETH to USDC on base"` and Suwappu returns a task containing structured artifacts — a human-readable summary plus a machine-readable data part. Together with the [agent card](agent-card.md) at `/.well-known/agent.json`, A2A makes Suwappu discoverable and callable inside multi-agent systems.

## Endpoint

```
POST https://api.suwappu.bot/a2a
```

## Authentication

A2A requires a Bearer token. Register at `POST /v1/agent/register` to get a key, then send it on every request:

```
Authorization: Bearer suwappu_sk_YOUR_KEY
```

## Protocol

All requests and responses use JSON-RPC 2.0. Every response is returned with HTTP `200` — errors are carried in the JSON-RPC `error` object, not the HTTP status.

## Methods

| Method | Description |
|--------|-------------|
| `message/send` | Send a natural-language message; returns a completed task with artifacts |
| `tasks/get` | Fetch a previously created task by `taskId` |
| `tasks/cancel` | Cancel a task that is still in progress |

Tasks are held in memory and expire one hour after creation.

## message/send

Send a user message. Each message has a `role` and an array of `parts`; at least one `text` part is required.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [{ "type": "text", "text": "swap 0.5 ETH to USDC on base" }]
    },
    "contextId": "optional-conversation-id"
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "task": {
      "id": "b2c3d4e5-...",
      "status": { "state": "completed", "timestamp": "2026-06-18T12:00:01Z" },
      "artifacts": [
        {
          "id": "a1b2c3d4-...",
          "parts": [
            { "type": "text", "text": "Quote: 0.5 ETH → 1247.50 USDC on Base (rate: 2495.0, gas: $0.42)" },
            { "type": "data", "data": { "quote_id": "q_abc123", "from_token": "ETH", "to_token": "USDC", "amount_in": "0.5", "amount_out": "1247.500000", "chain": "Base", "exchange_rate": "2495.0", "expires_in_seconds": 60 } }
          ],
          "metadata": { "action": "quote", "chain": "Base", "quote_id": "q_abc123" }
        }
      ],
      "messages": [],
      "contextId": "optional-conversation-id",
      "createdAt": "2026-06-18T12:00:00Z",
      "updatedAt": "2026-06-18T12:00:01Z"
    }
  }
}
```

The `text` part is a human-readable summary; the `data` part carries the structured fields. Task `status.state` is one of `submitted`, `working`, `completed`, `failed`, or `canceled`.

## tasks/get

Retrieve a task by ID.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tasks/get",
  "params": { "taskId": "b2c3d4e5-..." }
}
```

Returns the same `{ "task": ... }` result shape. If the task is unknown or expired, the response carries error code `-32001` (Task not found).

## tasks/cancel

Cancel a task that is still `submitted` or `working`. Completed or failed tasks cannot be canceled (error `-32002`, Unsupported operation).

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tasks/cancel",
  "params": { "taskId": "b2c3d4e5-..." }
}
```

## Supported Natural-Language Commands

The A2A endpoint understands these intents:

| Intent | Example message | Artifact action |
|--------|-----------------|-----------------|
| Swap / quote | `swap 0.5 ETH to USDC on base`, `quote 1 ETH to USDC` | `quote` |
| Solana swap | `swap 100 USDC to SOL on solana` | `quote` (Jupiter-routed) |
| Prices | `price ETH SOL BTC`, `price of ETH` | `prices` |
| Portfolio | `balance 0x1234...` | `portfolio_hint` |
| Chains | `what chains are supported` | `list_chains` |
| Tokens | `tokens on solana`, `list tokens` | `list_tokens` |
| Help | `help`, `hi` | `help` |

A2A returns swap **quotes** rather than executing them. If the user approves a real managed-wallet trade, hand the quote into the explicit REST `POST /v1/agent/swap/execute` flow. The similarly named natural-language `POST /v1/agent/execute` endpoint is also a quote/unsigned-transaction preparation shim; it does not perform managed execution. Keep the final money-moving authority explicit.

## JSON-RPC Error Codes

| Code | Meaning |
|------|---------|
| `-32700` | Parse error (invalid JSON) |
| `-32600` | Invalid request (missing/invalid JSON-RPC fields) |
| `-32601` | Method not found |
| `-32001` | Task not found |
| `-32002` | Unsupported operation (e.g. cancelling a completed task) |

## Full Example with curl

```bash
curl -X POST https://api.suwappu.bot/a2a \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{ "type": "text", "text": "price ETH SOL BTC" }]
      }
    }
  }'
```

## Discovery

Other agents discover Suwappu's A2A interface from the [agent card](agent-card.md). The card's `interfaces` array advertises the JSON-RPC base URL (`https://api.suwappu.bot/a2a`), and `securitySchemes` explains how to obtain a Bearer token.
