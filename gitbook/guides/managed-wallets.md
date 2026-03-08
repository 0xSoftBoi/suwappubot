# Managed Wallets

Managed wallets let your agent execute swaps without handling private keys. Suwappu generates the keypair, stores the private key securely, and signs transactions on your behalf when you call `POST /swap/execute`.

## How It Works

1. **Create a wallet** -- `POST /wallets` generates a new keypair server-side
2. **Fund the wallet** -- Send tokens to the wallet address using an external wallet or exchange
3. **Get a quote** -- `POST /quote` to get swap pricing
4. **Execute** -- `POST /swap/execute` signs and submits the transaction using your managed wallet's private key

You never see or handle the private key. The server does all signing.

## Wallet Types

| Type | Chains Supported | Address Format |
|------|-----------------|----------------|
| EVM | All 12 EVM chains (Ethereum, Base, Arbitrum, etc.) | `0x...` (42 characters) |
| Solana | Solana | Base58 (32-44 characters) |

A single EVM wallet works across all EVM chains. Solana requires a separate wallet.

## Step-by-Step Workflow

### Step 1: Create a Wallet

```bash
curl -X POST https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

#### Response

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

### Step 2: List Your Wallets

```bash
curl https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

#### Response

```json
{
  "success": true,
  "wallets": [
    {
      "address": "0x9f8E163C2b4a1FA28cE3851F2B3D5C53bE6a4E71",
      "chain_type": "evm",
      "supported_chains": ["ethereum", "base", "arbitrum", "optimism"]
    }
  ]
}
```

### Step 3: Fund the Wallet

Send tokens to the wallet address from any external source (exchange, another wallet, faucet for testnets). The wallet address works like any standard address on its supported chains.

For EVM wallets, send tokens on any supported EVM chain to the same `0x` address. For Solana, send SPL tokens or SOL to the Base58 address.

### Step 4: Get a Quote

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "from_token": "ETH",
    "to_token": "USDC",
    "amount": "0.5",
    "chain": "base"
  }'
```

#### Response

```json
{
  "success": true,
  "quote_id": "qt_a1b2c3d4e5f6",
  "from_token": "ETH",
  "to_token": "USDC",
  "amount": "0.5",
  "expected_output": "985.42",
  "chain": "base",
  "expires_at": "2026-03-07T12:05:00Z"
}
```

### Step 5: Execute the Swap

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "qt_a1b2c3d4e5f6"}'
```

#### Response

```json
{
  "success": true,
  "swap_id": 4821,
  "status": "submitted",
  "tx_hash": "0x8a3c...f29e"
}
```

### Step 6: Check Status

```bash
curl https://api.suwappu.bot/v1/agent/swap/status/4821 \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

## Complete Example: curl

```bash
API_KEY="suwappu_sk_your_api_key"
BASE="https://api.suwappu.bot/v1/agent"

# Create a wallet
curl -X POST "$BASE/wallets" \
  -H "Authorization: Bearer $API_KEY"

# List wallets to confirm
curl "$BASE/wallets" \
  -H "Authorization: Bearer $API_KEY"

# Get a quote (after funding the wallet)
QUOTE_RESPONSE=$(curl -s -X POST "$BASE/quote" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from_token": "ETH",
    "to_token": "USDC",
    "amount": "0.1",
    "chain": "base"
  }')

QUOTE_ID=$(echo "$QUOTE_RESPONSE" | jq -r '.quote_id')
echo "Quote ID: $QUOTE_ID"

# Execute the swap
SWAP_RESPONSE=$(curl -s -X POST "$BASE/swap/execute" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"quote_id\": \"$QUOTE_ID\"}")

SWAP_ID=$(echo "$SWAP_RESPONSE" | jq -r '.swap_id')
echo "Swap ID: $SWAP_ID"

# Check status
curl "$BASE/swap/status/$SWAP_ID" \
  -H "Authorization: Bearer $API_KEY"
```

## Complete Example: Python

```python
import requests
import time

API_KEY = "suwappu_sk_your_api_key"
BASE_URL = "https://api.suwappu.bot/v1/agent"
headers = {"Authorization": f"Bearer {API_KEY}"}

# Create a managed wallet
wallet = requests.post(f"{BASE_URL}/wallets", headers=headers).json()
address = wallet["wallet"]["address"]
print(f"Wallet created: {address}")
print(f"Fund this address with tokens, then continue.")

# List wallets
wallets = requests.get(f"{BASE_URL}/wallets", headers=headers).json()
for w in wallets["wallets"]:
    print(f"  {w['chain_type']}: {w['address']}")

# After funding, get a quote
quote = requests.post(
    f"{BASE_URL}/quote",
    headers=headers,
    json={
        "from_token": "ETH",
        "to_token": "USDC",
        "amount": "0.1",
        "chain": "base",
    },
).json()
print(f"Quote: {quote['expected_output']} USDC for 0.1 ETH")

# Execute
swap = requests.post(
    f"{BASE_URL}/swap/execute",
    headers=headers,
    json={"quote_id": quote["quote_id"]},
).json()
print(f"Swap {swap['swap_id']}: {swap['status']}")

# Poll for completion
while True:
    status = requests.get(
        f"{BASE_URL}/swap/status/{swap['swap_id']}",
        headers=headers,
    ).json()
    if status["status"] in ("completed", "failed"):
        print(f"Final: {status['status']}, tx: {status['tx_hash']}")
        break
    time.sleep(5)
```

## Complete Example: TypeScript

```typescript
const API_KEY = "suwappu_sk_your_api_key";
const BASE_URL = "https://api.suwappu.bot/v1/agent";
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

// Create a managed wallet
const walletRes = await fetch(`${BASE_URL}/wallets`, {
  method: "POST",
  headers,
});
const wallet = await walletRes.json();
console.log(`Wallet created: ${wallet.wallet.address}`);

// List wallets
const listRes = await fetch(`${BASE_URL}/wallets`, { headers });
const list = await listRes.json();
for (const w of list.wallets) {
  console.log(`  ${w.chain_type}: ${w.address}`);
}

// After funding, get a quote
const quoteRes = await fetch(`${BASE_URL}/quote`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    from_token: "ETH",
    to_token: "USDC",
    amount: "0.1",
    chain: "base",
  }),
});
const quote = await quoteRes.json();
console.log(`Quote: ${quote.expected_output} USDC for 0.1 ETH`);

// Execute
const swapRes = await fetch(`${BASE_URL}/swap/execute`, {
  method: "POST",
  headers,
  body: JSON.stringify({ quote_id: quote.quote_id }),
});
const swap = await swapRes.json();
console.log(`Swap ${swap.swap_id}: ${swap.status}`);

// Poll for completion
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

while (true) {
  const statusRes = await fetch(`${BASE_URL}/swap/status/${swap.swap_id}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const status = await statusRes.json();
  if (status.status === "completed" || status.status === "failed") {
    console.log(`Final: ${status.status}, tx: ${status.tx_hash}`);
    break;
  }
  await sleep(5000);
}
```
