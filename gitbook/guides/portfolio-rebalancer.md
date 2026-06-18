# Portfolio Rebalancer

Build a periodic portfolio rebalancer that reads your wallet's holdings, compares them to target allocations, and issues swaps to bring the portfolio back in line. It combines three endpoints: portfolio (read balances), prices (value them), and quote + swap/execute (rebalance).

## How Rebalancing Works

1. Read current balances for the wallet.
2. Price each holding to compute USD values and current weights.
3. Compare to target weights; find positions that are over- or under-weight.
4. Swap from over-weight assets into under-weight assets until each is within a tolerance band.

## Step 1: Read the Portfolio

```bash
curl "https://api.suwappu.bot/v1/agent/portfolio?wallet_address=0xYOUR_MANAGED_ADDRESS" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

This returns the token balances held by the wallet. Use your managed wallet address (see [Managed Wallets](managed-wallets.md)).

## Step 2: Price the Holdings

```bash
curl "https://api.suwappu.bot/v1/agent/prices?symbols=ETH,USDC,WBTC" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

## The Rebalancer

```typescript
const BASE = 'https://api.suwappu.bot/v1/agent'
const API_KEY = process.env.SUWAPPU_API_KEY!
const WALLET = process.env.SUWAPPU_WALLET! // managed EVM address
const CHAIN = 'base'

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

// Target allocation (weights must sum to 1.0)
const TARGETS: Record<string, number> = { ETH: 0.5, WBTC: 0.3, USDC: 0.2 }
const TOLERANCE = 0.05 // rebalance only if a weight drifts > 5%

async function get(path: string) {
  return (await fetch(`${BASE}${path}`, { headers })).json()
}
async function post(path: string, body: unknown) {
  return (await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })).json()
}

async function rebalance() {
  const portfolio = await get(`/portfolio?wallet_address=${WALLET}`)
  const symbols = Object.keys(TARGETS)
  const priceData = await get(`/prices?symbols=${symbols.join(',')}`)

  // Compute USD value of each holding
  const values: Record<string, number> = {}
  let total = 0
  for (const sym of symbols) {
    const bal = balanceOf(portfolio, sym) // your helper over the portfolio response
    const price = priceData.prices[sym]?.usd ?? 0
    values[sym] = bal * price
    total += values[sym]
  }
  if (total === 0) return

  // Find the most over-weight and most under-weight assets
  let over = '', under = '', overDrift = 0, underDrift = 0
  for (const sym of symbols) {
    const weight = values[sym] / total
    const drift = weight - TARGETS[sym]
    if (drift > overDrift) { overDrift = drift; over = sym }
    if (-drift > underDrift) { underDrift = -drift; under = sym }
  }

  if (overDrift < TOLERANCE || !over || !under) {
    console.log('Portfolio within tolerance. Nothing to do.')
    return
  }

  // Swap the over-weight USD excess into the under-weight asset
  const excessUsd = (overDrift * total) / 2
  const overPrice = priceData.prices[over].usd
  const amount = (excessUsd / overPrice).toFixed(6)

  console.log(`Rebalancing: swap ${amount} ${over} -> ${under}`)
  const quote = await post('/quote', {
    from_token: over, to_token: under, amount, chain: CHAIN,
  })
  if (!quote.success) { console.error('Quote failed:', quote.error); return }

  const swap = await post('/swap/execute', { quote_id: quote.quote_id })
  console.log('Rebalance swap submitted:', swap.swap_id)
}

// Run every 6 hours
rebalance()
setInterval(rebalance, 6 * 60 * 60 * 1000)
```

`balanceOf(portfolio, sym)` is a small helper you write over the shape returned by `/portfolio` — extract the human-readable balance for each symbol.

## Notes

- Rebalancing one over/under pair per run keeps each cycle simple; loop the logic if you want to converge in a single pass.
- Use a tolerance band so you don't churn fees on small drifts.
- All swaps execute server-side from your managed wallet — no key handling needed.
- For multi-chain portfolios, fetch the portfolio per chain and rebalance within each chain, or use cross-chain quotes (`from_chain` / `to_chain`).

> Educational example, not financial advice. Test with small amounts first.
