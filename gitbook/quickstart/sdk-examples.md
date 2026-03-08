# SDK Examples

Complete, runnable scripts that perform the full swap flow: register an agent, get a quote, execute a swap, and check the status.

---

## Bash (curl)

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="https://api.suwappu.bot/v1/agent"

# Step 1: Register
echo "Registering agent..."
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/register" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-trading-bot","description":"Automated trading agent"}')

API_KEY=$(echo "$REGISTER_RESPONSE" | jq -r '.agent.api_key')
AGENT_ID=$(echo "$REGISTER_RESPONSE" | jq -r '.agent.id')
echo "Agent registered: $AGENT_ID"
echo "API key: $API_KEY"

# Step 2: Get a quote
echo ""
echo "Requesting quote..."
QUOTE_RESPONSE=$(curl -s -X POST "$BASE_URL/quote" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d '{
    "from_token": "USDC",
    "to_token": "ETH",
    "amount": "500.00",
    "chain": "ethereum"
  }')

QUOTE_ID=$(echo "$QUOTE_RESPONSE" | jq -r '.quote.quote_id')
AMOUNT_OUT=$(echo "$QUOTE_RESPONSE" | jq -r '.quote.amount_out')
EXPIRES=$(echo "$QUOTE_RESPONSE" | jq -r '.quote.expires_in_seconds')
echo "Quote ID: $QUOTE_ID"
echo "You will receive: $AMOUNT_OUT ETH"
echo "Quote expires in: ${EXPIRES}s"

# Step 3: Execute the swap
echo ""
echo "Executing swap..."
SWAP_RESPONSE=$(curl -s -X POST "$BASE_URL/swap/execute" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{\"quote_id\": \"$QUOTE_ID\"}")

SWAP_ID=$(echo "$SWAP_RESPONSE" | jq -r '.swap.swap_id')
TX_HASH=$(echo "$SWAP_RESPONSE" | jq -r '.swap.tx_hash')
echo "Swap ID: $SWAP_ID"
echo "Tx hash: $TX_HASH"

# Step 4: Poll for completion
echo ""
echo "Checking status..."
for i in $(seq 1 10); do
  STATUS_RESPONSE=$(curl -s -X GET "$BASE_URL/swap/status/$SWAP_ID" \
    -H "Authorization: Bearer $API_KEY")

  STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.swap.status')
  echo "  Attempt $i: status=$STATUS"

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ]; then
    echo ""
    echo "$STATUS_RESPONSE" | jq .
    break
  fi

  sleep 2
done
```

---

## Python

Requires Python 3.7+ and the `requests` library (`pip install requests`).

```python
#!/usr/bin/env python3
"""Suwappu Agent API — full swap flow example."""

import time
import requests

BASE_URL = "https://api.suwappu.bot/v1/agent"


def main():
    # Step 1: Register
    print("Registering agent...")
    register_resp = requests.post(
        f"{BASE_URL}/register",
        json={
            "name": "my-trading-bot",
            "description": "Automated trading agent",
        },
    )
    register_resp.raise_for_status()
    register_data = register_resp.json()

    api_key = register_data["agent"]["api_key"]
    agent_id = register_data["agent"]["id"]
    print(f"Agent registered: {agent_id}")
    print(f"API key: {api_key}")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    # Step 2: Get a quote
    print("\nRequesting quote...")
    quote_resp = requests.post(
        f"{BASE_URL}/quote",
        headers=headers,
        json={
            "from_token": "USDC",
            "to_token": "ETH",
            "amount": "500.00",
            "chain": "ethereum",
        },
    )
    quote_resp.raise_for_status()
    quote_data = quote_resp.json()

    quote_id = quote_data["quote"]["quote_id"]
    amount_out = quote_data["quote"]["amount_out"]
    expires = quote_data["quote"]["expires_in_seconds"]
    print(f"Quote ID: {quote_id}")
    print(f"You will receive: {amount_out} ETH")
    print(f"Quote expires in: {expires}s")

    # Step 3: Execute the swap
    print("\nExecuting swap...")
    swap_resp = requests.post(
        f"{BASE_URL}/swap/execute",
        headers=headers,
        json={"quote_id": quote_id},
    )
    swap_resp.raise_for_status()
    swap_data = swap_resp.json()

    swap_id = swap_data["swap"]["swap_id"]
    tx_hash = swap_data["swap"]["tx_hash"]
    print(f"Swap ID: {swap_id}")
    print(f"Tx hash: {tx_hash}")

    # Step 4: Poll for completion
    print("\nChecking status...")
    for attempt in range(1, 11):
        status_resp = requests.get(
            f"{BASE_URL}/swap/status/{swap_id}",
            headers=headers,
        )
        status_resp.raise_for_status()
        status_data = status_resp.json()

        status = status_data["swap"]["status"]
        print(f"  Attempt {attempt}: status={status}")

        if status in ("completed", "failed"):
            print()
            import json
            print(json.dumps(status_data, indent=2))
            break

        time.sleep(2)


