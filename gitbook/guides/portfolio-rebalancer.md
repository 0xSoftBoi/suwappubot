# Portfolio Rebalancer

This guide builds a portfolio rebalancer that reads your wallet holdings, compares actual vs. target allocations, calculates drift, and executes the minimum swaps needed to bring your portfolio back in line. It demonstrates multi-endpoint REST API orchestration across portfolio, price, quote, and swap endpoints.

## What the Script Does

1. Loads your API key and wallet address from environment variables
2. Fetches current portfolio holdings via `GET /portfolio`
3. Fetches current prices via `GET /prices`
4. Calculates each token's actual allocation percentage vs. your targets
5. Identifies tokens that have drifted beyond a configurable threshold (default: 5%)
6. Generates a swap plan — sell overweight tokens, buy underweight tokens
7. Executes each swap via `POST /quote` + `POST /swap/execute`
8. Tracks each swap to completion via `GET /swap/status/:id`
9. Prints a before/after allocation table

## Python Version

```python
#!/usr/bin/env python3
"""
Suwappu Portfolio Rebalancer — Python
Reads your portfolio, compares to target allocations, and swaps to rebalance.
"""

import os
import sys
import time
import requests

BASE_URL = "https://api.suwappu.bot/v1/agent"

# --- Configuration ---
# Target allocations must sum to 100
TARGET_ALLOCATIONS = {
    "ETH": 50,
    "USDC": 30,
    "WBTC": 20,
}
CHAIN = "ethereum"
DRIFT_THRESHOLD = 5.0  # Only rebalance if a token is >5% off target
SLIPPAGE = 0.01        # 1% max slippage


def get_portfolio(headers, wallet_address):
    """Fetch current portfolio balances."""
    response = requests.get(
        f"{BASE_URL}/portfolio",
        headers=headers,
        params={"wallet_address": wallet_address, "chain": CHAIN},
    )
    response.raise_for_status()
    return response.json()


def get_prices(headers, symbols):
    """Fetch current USD prices for the given symbols."""
    response = requests.get(
        f"{BASE_URL}/prices",
        headers=headers,
        params={"symbols": ",".join(symbols)},
    )
    response.raise_for_status()
    return response.json()["prices"]


def get_quote(headers, from_token, to_token, amount):
    """Get a swap quote."""
    response = requests.post(
        f"{BASE_URL}/quote",
        headers=headers,
        json={
            "from_token": from_token,
            "to_token": to_token,
            "amount": str(amount),
            "chain": CHAIN,
            "slippage": SLIPPAGE,
        },
    )
    response.raise_for_status()
    return response.json()


def execute_swap(headers, quote_id):
    """Execute a swap from a quote."""
    response = requests.post(
        f"{BASE_URL}/swap/execute",
        headers=headers,
        json={"quote_id": quote_id},
    )
    response.raise_for_status()
    return response.json()


def wait_for_swap(headers, swap_id):
    """Poll swap status until completed or failed."""
    while True:
        response = requests.get(
            f"{BASE_URL}/swap/status/{swap_id}",
            headers=headers,
        )
        response.raise_for_status()
        status = response.json()

        if status["status"] == "completed":
            print(f"    ✓ Swap {swap_id} completed (tx: {status['tx_hash']})")
            return True
        elif status["status"] == "failed":
            print(f"    ✗ Swap {swap_id} failed")
            return False

        time.sleep(5)


def calculate_allocations(balances, prices):
    """Calculate current allocation percentages from balances and prices."""
    total_usd = 0.0
    holdings = {}

    for bal in balances:
        symbol = bal["symbol"]
        if symbol in TARGET_ALLOCATIONS:
            usd_value = bal["usd_value"]
            holdings[symbol] = {
                "balance": float(bal["balance"]),
                "usd_value": usd_value,
            }
            total_usd += usd_value

    # Add missing target tokens with zero balance
    for symbol in TARGET_ALLOCATIONS:
        if symbol not in holdings:
            holdings[symbol] = {"balance": 0.0, "usd_value": 0.0}

    # Calculate percentages
    for symbol in holdings:
        if total_usd > 0:
            holdings[symbol]["actual_pct"] = (holdings[symbol]["usd_value"] / total_usd) * 100
        else:
            holdings[symbol]["actual_pct"] = 0.0
        holdings[symbol]["target_pct"] = TARGET_ALLOCATIONS[symbol]
        holdings[symbol]["drift"] = holdings[symbol]["actual_pct"] - holdings[symbol]["target_pct"]

    return holdings, total_usd


def print_allocation_table(holdings, label):
    """Print a formatted allocation table."""
    print(f"\n{'=' * 55}")
    print(f"  {label}")
    print(f"{'=' * 55}")
    print(f"  {'Token':<8} {'Balance':>10} {'USD Value':>12} {'Actual':>8} {'Target':>8}")
    print(f"  {'-' * 50}")
    for symbol, data in sorted(holdings.items()):
        print(
            f"  {symbol:<8} {data['balance']:>10.4f} "
            f"${data['usd_value']:>10.2f} "
            f"{data['actual_pct']:>7.1f}% "
            f"{data['target_pct']:>7.1f}%"
        )
    print()


def generate_swap_plan(holdings, total_usd, prices):
    """Generate the minimum set of swaps to rebalance.

    Strategy: sell overweight tokens for USDC, then buy underweight tokens with USDC.
    If USDC is one of the target tokens, handle it directly.
    """
    sells = []  # (symbol, usd_amount_to_sell)
    buys = []   # (symbol, usd_amount_to_buy)

    for symbol, data in holdings.items():
        drift = data["drift"]
        if abs(drift) < DRIFT_THRESHOLD:
            continue

        usd_delta = (drift / 100) * total_usd

        if drift > 0:
            # Overweight — need to sell
            price = prices[symbol]["usd"]
            token_amount = usd_delta / price
            sells.append((symbol, token_amount, usd_delta))
        else:
            # Underweight — need to buy
            buys.append((symbol, abs(usd_delta)))

    return sells, buys


def main():
    api_key = os.environ.get("SUWAPPU_API_KEY")
    if not api_key:
        print("Error: Set SUWAPPU_API_KEY environment variable.")
        print("  export SUWAPPU_API_KEY=suwappu_sk_your_api_key")
        sys.exit(1)

    wallet_address = os.environ.get("WALLET_ADDRESS")
    if not wallet_address:
        print("Error: Set WALLET_ADDRESS environment variable.")
        print("  export WALLET_ADDRESS=0xYourWalletAddress")
        sys.exit(1)

    headers = {"Authorization": f"Bearer {api_key}"}
    symbols = list(TARGET_ALLOCATIONS.keys())

    # Step 1: Fetch portfolio
    print("Fetching portfolio...")
    portfolio = get_portfolio(headers, wallet_address)
    balances = portfolio["balances"]

    # Step 2: Fetch prices
    print("Fetching prices...")
    prices = get_prices(headers, symbols)

    # Step 3: Calculate allocations
    holdings, total_usd = calculate_allocations(balances, prices)

    if total_usd == 0:
        print("Portfolio is empty. Fund your wallet first.")
        sys.exit(0)

    print(f"Total portfolio value: ${total_usd:,.2f}")
    print_allocation_table(holdings, "BEFORE Rebalance")

    # Step 4: Generate swap plan
    sells, buys = generate_swap_plan(holdings, total_usd, prices)

    if not sells and not buys:
        print("Portfolio is within threshold. No rebalancing needed.")
        sys.exit(0)

    # Step 5: Print and confirm swap plan
    print("Rebalance plan:")
    for symbol, amount, usd in sells:
        print(f"  SELL {amount:.6f} {symbol} (~${usd:,.2f})")
    for symbol, usd in buys:
        print(f"  BUY ~${usd:,.2f} worth of {symbol}")
    print()

    # Step 6: Execute sells (overweight → USDC)
    for symbol, amount, usd in sells:
        if symbol == "USDC":
            continue
        print(f"  Swapping {amount:.6f} {symbol} → USDC...")
        quote = get_quote(headers, symbol, "USDC", round(amount, 6))
        print(f"    Quote: {quote['amount_in']} {symbol} → {quote['amount_out']} USDC")
        swap = execute_swap(headers, quote["quote_id"])
        wait_for_swap(headers, swap["swap_id"])

    # Step 7: Execute buys (USDC → underweight tokens)
    for symbol, usd in buys:
        if symbol == "USDC":
            continue
        print(f"  Swapping ~${usd:,.2f} USDC → {symbol}...")
        usdc_amount = round(usd, 2)
        quote = get_quote(headers, "USDC", symbol, usdc_amount)
        print(f"    Quote: {quote['amount_in']} USDC → {quote['amount_out']} {symbol}")
        swap = execute_swap(headers, quote["quote_id"])
        wait_for_swap(headers, swap["swap_id"])

    # Step 8: Fetch updated portfolio and print results
    print("\nFetching updated portfolio...")
    updated = get_portfolio(headers, wallet_address)
    updated_prices = get_prices(headers, symbols)
    updated_holdings, updated_total = calculate_allocations(updated["balances"], updated_prices)
    print_allocation_table(updated_holdings, "AFTER Rebalance")
    print("Rebalancing complete.")


if __name__ == "__main__":
    main()
```

