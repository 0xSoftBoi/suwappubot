# Building a Trading Bot

Build a price-triggered Suwappu bot with a safe promotion path. The example is **preview-only by default**: it watches price, creates a wallet-bound quote, runs `POST /swap/simulate`, and stops. Managed execution is reachable only when `SUWAPPU_LIVE=1` is explicitly set.

This is strategy plumbing, not a claim that buying a dip is profitable. Use [Strategy Lifecycle](strategy-lifecycle.md) to replace the toy signal with a replayed/paper-tested decision rule.

## Prerequisites

Register an agent, create a managed wallet, fund it with only the capital you intend to test, and export:

```bash
export SUWAPPU_API_KEY=suwappu_sk_YOUR_KEY
export SUWAPPU_WALLET=0xYOUR_MANAGED_WALLET
# Leave SUWAPPU_LIVE unset for preview mode.
```

See [Managed Wallets](managed-wallets.md) for wallet creation and policy limits.

## Preview-first bot

```ts
const BASE = 'https://api.suwappu.bot/v1/agent'
const API_KEY = process.env.SUWAPPU_API_KEY!
const WALLET = process.env.SUWAPPU_WALLET!
const LIVE = process.env.SUWAPPU_LIVE === '1'

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  })
  const body = await response.json()
  if (!response.ok || body.success === false) {
    throw new Error(`${response.status}: ${body.error ?? 'request failed'}`)
  }
  return body
}

async function getPrice(symbol: string) {
  const data = await request(`/prices?symbols=${symbol}`)
  return Number(data.prices[symbol].usd)
}

async function run(targetPrice: number) {
  const price = await getPrice('ETH')
  console.log(`ETH price: $${price.toFixed(2)}`)
  if (price > targetPrice) return { action: 'hold', price }

  const quote = await request('/quote', {
    method: 'POST',
    body: JSON.stringify({
      from_token: 'USDC',
      to_token: 'ETH',
      amount: '200',
      chain: 'base',
      wallet_address: WALLET,
    }),
  })

  const simulation = await request('/swap/simulate', {
    method: 'POST',
    body: JSON.stringify({ quote_id: quote.quote_id, wallet_address: WALLET }),
  })

  const preview = {
    triggerPrice: price,
    quoteId: quote.quote_id,
    expectedOutput: quote.amount_out,
    minimumOutput: quote.amount_out_min,
    gasUsd: quote.estimated_gas_usd,
    routeFeeUsd: quote.bridge_fee_usd,
    wouldExecute: simulation.would_execute,
    warnings: simulation.warnings ?? [],
  }
  console.table(preview)

  if (!simulation.would_execute) return { action: 'blocked', preview }
  if (!LIVE) return { action: 'preview', preview }

  // Persist this intent before submission in a real bot. Reuse the same key on retries.
  const intentKey = `dip.${new Date().toISOString().slice(0, 13)}.ETH`
  const swap = await request('/swap/execute', {
    method: 'POST',
    headers: { 'Idempotency-Key': intentKey },
    body: JSON.stringify({ quote_id: quote.quote_id }),
  })

  console.log('Managed swap submitted:', swap.swap_id, swap.status)
  return { action: 'submitted', swap, preview }
}

run(2800).catch(console.error)
```

Run that worker from a durable scheduler. A production scheduler should persist the period/intent before running so a restart cannot accidentally duplicate a trade.

## Reconcile, don't guess

After a live submission, use [webhooks](webhook-setup.md) or `GET /v1/agent/swap/status/:id` to reconcile the final transaction. If the execution request times out, the outcome can be unknown; do not blindly create a fresh economic action. Reuse the intent's idempotency key and reconcile first.

## Measure a real strategy

For every decision, record the trigger state, quote, minimum output, simulation report, eventual fill, fees, gas, and mark/exit value. Entry output is not P&L. Report realized/unrealized P&L and drawdown after costs.

The public [`suwappu-trading-bot`](https://github.com/0xSoftBoi/suwappu-trading-bot) example and [`suwappu-flywheel`](https://github.com/0xSoftBoi/suwappu-flywheel) strategy lab are the next places to build out replay -> paper -> capped-live parity.

> Educational example, not financial advice. Live automated trading can lose funds.
