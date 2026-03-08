# A2A (Agent-to-Agent) Protocol

The A2A protocol enables AI agents to communicate with Suwappu using natural language messages over JSON-RPC 2.0. Your agent sends a message, and Suwappu returns a task object that tracks the request through its lifecycle.

## Endpoint

```
POST https://api.suwappu.bot/a2a
```

## Authentication

Include your Bearer token in the `Authorization` header:

```
Authorization: Bearer suwappu_sk_YOUR_KEY
```

Obtain a token by registering at `POST /v1/agent/register`.

## Protocol

All requests and responses follow the JSON-RPC 2.0 specification. Every request must include:

- `jsonrpc`: Always `"2.0"`
- `id`: A unique request identifier (integer or string)
- `method`: One of the three supported methods
- `params`: Method-specific parameters

## Methods

### message/send

Send a natural language message to Suwappu and receive a task with the result.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "swap 0.5 ETH to USDC on base"
        }
      ]
    }
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
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "status": {
        "state": "completed",
        "timestamp": "2026-03-07T12:00:00Z"
      },
      "artifacts": [
        {
          "id": "artifact-1",
          "parts": [
            {
              "type": "text",
              "text": "Quote ready: 0.5 ETH -> 1,247.50 USDC on Base"
            },
            {
              "type": "data",
              "data": {
                "quote_id": "q_abc123",
                "from_token": "ETH",
                "to_token": "USDC",
                "from_amount": "0.5",
                "to_amount": "1247.50",
                "chain": "base",
                "expires_at": "2026-03-07T12:05:00Z"
              }
            }
          ]
        }
      ],
      "messages": [
        {
          "role": "user",
          "parts": [{"type": "text", "text": "swap 0.5 ETH to USDC on base"}]
        },
        {
          "role": "agent",
          "parts": [{"type": "text", "text": "Quote ready: 0.5 ETH -> 1,247.50 USDC on Base"}]
        }
      ]
    }
  }
}
```

### tasks/get

Retrieve a task by its ID to check its current status and results.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tasks/get",
  "params": {
    "taskId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

**Response:**

Returns the same task object structure as `message/send`.

### tasks/cancel

Cancel a task that is currently running.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tasks/cancel",
  "params": {
    "taskId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "task": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "status": {
        "state": "canceled",
        "timestamp": "2026-03-07T12:01:00Z"
      }
    }
  }
}
```

## Task Lifecycle

A task transitions through the following states:

```
submitted --> working --> completed
                |
                +--> failed
                |
                +--> canceled
```

| State | Description |
|-------|-------------|
| `submitted` | Task received and queued for processing |
| `working` | Task is actively being processed |
| `completed` | Task finished successfully; results available in `artifacts` |
| `failed` | Task encountered an error; details in `status.message` |
| `canceled` | Task was canceled via `tasks/cancel` |

## Task Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Unique task identifier |
| `status.state` | string | Current lifecycle state |
| `status.timestamp` | string (ISO 8601) | When the status last changed |
| `status.message` | string (optional) | Human-readable status detail or error message |
| `artifacts` | array | Result data, present when state is `completed` |
| `artifacts[].id` | string | Artifact identifier |
| `artifacts[].parts` | array | Content parts (text and/or structured data) |
| `messages` | array | Full conversation history for the task |

## Supported Commands

Suwappu understands the following natural language intents:

| Intent | Example messages |
|--------|-----------------|
| Swap / Quote / Convert | "swap 0.5 ETH to USDC on base", "quote 100 USDC to WBTC on ethereum" |
| Price checks | "price of ETH", "prices for ETH, BTC, SOL" |
| Balance / Portfolio | "show my portfolio on base", "check balances for 0xabc..." |
| Token discovery | "list tokens on arbitrum", "search for PEPE token" |
| Chain discovery | "list supported chains", "what chains do you support" |
| Help | "help", "what can you do" |

## Error Codes

Standard JSON-RPC 2.0 error codes plus Suwappu-specific codes:

| Code | Name | Description |
|------|------|-------------|
| `-32700` | Parse error | Invalid JSON in request body |
| `-32600` | Invalid request | Request is not a valid JSON-RPC 2.0 object |
| `-32601` | Method not found | The method name is not one of the three supported methods |
| `-32001` | Task not found | The provided `taskId` does not match any existing task |
| `-32002` | Unsupported operation | The requested operation is not supported |

**Error response example:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "error": {
    "code": -32001,
    "message": "Task not found",
    "data": {
      "taskId": "nonexistent-uuid"
    }
  }
}
```

## Full Example: Quote and Execute

```bash
# Step 1: Request a swap (returns a quote)
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
        "parts": [{"type": "text", "text": "swap 0.5 ETH to USDC on base"}]
      }
    }
  }'

# Step 2: Check task status (if needed)
curl -X POST https://api.suwappu.bot/a2a \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tasks/get",
    "params": {
      "taskId": "TASK_ID_FROM_STEP_1"
    }
  }'
```
