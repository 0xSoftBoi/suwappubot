# Building a Trading Bot

This guide walks through building an automated trading bot from scratch. By the end, you will have a runnable script that registers an agent, creates a managed wallet, monitors token prices, and executes swaps when conditions are met.

## What the Bot Does

1. Registers with the Suwappu API and saves the API key
2. Creates a managed wallet for server-side swap execution
3. Polls token prices in a loop
4. Executes a swap when a price target is hit
5. Tracks the swap status until completion
6. Handles errors and rate limits gracefully

## Python Version

```python
#!/usr/bin/env python3
"""
Suwappu Trading Bot — Python
Monitors ETH/USDC price on Base and buys when price drops below target.
"""

import os
import sys
import time
import requests

BASE_URL = "https://api.suwappu.bot/v1/agent"

# Configuration
CHAIN = "base"
FROM_TOKEN = "USDC"
TO_TOKEN = "ETH"
BUY_AMOUNT = "100"          # Buy 100 USDC worth of ETH
PRICE_TARGET = 2000.0       # Buy when ETH drops below $2000
POLL_INTERVAL = 30          # Check price every 30 seconds
MAX_RETRIES = 3             # Retry failed requests up to 3 times


def register_agent():
    """Register a new agent and return the API key."""
    response = requests.post(
        f"{BASE_URL}/register",
        json={"name": f"trading-bot-{int(time.time())}"},
    )
    response.raise_for_status()
    data = response.json()
    api_key = data["agent"]["api_key"]
    print(f"Registered agent: {data['agent']['name']}")
    print(f"API key: {api_key[:20]}...")
    return api_key


def create_wallet(headers):
    """Create a managed wallet for swap execution."""
    response = requests.post(f"{BASE_URL}/wallets", headers=headers)
    response.raise_for_status()
    wallet = response.json()["wallet"]
    print(f"Wallet created: {wallet['address']}")
    print(f"Chain type: {wallet['chain_type']}")
    print(f"Fund this wallet with {FROM_TOKEN} on {CHAIN} to start trading.")
    return wallet["address"]


def get_price(headers, token, chain):
    """Fetch the current USD price for a token."""
    response = requests.get(
        f"{BASE_URL}/prices",
        headers=headers,
        params={"token": token, "chain": chain},
    )
    response.raise_for_status()
    return float(response.json()["price_usd"])


def execute_swap(headers, from_token, to_token, amount, chain):
    """Get a quote and execute a swap. Returns the swap ID."""
    # Step 1: Get a quote
    quote_response = requests.post(
        f"{BASE_URL}/quote",
        headers=headers,
        json={
            "from_token": from_token,
            "to_token": to_token,
            "amount": amount,
            "chain": chain,
        },
    )
    quote_response.raise_for_status()
    quote = quote_response.json()
    print(f"Quote: {amount} {from_token} -> {quote['expected_output']} {to_token}")

    # Step 2: Execute
    swap_response = requests.post(
        f"{BASE_URL}/swap/execute",
        headers=headers,
        json={"quote_id": quote["quote_id"]},
    )
    swap_response.raise_for_status()
    swap = swap_response.json()
    print(f"Swap submitted: ID {swap['swap_id']}, tx: {swap.get('tx_hash', 'pending')}")
    return swap["swap_id"]


def wait_for_completion(headers, swap_id):
    """Poll swap status until it completes or fails."""
    while True:
        response = requests.get(
            f"{BASE_URL}/swap/status/{swap_id}",
            headers=headers,
        )
        response.raise_for_status()
        status = response.json()
        print(f"  Swap {swap_id}: {status['status']}")

        if status["status"] == "completed":
            print(f"  Completed! TX: {status['tx_hash']}")
            return True
        elif status["status"] == "failed":
            print(f"  Failed.")
            return False

        time.sleep(5)


def main():
    # Use existing API key or register a new agent
    api_key = os.environ.get("SUWAPPU_API_KEY")
    if not api_key:
        print("No SUWAPPU_API_KEY found. Registering new agent...")
        api_key = register_agent()
        print(f"\nSet this for future runs:")
        print(f"  export SUWAPPU_API_KEY={api_key}\n")

    headers = {"Authorization": f"Bearer {api_key}"}

    # Check for existing wallets or create one
    wallets = requests.get(f"{BASE_URL}/wallets", headers=headers).json()
    if not wallets.get("wallets"):
        print("No wallets found. Creating one...")
        address = create_wallet(headers)
        print(f"\nFund {address} with {FROM_TOKEN} on {CHAIN}, then restart.\n")
        sys.exit(0)
    else:
        address = wallets["wallets"][0]["address"]
        print(f"Using wallet: {address}")

    # Price monitoring loop
    print(f"\nMonitoring {TO_TOKEN} price on {CHAIN}...")
    print(f"Will buy {BUY_AMOUNT} {FROM_TOKEN} worth of {TO_TOKEN} when price < ${PRICE_TARGET}")
    print(f"Checking every {POLL_INTERVAL}s. Press Ctrl+C to stop.\n")

    retries = 0
    while True:
        try:
            price = get_price(headers, TO_TOKEN, CHAIN)
            print(f"{TO_TOKEN}: ${price:.2f}", end="")

            if price < PRICE_TARGET:
                print(f" < ${PRICE_TARGET} -- BUYING!")
                swap_id = execute_swap(
                    headers, FROM_TOKEN, TO_TOKEN, BUY_AMOUNT, CHAIN
                )
                success = wait_for_completion(headers, swap_id)
                if success:
                    print("Trade executed successfully.")
                else:
                    print("Trade failed. Will retry on next signal.")
            else:
                print(f" (target: < ${PRICE_TARGET})")

            retries = 0  # Reset retries on success

        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 429:
                retries += 1
                wait = min(60, POLL_INTERVAL * retries)
                print(f"Rate limited. Waiting {wait}s... (retry {retries}/{MAX_RETRIES})")
                time.sleep(wait)
                if retries >= MAX_RETRIES:
                    print("Max retries reached. Exiting.")
                    sys.exit(1)
                continue
            else:
                print(f"HTTP error: {e}")
                retries += 1
                if retries >= MAX_RETRIES:
                    print("Max retries reached. Exiting.")
                    sys.exit(1)

        except KeyboardInterrupt:
            print("\nStopped.")
            sys.exit(0)

        except Exception as e:
            print(f"Error: {e}")
            retries += 1
            if retries >= MAX_RETRIES:
                print("Max retries reached. Exiting.")
                sys.exit(1)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
```

