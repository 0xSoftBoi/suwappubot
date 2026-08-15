# Wallets

Create and list your agent's managed (Turnkey) wallet. Managed wallets let Suwappu sign and broadcast swaps for you — the private key lives in a Turnkey secure enclave and is never exposed.

## POST /v1/agent/wallets

Create a managed EVM wallet for your agent. The wallet's address is bound to your agent and becomes the only address you can swap from and read balances for.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/wallets", {
  method: "POST",
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const wallet = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/wallets",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
)
wallet = res.json()
```

### Response (`201`)

```json
{
  "success": true,
  "wallet": {
    "address": "0xAbC...123",
    "chain_type": "evm",
    "supported_chains": ["ethereum", "polygon", "arbitrum", "optimism", "base", "bsc"]
  },
  "message": "Wallet created. Fund it to start swapping."
}
```

Fund the address before swapping. The same EVM address works across all supported EVM chains.

## GET /v1/agent/wallets

List your agent's wallet(s).

```bash
curl https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/wallets", {
  headers: { "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}` },
});
const wallets = await res.json();
```
```python
import os, requests

res = requests.get(
    "https://api.suwappu.bot/v1/agent/wallets",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
)
wallets = res.json()
```

### Response

```json
{
  "success": true,
  "wallets": [
    {
      "address": "0xAbC...123",
      "chain_type": "evm",
      "supported_chains": ["ethereum", "polygon", "arbitrum", "optimism", "base", "bsc", "avalanche"]
    }
  ]
}
```

If no wallet exists yet, `wallets` is an empty array with a hint to create one.

## Wallet policies

Attach Turnkey policies to constrain what your managed wallet can do — spending limits and address whitelists — using these endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/agent/wallet/policy` | POST | Create a `spending_limit` or `whitelist` policy |
| `/v1/agent/wallet/policies` | GET | List policies on your wallet |
| `/v1/agent/wallet/policy/:policyId` | DELETE | Delete an agent-created policy |

**Create a spending limit:**

```bash
curl -X POST https://api.suwappu.bot/v1/agent/wallet/policy \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type": "spending_limit", "params": {"maxAmountWei": "1000000000000000000", "timeWindowSeconds": 86400}}'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/wallet/policy", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ type: "spending_limit", params: { maxAmountWei: "1000000000000000000", timeWindowSeconds: 86400 } }),
});
const policy = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/wallet/policy",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    json={"type": "spending_limit", "params": {"maxAmountWei": "1000000000000000000", "timeWindowSeconds": 86400}},
)
policy = res.json()
```

**Create an address whitelist:**

```bash
curl -X POST https://api.suwappu.bot/v1/agent/wallet/policy \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type": "whitelist", "params": {"allowedAddresses": ["0x1111...", "0x2222..."]}}'
```
```typescript
const res = await fetch("https://api.suwappu.bot/v1/agent/wallet/policy", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.SUWAPPU_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ type: "whitelist", params: { allowedAddresses: ["0x1111...", "0x2222..."] } }),
});
const policy = await res.json();
```
```python
import os, requests

res = requests.post(
    "https://api.suwappu.bot/v1/agent/wallet/policy",
    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},
    json={"type": "whitelist", "params": {"allowedAddresses": ["0x1111...", "0x2222..."]}},
)
policy = res.json()
```

You can only delete policies your agent created; admin/guardrail policies are protected.

### Errors

| Status | Cause |
|--------|-------|
| `400` | No managed wallet found, or invalid policy body |
| `401` | Missing or invalid API key |