### Running the Python Version

```bash
# Install dependencies
pip install requests

# Set environment variables
export SUWAPPU_API_KEY=suwappu_sk_your_api_key
export WALLET_ADDRESS=0xYourWalletAddress

# Run the rebalancer
python portfolio_rebalancer.py
```

---

## TypeScript Version

```typescript
#!/usr/bin/env npx tsx
/**
 * Suwappu Portfolio Rebalancer — TypeScript
 * Reads your portfolio, compares to target allocations, and swaps to rebalance.
 */

const BASE_URL = "https://api.suwappu.bot/v1/agent";

// --- Configuration ---
const TARGET_ALLOCATIONS: Record<string, number> = {
  ETH: 50,
  USDC: 30,
  WBTC: 20,
};
const CHAIN = "ethereum";
const DRIFT_THRESHOLD = 5.0;
const SLIPPAGE = 0.01;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Balance {
  symbol: string;
  chain: string;
  balance: string;
  usd_value: number;
}

interface Holding {
  balance: number;
  usd_value: number;
  actual_pct: number;
  target_pct: number;
  drift: number;
}

async function api(
  path: string,
  options: RequestInit & { params?: Record<string, string> } = {}
) {
  const apiKey = process.env.SUWAPPU_API_KEY!;
  const { params, ...fetchOptions } = options;
  let url = `${BASE_URL}${path}`;
  if (params) url += `?${new URLSearchParams(params)}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(url, { ...fetchOptions, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

async function getPortfolio(walletAddress: string): Promise<{ balances: Balance[]; total_usd: number }> {
  return api("/portfolio", { params: { wallet_address: walletAddress, chain: CHAIN } });
}

async function getPrices(symbols: string[]): Promise<Record<string, { usd: number; change_24h: number }>> {
  const data = await api("/prices", { params: { symbols: symbols.join(",") } });
  return data.prices;
}

async function getQuote(fromToken: string, toToken: string, amount: number) {
  return api("/quote", {
    method: "POST",
    body: JSON.stringify({
      from_token: fromToken,
      to_token: toToken,
      amount: String(amount),
      chain: CHAIN,
      slippage: SLIPPAGE,
    }),
  });
}

async function executeSwap(quoteId: string) {
  return api("/swap/execute", {
    method: "POST",
    body: JSON.stringify({ quote_id: quoteId }),
  });
}

async function waitForSwap(swapId: number): Promise<boolean> {
  while (true) {
    const status = await api(`/swap/status/${swapId}`);
    if (status.status === "completed") {
      console.log(`    ✓ Swap ${swapId} completed (tx: ${status.tx_hash})`);
      return true;
    }
    if (status.status === "failed") {
      console.log(`    ✗ Swap ${swapId} failed`);
      return false;
    }
    await sleep(5000);
  }
}

function calculateAllocations(
  balances: Balance[],
  prices: Record<string, { usd: number }>
): { holdings: Record<string, Holding>; totalUsd: number } {
  let totalUsd = 0;
  const holdings: Record<string, Holding> = {};

  for (const bal of balances) {
    if (bal.symbol in TARGET_ALLOCATIONS) {
      holdings[bal.symbol] = {
        balance: parseFloat(bal.balance),
        usd_value: bal.usd_value,
        actual_pct: 0,
        target_pct: TARGET_ALLOCATIONS[bal.symbol],
        drift: 0,
      };
      totalUsd += bal.usd_value;
    }
  }

  // Add missing target tokens
  for (const symbol of Object.keys(TARGET_ALLOCATIONS)) {
    if (!(symbol in holdings)) {
      holdings[symbol] = {
        balance: 0,
        usd_value: 0,
        actual_pct: 0,
        target_pct: TARGET_ALLOCATIONS[symbol],
        drift: 0,
      };
    }
  }

  // Calculate percentages
  for (const symbol of Object.keys(holdings)) {
    if (totalUsd > 0) {
      holdings[symbol].actual_pct = (holdings[symbol].usd_value / totalUsd) * 100;
    }
    holdings[symbol].drift = holdings[symbol].actual_pct - holdings[symbol].target_pct;
  }

  return { holdings, totalUsd };
}

function printTable(holdings: Record<string, Holding>, label: string) {
  console.log(`\n${"=".repeat(55)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(55)}`);
  console.log(
    `  ${"Token".padEnd(8)} ${"Balance".padStart(10)} ${"USD Value".padStart(12)} ${"Actual".padStart(8)} ${"Target".padStart(8)}`
  );
  console.log(`  ${"-".repeat(50)}`);
  for (const symbol of Object.keys(holdings).sort()) {
    const h = holdings[symbol];
    console.log(
      `  ${symbol.padEnd(8)} ${h.balance.toFixed(4).padStart(10)} ${("$" + h.usd_value.toFixed(2)).padStart(12)} ${(h.actual_pct.toFixed(1) + "%").padStart(8)} ${(h.target_pct.toFixed(1) + "%").padStart(8)}`
    );
  }
  console.log();
}

async function main() {
  const apiKey = process.env.SUWAPPU_API_KEY;
  if (!apiKey) {
    console.error("Error: Set SUWAPPU_API_KEY environment variable.");
    process.exit(1);
  }

  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    console.error("Error: Set WALLET_ADDRESS environment variable.");
    process.exit(1);
  }

  const symbols = Object.keys(TARGET_ALLOCATIONS);

  // Step 1: Fetch portfolio and prices
  console.log("Fetching portfolio...");
  const portfolio = await getPortfolio(walletAddress);

  console.log("Fetching prices...");
  const prices = await getPrices(symbols);

  // Step 2: Calculate allocations
  const { holdings, totalUsd } = calculateAllocations(portfolio.balances, prices);

  if (totalUsd === 0) {
    console.log("Portfolio is empty. Fund your wallet first.");
    process.exit(0);
  }

  console.log(`Total portfolio value: $${totalUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  printTable(holdings, "BEFORE Rebalance");

  // Step 3: Generate swap plan
  const sells: Array<{ symbol: string; amount: number; usd: number }> = [];
  const buys: Array<{ symbol: string; usd: number }> = [];

  for (const [symbol, data] of Object.entries(holdings)) {
    if (Math.abs(data.drift) < DRIFT_THRESHOLD) continue;
    const usdDelta = (data.drift / 100) * totalUsd;

    if (data.drift > 0) {
      const price = prices[symbol].usd;
      sells.push({ symbol, amount: usdDelta / price, usd: usdDelta });
    } else {
      buys.push({ symbol, usd: Math.abs(usdDelta) });
    }
  }

  if (sells.length === 0 && buys.length === 0) {
    console.log("Portfolio is within threshold. No rebalancing needed.");
    process.exit(0);
  }

  // Step 4: Print swap plan
  console.log("Rebalance plan:");
  for (const s of sells) console.log(`  SELL ${s.amount.toFixed(6)} ${s.symbol} (~$${s.usd.toFixed(2)})`);
  for (const b of buys) console.log(`  BUY ~$${b.usd.toFixed(2)} worth of ${b.symbol}`);
  console.log();

  // Step 5: Execute sells (overweight → USDC)
  for (const s of sells) {
    if (s.symbol === "USDC") continue;
    console.log(`  Swapping ${s.amount.toFixed(6)} ${s.symbol} → USDC...`);
    const quote = await getQuote(s.symbol, "USDC", parseFloat(s.amount.toFixed(6)));
    console.log(`    Quote: ${quote.amount_in} ${s.symbol} → ${quote.amount_out} USDC`);
    const swap = await executeSwap(quote.quote_id);
    await waitForSwap(swap.swap_id);
  }

  // Step 6: Execute buys (USDC → underweight)
  for (const b of buys) {
    if (b.symbol === "USDC") continue;
    console.log(`  Swapping ~$${b.usd.toFixed(2)} USDC → ${b.symbol}...`);
    const quote = await getQuote("USDC", b.symbol, parseFloat(b.usd.toFixed(2)));
    console.log(`    Quote: ${quote.amount_in} USDC → ${quote.amount_out} ${b.symbol}`);
    const swap = await executeSwap(quote.quote_id);
    await waitForSwap(swap.swap_id);
  }

  // Step 7: Print updated allocations
  console.log("\nFetching updated portfolio...");
  const updated = await getPortfolio(walletAddress);
  const updatedPrices = await getPrices(symbols);
  const { holdings: updatedHoldings } = calculateAllocations(updated.balances, updatedPrices);
  printTable(updatedHoldings, "AFTER Rebalance");
  console.log("Rebalancing complete.");
}

main().catch(console.error);
```

### Running the TypeScript Version

```bash
# Install tsx for running TypeScript directly
npm install -g tsx

# Set environment variables
export SUWAPPU_API_KEY=suwappu_sk_your_api_key
export WALLET_ADDRESS=0xYourWalletAddress

# Run the rebalancer
npx tsx portfolio_rebalancer.ts
```

---

## Customization Tips

### Change Target Allocations

Edit the `TARGET_ALLOCATIONS` dictionary to match your desired portfolio. Percentages must sum to 100:

```python
TARGET_ALLOCATIONS = {
    "ETH": 40,
    "USDC": 20,
    "WBTC": 15,
    "SOL": 15,
    "ARB": 10,
}
```

### Adjust the Drift Threshold

Lower the threshold to rebalance more aggressively, or raise it to reduce swap frequency and fees:

```python
DRIFT_THRESHOLD = 2.0   # Rebalance when >2% off target (more frequent)
DRIFT_THRESHOLD = 10.0  # Rebalance when >10% off target (less frequent)
```

### Multi-Chain Rebalancing

To rebalance across multiple chains, remove the `chain` filter from the portfolio call and group swaps by chain:

```python
# Fetch across all chains
portfolio = get_portfolio(headers, wallet_address)
# Then group balances by chain and rebalance each chain independently
```

### Schedule with Cron

Run the rebalancer daily or weekly:

```bash
# Rebalance every day at 9am UTC
0 9 * * * SUWAPPU_API_KEY=suwappu_sk_... WALLET_ADDRESS=0x... python /path/to/portfolio_rebalancer.py >> /var/log/rebalancer.log 2>&1
```