### Running the Python Bot

```bash
# Install dependencies
pip install requests

# First run: registers agent and creates wallet
python trading_bot.py

# Set the API key for future runs
export SUWAPPU_API_KEY=suwappu_sk_your_api_key

# Fund the wallet address printed above, then run again
python trading_bot.py
```

---

## TypeScript Version

```typescript
#!/usr/bin/env npx tsx
/**
 * Suwappu Trading Bot — TypeScript
 * Monitors ETH/USDC price on Base and buys when price drops below target.
 */

const BASE_URL = "https://api.suwappu.bot/v1/agent";

// Configuration
const CHAIN = "base";
const FROM_TOKEN = "USDC";
const TO_TOKEN = "ETH";
const BUY_AMOUNT = "100";
const PRICE_TARGET = 2000.0;
const POLL_INTERVAL = 30_000; // 30 seconds
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(
  path: string,
  options: RequestInit & { params?: Record<string, string> } = {},
  apiKey?: string
) {
  const { params, ...fetchOptions } = options;
  let url = `${BASE_URL}${path}`;
  if (params) url += `?${new URLSearchParams(params)}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(url, { ...fetchOptions, headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  if (response.status === 204) return {};
  return response.json();
}

async function registerAgent(): Promise<string> {
  const data = await api("/register", {
    method: "POST",
    body: JSON.stringify({ name: `trading-bot-${Date.now()}` }),
  });
  const apiKey = data.agent.api_key;
  console.log(`Registered agent: ${data.agent.name}`);
  console.log(`API key: ${apiKey.slice(0, 20)}...`);
  return apiKey;
}

async function createWallet(apiKey: string): Promise<string> {
  const data = await api("/wallets", { method: "POST" }, apiKey);
  const wallet = data.wallet;
  console.log(`Wallet created: ${wallet.address}`);
  console.log(`Chain type: ${wallet.chain_type}`);
  console.log(`Fund this wallet with ${FROM_TOKEN} on ${CHAIN} to start trading.`);
  return wallet.address;
}

async function getPrice(apiKey: string, token: string, chain: string): Promise<number> {
  const data = await api("/prices", { params: { token, chain } }, apiKey);
  return parseFloat(data.price_usd);
}

async function executeSwap(
  apiKey: string,
  fromToken: string,
  toToken: string,
  amount: string,
  chain: string
): Promise<number> {
  // Get a quote
  const quote = await api(
    "/quote",
    {
      method: "POST",
      body: JSON.stringify({
        from_token: fromToken,
        to_token: toToken,
        amount,
        chain,
      }),
    },
    apiKey
  );
  console.log(`Quote: ${amount} ${fromToken} -> ${quote.expected_output} ${toToken}`);

  // Execute
  const swap = await api(
    "/swap/execute",
    {
      method: "POST",
      body: JSON.stringify({ quote_id: quote.quote_id }),
    },
    apiKey
  );
  console.log(`Swap submitted: ID ${swap.swap_id}, tx: ${swap.tx_hash ?? "pending"}`);
  return swap.swap_id;
}

async function waitForCompletion(apiKey: string, swapId: number): Promise<boolean> {
  while (true) {
    const status = await api(`/swap/status/${swapId}`, {}, apiKey);
    console.log(`  Swap ${swapId}: ${status.status}`);

    if (status.status === "completed") {
      console.log(`  Completed! TX: ${status.tx_hash}`);
      return true;
    }
    if (status.status === "failed") {
      console.log(`  Failed.`);
      return false;
    }

    await sleep(5000);
  }
}

async function main() {
  // Use existing API key or register a new agent
  let apiKey = process.env.SUWAPPU_API_KEY;
  if (!apiKey) {
    console.log("No SUWAPPU_API_KEY found. Registering new agent...");
    apiKey = await registerAgent();
    console.log(`\nSet this for future runs:`);
    console.log(`  export SUWAPPU_API_KEY=${apiKey}\n`);
  }

  // Check for existing wallets or create one
  const walletData = await api("/wallets", {}, apiKey);
  if (!walletData.wallets?.length) {
    console.log("No wallets found. Creating one...");
    const address = await createWallet(apiKey);
    console.log(`\nFund ${address} with ${FROM_TOKEN} on ${CHAIN}, then restart.\n`);
    process.exit(0);
  }

  const address = walletData.wallets[0].address;
  console.log(`Using wallet: ${address}`);

  // Price monitoring loop
  console.log(`\nMonitoring ${TO_TOKEN} price on ${CHAIN}...`);
  console.log(
    `Will buy ${BUY_AMOUNT} ${FROM_TOKEN} worth of ${TO_TOKEN} when price < $${PRICE_TARGET}`
  );
  console.log(`Checking every ${POLL_INTERVAL / 1000}s. Press Ctrl+C to stop.\n`);

  let retries = 0;

  while (true) {
    try {
      const price = await getPrice(apiKey, TO_TOKEN, CHAIN);
      process.stdout.write(`${TO_TOKEN}: $${price.toFixed(2)}`);

      if (price < PRICE_TARGET) {
        console.log(` < $${PRICE_TARGET} -- BUYING!`);
        const swapId = await executeSwap(apiKey, FROM_TOKEN, TO_TOKEN, BUY_AMOUNT, CHAIN);
        const success = await waitForCompletion(apiKey, swapId);
        console.log(success ? "Trade executed successfully." : "Trade failed. Will retry.");
      } else {
        console.log(` (target: < $${PRICE_TARGET})`);
      }

      retries = 0;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("429")) {
        retries++;
        const wait = Math.min(60_000, POLL_INTERVAL * retries);
        console.log(`Rate limited. Waiting ${wait / 1000}s... (retry ${retries}/${MAX_RETRIES})`);
        await sleep(wait);
        if (retries >= MAX_RETRIES) {
          console.log("Max retries reached. Exiting.");
          process.exit(1);
        }
        continue;
      }

      console.error(`Error: ${message}`);
      retries++;
      if (retries >= MAX_RETRIES) {
        console.log("Max retries reached. Exiting.");
        process.exit(1);
      }
    }

    await sleep(POLL_INTERVAL);
  }
}

