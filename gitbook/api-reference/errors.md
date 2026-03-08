# Errors

All error responses follow a consistent envelope format. When a request fails, the response body contains `success: false` along with an error message and optional field-level details.

## Error Response Format

```json
{
  "success": false,
  "error": "Human-readable error message",
  "fields": {
    "quote_id": "Required field missing"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `false` for errors |
| `error` | string | Human-readable description of what went wrong |
| `fields` | object \| undefined | Optional. Per-field validation error details. Only present on 400 responses with validation failures. |

---

## HTTP Status Codes

| Status | Meaning | When It Occurs |
|--------|---------|----------------|
| 400 | Bad Request | Validation failure -- missing fields, invalid values, malformed body |
| 401 | Unauthorized | Missing `Authorization` header, invalid API key, or expired key |
| 404 | Not Found | Resource does not exist (e.g., unknown swap ID, quote ID, or endpoint) |
| 429 | Too Many Requests | Rate limit exceeded. Back off and retry after the indicated interval. |
| 500 | Internal Server Error | Unexpected server-side failure. Retry with exponential backoff. |

---

## Common Error Scenarios

| Status | Error Message | Fix |
|--------|--------------|-----|
| 400 | `"command is required"` | Include a `command` field in the `POST /execute` body |
| 400 | `"Command exceeds 500 character limit"` | Shorten the `command` string to 500 characters or fewer |
| 400 | `"quote_id is required"` | Include a `quote_id` field in the `POST /swap/execute` body |
| 400 | `"Quote expired"` | Request a new quote via `POST /quote` and execute promptly |
| 400 | `"Invalid status filter"` | Use one of: `"submitted"`, `"pending"`, `"completed"`, `"failed"` |
| 400 | `"limit must be between 1 and 100"` | Set `limit` to a value between 1 and 100 |
| 400 | `"No callback_url configured"` | Set a `callback_url` in your agent profile via `PATCH /me` before testing webhooks |
| 400 | `"Unable to parse command"` | Rephrase the natural language command in a supported format |
| 401 | `"Unauthorized"` | Check that the `Authorization: Bearer <key>` header is present and the key is valid |
| 404 | `"Swap not found"` | Verify the swap ID exists and belongs to your agent |
| 404 | `"Quote not found"` | Verify the quote ID; it may have expired or been consumed |
| 404 | `"No managed wallet found"` | Create a managed wallet via `POST /wallets` before executing swaps |
| 429 | `"Rate limit exceeded"` | Wait and retry. Check the `Retry-After` header for the recommended delay. |
| 500 | `"Internal server error"` | Retry with exponential backoff. Contact support if it persists. |

---

## JSON-RPC Errors (MCP / A2A)

For agents connecting via MCP or A2A protocols, errors follow the JSON-RPC 2.0 error format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32601,
    "message": "Method not found"
  }
}
```

### Standard JSON-RPC Error Codes

| Code | Name | Description |
|------|------|-------------|
| -32700 | Parse Error | Invalid JSON received by the server |
| -32600 | Invalid Request | The JSON payload is not a valid JSON-RPC request |
| -32601 | Method Not Found | The requested method does not exist or is not available |
| -32602 | Invalid Params | Invalid method parameters (wrong type, missing required fields) |

### Application-Specific Error Codes

| Code | Name | Description |
|------|------|-------------|
| -32001 | Task Not Found | The referenced task ID does not exist |
| -32002 | Unsupported Operation | The requested operation is not supported by this agent |

### Example JSON-RPC Error Responses

**Parse Error:**

```json
{
  "jsonrpc": "2.0",
  "id": null,
  "error": {
    "code": -32700,
    "message": "Parse error: invalid JSON"
  }
}
```

**Invalid Params:**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "error": {
    "code": -32602,
    "message": "Invalid params: 'from_token' is required"
  }
}
```

**Task Not Found:**

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "error": {
    "code": -32001,
    "message": "Task not found: task_abc123"
  }
}
```
