# Cross-Chain Swaps

Cross-chain swaps (bridging) let you move tokens between different blockchain networks through a single API call. Suwappu handles the routing, bridging protocol selection, and settlement automatically.

## How It Works

To perform a cross-chain swap, include both `from_chain` and `to_chain` parameters in your `POST /quote` request. When these differ, Suwappu routes the transaction through the optimal bridge.

```
POST /quote
{
  "from_token": "USDC",
  "to_token": "USDC",
  "amount": "1000",
  "from_chain": "ethereum",
  "to_chain": "arbitrum"
}
```

The quote response includes the expected output amount after bridge fees and slippage. Execute the quote the same way as a single-chain swap -- via `POST /swap/execute`.

## Important Considerations

- **Settlement time**: Cross-chain swaps take longer than same-chain swaps. Ethereum to L2 bridges typically complete in 1-15 minutes. L2 to L1 withdrawals can take longer depending on the bridge used.
- **Bridge fees**: The quoted output amount accounts for bridge fees. The `expected_output` field reflects what you will receive after all fees.
- **Status tracking**: Use `GET /swap/status/{swapId}` to poll for completion. Cross-chain swaps may stay in `"pending"` status longer than same-chain swaps.
- **Token availability**: Not all token pairs are available for cross-chain swaps. The quote endpoint will return an error if no route is found.

## Full Example: Bridge USDC from Ethereum to Arbitrum

### Step 1: Get a Cross-Chain Quote

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "from_token": "USDC",
    "to_token": "USDC",
    "amount": "1000",
    "from_chain": "ethereum",
    "to_chain": "arbitrum"
  }'
```

#### Example Response

```json
{
  "success": true,
  "quote_id": "qt_bridge_x1y2z3",
  "from_token": "USDC",
  "to_token": "USDC",
  "amount": "1000",
  "expected_output": "999.15",
  "from_chain": "ethereum",
  "to_chain": "arbitrum",
  "expires_at": "2026-03-07T12:05:00Z"
}
```

### Step 2: Execute the Swap

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer suwappu_sk_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "qt_bridge_x1y2z3"}'
```

#### Example Response

```json
{
  "success": true,
  "swap_id": 5201,
  "status": "submitted",
  "tx_hash": "0x7b2a...e91f"
}
```

### Step 3: Check Status Until Complete

```bash
curl https://api.suwappu.bot/v1/agent/swap/status/5201 \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

#### Example Response (in progress)

```json
{
  "success": true,
  "swap_id": 5201,
  "status": "pending",
  "tx_hash": "0x7b2a...e91f",
  "from_token": "USDC",
  "to_token": "USDC"
}
```

#### Example Response (completed)

```json
{
  "success": true,
  "swap_id": 5201,
  "status": "completed",
  "tx_hash": "0x7b2a...e91f",
  "from_token": "USDC",
  "to_token": "USDC"
}
```

## Python Example

```python
import requests
import time

API_KEY = "suwappu_sk_your_api_key"
BASE_URL = "https://api.suwappu.bot/v1/agent"
headers = {"Authorization": f"Bearer {API_KEY}"}

# Step 1: Get a cross-chain quote
quote_response = requests.post(
    f"{BASE_URL}/quote",
    headers=headers,
    json={
        "from_token": "USDC",
        "to_token": "USDC",
        "amount": "1000",
        "from_chain": "ethereum",
        "to_chain": "arbitrum",
    },
)
quote = quote_response.json()
print(f"Expected output: {quote['expected_output']} USDC on Arbitrum")

# Step 2: Execute the swap
swap_response = requests.post(
    f"{BASE_URL}/swap/execute",
    headers=headers,
    json={"quote_id": quote["quote_id"]},
)
swap = swap_response.json()
swap_id = swap["swap_id"]
print(f"Swap submitted: {swap_id}")

# Step 3: Poll for completion
while True:
    status_response = requests.get(
        f"{BASE_URL}/swap/status/{swap_id}",
        headers=headers,
    )
    status = status_response.json()
    print(f"Status: {status['status']}")

    if status["status"] in ("completed", "failed"):
        break

    time.sleep(10)  # Cross-chain swaps can take minutes

if status["status"] == "completed":
    print(f"Bridge complete! TX: {status['tx_hash']}")
else:
    print("Bridge failed.")
```

## TypeScript Example

```typescript
const API_KEY = "suwappu_sk_your_api_key";
const BASE_URL = "https://api.suwappu.bot/v1/agent";
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

// Step 1: Get a cross-chain quote
const quoteRes = await fetch(`${BASE_URL}/quote`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    from_token: "USDC",
    to_token: "USDC",
    amount: "1000",
    from_chain: "ethereum",
    to_chain: "arbitrum",
  }),
});
const quote = await quoteRes.json();
console.log(`Expected output: ${quote.expected_output} USDC on Arbitrum`);

// Step 2: Execute the swap
const swapRes = await fetch(`${BASE_URL}/swap/execute`, {
  method: "POST",
  headers,
  body: JSON.stringify({ quote_id: quote.quote_id }),
});
const swap = await swapRes.json();
const swapId = swap.swap_id;
console.log(`Swap submitted: ${swapId}`);

// Step 3: Poll for completion
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

while (true) {
  const statusRes = await fetch(`${BASE_URL}/swap/status/${swapId}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const status = await statusRes.json();
  console.log(`Status: ${status.status}`);

  if (status.status === "completed" || status.status === "failed") {
    if (status.status === "completed") {
      console.log(`Bridge complete! TX: ${status.tx_hash}`);
    } else {
      console.log("Bridge failed.");
    }
    break;
  }

  await sleep(10_000); // Cross-chain swaps can take minutes
}
```

## Supported Cross-Chain Routes

Cross-chain swaps are supported between all EVM chains. The most common routes include:

- Ethereum to/from L2s (Arbitrum, Optimism, Base)
- Between L2s (e.g., Arbitrum to Base)
- Stablecoin bridges (USDC, USDT) across any EVM pair

Use the `POST /quote` endpoint to check if a specific route is available. If no bridge route exists, the API returns an error with a descriptive message.