main().catch(console.error);
```

### Running the TypeScript Bot

```bash
# Install tsx for running TypeScript directly
npm install -g tsx

# First run: registers agent and creates wallet
npx tsx trading_bot.ts

# Set the API key for future runs
export SUWAPPU_API_KEY=suwappu_sk_your_api_key

# Fund the wallet address printed above, then run again
npx tsx trading_bot.ts
```

---

## Customizing the Bot

### Different Trading Strategies

The bot above uses a simple "buy below target price" strategy. Here are ideas for modifications:

**Dollar-cost averaging (DCA):** Remove the price check and buy a fixed amount at regular intervals.

```python
# Replace the price check with a simple timer
while True:
    swap_id = execute_swap(headers, FROM_TOKEN, TO_TOKEN, BUY_AMOUNT, CHAIN)
    wait_for_completion(headers, swap_id)
    time.sleep(3600)  # Buy every hour
```

**Sell above target:** Reverse the token pair and condition.

```python
FROM_TOKEN = "ETH"
TO_TOKEN = "USDC"
BUY_AMOUNT = "0.05"
PRICE_TARGET = 2500.0  # Sell when ETH is above $2500

# In the loop:
if price > PRICE_TARGET:
    execute_swap(...)
```

**Multi-chain monitoring:** Check prices across different chains and swap where the best rate is.

### Error Handling Tips

- **Rate limits**: The bot handles 429 responses with exponential backoff. The standard tier allows 60 requests per minute.
- **Quote expiration**: Quotes expire after a few minutes. The bot gets a fresh quote before each swap.
- **Network errors**: Transient failures (timeouts, 500s) are retried up to `MAX_RETRIES` times before exiting.
- **Insufficient balance**: If your wallet does not have enough tokens, the swap execution will fail. Check your wallet balance before trading.
