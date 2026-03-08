# Execute Command

`POST /execute` | Auth: Required

Parse and execute a natural language command. The server interprets the command and performs the corresponding action -- such as fetching a price, checking a balance, or executing a swap.

## Request

### Body Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `command` | string | Yes | Natural language instruction (max 500 characters) |
| `wallet_address` | string | No | Wallet address to use for the command. Defaults to your managed wallet if omitted. |

### Example Request Body

```json
{
  "command": "swap 0.5 ETH to USDC on base",
  "wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18"
}
```

### Supported Commands

| Command Pattern | Description |
|----------------|-------------|
| `"swap 0.5 ETH to USDC on base"` | Execute a token swap on a specific chain |
| `"price ETH"` | Get the current price of a token |
| `"price ETH SOL"` | Get prices for multiple tokens |
| `"balance 0x742d..."` | Check the token balances of a wallet address |

## Response

The response structure varies depending on the type of command executed.

### Common Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the request succeeded |

### Swap Command Response

```json
{
  "success": true,
  "swap_id": 4821,
  "status": "submitted",
  "tx_hash": "0x8a3c...f29e"
}
```

### Price Command Response

```json
{
  "success": true,
  "prices": {
    "ETH": 3245.67,
    "SOL": 142.89
  }
}
```

### Balance Command Response

```json
{
  "success": true,
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
  "balances": {
    "ETH": "1.2345",
    "USDC": "500.00"
  }
}
```

## Errors

| Status | Error | Cause |
|--------|-------|-------|
| 400 | `"command is required"` | Missing `command` in request body |
| 400 | `"Command exceeds 500 character limit"` | The `command` string is too long |
| 400 | `"Unable to parse command"` | The command could not be interpreted |
| 401 | `"Unauthorized"` | Missing or invalid API key |
| 404 | `"No managed wallet found"` | No wallet available and none specified in `wallet_address` |
| 500 | `"Execution failed"` | Internal error while processing the command |

## Code Examples

### curl

```bash
curl -X POST https://api.suwappu.bot/v1/agent/execute \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"command": "swap 0.5 ETH to USDC on base"}'
```

### Python

```python
import requests

response = requests.post(
    "https://api.suwappu.bot/v1/agent/execute",
    headers={"Authorization": "Bearer suwappu_sk_your_api_key"},
    json={"command": "swap 0.5 ETH to USDC on base"},
)

data = response.json()
if data["success"]:
    print(data)
```

### TypeScript

```typescript
const response = await fetch(
  "https://api.suwappu.bot/v1/agent/execute",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer suwappu_sk_your_api_key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      command: "swap 0.5 ETH to USDC on base",
    }),
  }
);

const data = await response.json();
if (data.success) {
  console.log(data);
}
```