if __name__ == "__main__":
    main()
```

---

## TypeScript

Requires Node.js 18+ (for native `fetch`). No external dependencies needed.

```typescript
// suwappu-swap.ts
// Run with: npx tsx suwappu-swap.ts

const BASE_URL = "https://api.suwappu.bot/v1/agent";

interface RegisterResponse {
  success: boolean;
  agent: {
    id: string;
    name: string;
    api_key: string;
    created_at: string;
  };
}

interface QuoteResponse {
  success: boolean;
  quote: {
    quote_id: string;
    from_token: string;
    to_token: string;
    amount_in: string;
    amount_out: string;
    exchange_rate: string;
    price_impact: string;
    fee: string;
    expires_in_seconds: number;
  };
}

interface SwapResponse {
  success: boolean;
  swap: {
    swap_id: string;
    status: string;
    tx_hash: string;
    from_token: string;
    to_token: string;
    amount_in: string;
    amount_out: string;
    created_at: string;
  };
}

interface StatusResponse {
  success: boolean;
  swap: {
    swap_id: string;
    status: string;
    tx_hash: string;
    from_token: string;
    to_token: string;
    amount_in: string;
    amount_out: string;
    chain: string;
    created_at: string;
    completed_at?: string;
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  // Step 1: Register
  console.log("Registering agent...");
  const registerResp = await fetch(`${BASE_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "my-trading-bot",
      description: "Automated trading agent",
    }),
  });

  if (!registerResp.ok) {
    throw new Error(`Registration failed: ${registerResp.status}`);
  }

  const registerData: RegisterResponse = await registerResp.json();
  const apiKey = registerData.agent.api_key;
  console.log(`Agent registered: ${registerData.agent.id}`);
  console.log(`API key: ${apiKey}`);

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // Step 2: Get a quote
  console.log("\nRequesting quote...");
  const quoteResp = await fetch(`${BASE_URL}/quote`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      from_token: "USDC",
      to_token: "ETH",
      amount: "500.00",
      chain: "ethereum",
    }),
  });

  if (!quoteResp.ok) {
    throw new Error(`Quote request failed: ${quoteResp.status}`);
  }

  const quoteData: QuoteResponse = await quoteResp.json();
  const quoteId = quoteData.quote.quote_id;
  console.log(`Quote ID: ${quoteId}`);
  console.log(`You will receive: ${quoteData.quote.amount_out} ETH`);
  console.log(`Quote expires in: ${quoteData.quote.expires_in_seconds}s`);

  // Step 3: Execute the swap
  console.log("\nExecuting swap...");
  const swapResp = await fetch(`${BASE_URL}/swap/execute`, {
    method: "POST",
    headers,
    body: JSON.stringify({ quote_id: quoteId }),
  });

  if (!swapResp.ok) {
    throw new Error(`Swap execution failed: ${swapResp.status}`);
  }

  const swapData: SwapResponse = await swapResp.json();
  const swapId = swapData.swap.swap_id;
  console.log(`Swap ID: ${swapId}`);
  console.log(`Tx hash: ${swapData.swap.tx_hash}`);

  // Step 4: Poll for completion
  console.log("\nChecking status...");
  for (let attempt = 1; attempt <= 10; attempt++) {
    const statusResp = await fetch(`${BASE_URL}/swap/status/${swapId}`, {
      headers,
    });

    if (!statusResp.ok) {
      throw new Error(`Status check failed: ${statusResp.status}`);
    }

    const statusData: StatusResponse = await statusResp.json();
    const status = statusData.swap.status;
    console.log(`  Attempt ${attempt}: status=${status}`);

    if (status === "completed" || status === "failed") {
      console.log();
      console.log(JSON.stringify(statusData, null, 2));
      break;
    }

    await sleep(2000);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
```
