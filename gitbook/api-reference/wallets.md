# Wallets

Managed wallets are custodial -- Suwappu holds the private key on your behalf so the server can sign and submit swap transactions without requiring you to manage keys or sign externally.

---

## List Wallets

`GET /wallets` | Auth: Required

Retrieve all managed wallets associated with your agent.

### Request

No parameters required.

### Response

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the request succeeded |
| `wallets` | array | List of wallet objects |

#### Wallet Object

| Field | Type | Description |
|-------|------|-------------|
| `address` | string | The wallet address |
| `chain_type` | string | `"evm"` or `"solana"` |
| `supported_chains` | array | List of chain names the wallet supports (e.g., `["ethereum", "base", "arbitrum"]`) |

### Example Response

```json
{
  "success": true,
  "wallets": [
    {
      "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
      "chain_type": "evm",
      "supported_chains": ["ethereum", "base", "arbitrum", "optimism"]
    },
    {
      "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      "chain_type": "solana",
      "supported_chains": ["solana"]
    }
  ]
}
```

---

## Create Wallet

`POST /wallets` | Auth: Required

Create a new managed wallet. No request body is needed. The server generates a new keypair and securely stores the private key for server-side swap execution.

### Request

No body required.

### Response (201 Created)

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the request succeeded |
| `wallet` | object | The newly created wallet |

#### Wallet Object

| Field | Type | Description |
|-------|------|-------------|
| `address` | string | The wallet address |
| `chain_type` | string | `"evm"` or `"solana"` |
| `supported_chains` | array | List of chain names the wallet supports |

### Example Response

```json
{
  "success": true,
  "wallet": {
    "address": "0x9f8E163C2b4a1FA28cE3851F2B3D5C53bE6a4E71",
    "chain_type": "evm",
    "supported_chains": ["ethereum", "base", "arbitrum", "optimism"]
  }
}
```

> **Note:** Managed wallets are custodial. Suwappu holds the private key so the server can sign transactions on your behalf via `POST /swap/execute`. You do not need to manage keys or submit raw transactions yourself.

---

## Errors

| Status | Error | Cause |
|--------|-------|-------|
| 401 | `"Unauthorized"` | Missing or invalid API key |
| 500 | `"Wallet creation failed"` | Internal error during key generation |

---

## Code Examples

### curl

```bash
# List wallets
curl https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer suwappu_sk_your_api_key"

# Create a wallet
curl -X POST https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

### Python

```python
import requests

headers = {"Authorization": "Bearer suwappu_sk_your_api_key"}

# List wallets
response = requests.get(
    "https://api.suwappu.bot/v1/agent/wallets",
    headers=headers,
)
data = response.json()
if data["success"]:
    for wallet in data["wallets"]:
        print(f"{wallet['chain_type']}: {wallet['address']}")

# Create a wallet
response = requests.post(
    "https://api.suwappu.bot/v1/agent/wallets",
    headers=headers,
)
data = response.json()
if data["success"]:
    print(f"Created: {data['wallet']['address']}")
```

### TypeScript

```typescript
const headers = {
  Authorization: "Bearer suwappu_sk_your_api_key",
};

// List wallets
const listResponse = await fetch(
  "https://api.suwappu.bot/v1/agent/wallets",
  { headers }
);
const listData = await listResponse.json();
if (listData.success) {
  for (const wallet of listData.wallets) {
    console.log(`${wallet.chain_type}: ${wallet.address}`);
  }
}

// Create a wallet
const createResponse = await fetch(
  "https://api.suwappu.bot/v1/agent/wallets",
  { method: "POST", headers }
);
const createData = await createResponse.json();
if (createData.success) {
  console.log(`Created: ${createData.wallet.address}`);
}
```
