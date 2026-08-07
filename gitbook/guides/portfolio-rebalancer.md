# Portfolio Rebalancer

Build a periodic portfolio rebalancer that is **preview-only by default**. It reads holdings, calculates target drift in USD, gets a fresh quote, runs a zero-funds simulation, and only reaches managed execution when `SUWAPPU_LIVE=1` is explicitly set.

The important product lesson is not the allocation formula. It is the operating contract: quote -> cost check -> simulate -> explicit live gate -> idempotent execution -> reconciliation.

## 1. Read the managed portfolio

```bash
curl "https://api.suwappu.bot/v1/agent/portfolio?wallet_address=0xYOUR_MANAGED_ADDRESS" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

For managed-wallet automation, use the wallet tied to the authenticated agent. See [Managed Wallets](managed-wallets.md).

## 2. Define targets and an economic threshold

A drift band stops tiny rebalances, but it does not account for execution cost. The worker below requires both:

- allocation drift above `TOLERANCE`;
- a trade large enough that estimated gas/route fees are small relative to the amount being corrected.

That is still a heuristic — a production strategy should measure realized slippage and tune its threshold from actual fills.

## 3. Preview-first worker

```ts
const BASE = 'https://api.suwappu.bot/v1/agent'
const API_KEY = process.env.SUWAPPU_API_KEY!
const WALLET = process.env.SUWAPPU_WALLET!
const LIVE = process.env.SUWAPPU_LIVE === '1'
const CHAIN = 'base'

const TARGETS: Record<string, number> = { ETH: 0.5, WBTC: 0.3, USDC: 0.2 }
const TOLERANCE = 0.05
const MIN_TRADE_USD = 25
const COST_MULTIPLE = 5 // trade must be >= 5x quoted gas + route fees

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

function balanceOf(portfolio: any, symbol: string) {
  const row = (portfolio.balances ?? []).find((b: any) => b.symbol === symbol)
  return Number(row?.balance ?? 0)
}

function quotedUsd(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(String(value).replace(/[$,]/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

async function rebalance(periodKey: string) {
  const symbols = Object.keys(TARGETS)
  const portfolio = await request(`/portfolio?wallet_address=${encodeURIComponent(WALLET)}`)
  const priceData = await request(`/prices?symbols=${symbols.join(',')}`)

  const values: Record<string, number> = {}
  let total = 0
  for (const symbol of symbols) {
    const price = Number(priceData.prices?.[symbol]?.usd ?? 0)
    values[symbol] = balanceOf(portfolio, symbol) * price
    total += values[symbol]
  }
  if (total <= 0) return { action: 'skip', reason: 'portfolio has no priced value' }

  let over = ''
  let under = ''
  let overDrift = 0
  let underDrift = 0
  for (const symbol of symbols) {
    const drift = values[symbol] / total - TARGETS[symbol]
    if (drift > overDrift) [over, overDrift] = [symbol, drift]
    if (-drift > underDrift) [under, underDrift] = [symbol, -drift]
  }

  if (!over || !under || overDrift < TOLERANCE) {
    return { action: 'skip', reason: 'inside target band' }
  }

  // Correct half the largest over/under gap per cycle to reduce churn.
  const tradeUsd = (Math.min(overDrift, underDrift) * total) / 2
  const fromPrice = Number(priceData.prices?.[over]?.usd ?? 0)
  if (!fromPrice) return { action: 'skip', reason: `no price for ${over}` }
  const amount = (tradeUsd / fromPrice).toFixed(8)

  const quote = await request('/quote', {
    method: 'POST',
    body: JSON.stringify({
      from_token: over,
      to_token: under,
      amount,
      chain: CHAIN,
      wallet_address: WALLET,
    }),
  })

  const simulation = await request('/swap/simulate', {
    method: 'POST',
    body: JSON.stringify({ quote_id: quote.quote_id, wallet_address: WALLET }),
  })

  // Quote cost fields are formatted strings such as "$0.04". Fail closed when
  // either field cannot be parsed; NaN must never disable the economic guard.
  const gasUsd = quotedUsd(quote.estimated_gas_usd)
  const routeFeeUsd = quotedUsd(quote.bridge_fee_usd)
  if (gasUsd === null || routeFeeUsd === null) {
    return { action: 'skip', reason: 'quote cost fields are missing or unparseable' }
  }
  const estimatedCostUsd = gasUsd + routeFeeUsd
  const economicFloor = Math.max(MIN_TRADE_USD, estimatedCostUsd * COST_MULTIPLE)

  const preview = {
    mode: LIVE ? 'live' : 'preview',
    from: over,
    to: under,
    amount,
    tradeUsd,
    quoteId: quote.quote_id,
    expectedOutput: quote.amount_out,
    minimumOutput: quote.amount_out_min,
    estimatedCostUsd,
    economicFloor,
    wouldExecute: simulation.would_execute,
    warnings: simulation.warnings ?? [],
  }
  console.table(preview)

  if (tradeUsd < economicFloor) {
    return { action: 'skip', reason: 'estimated execution cost is too large', preview }
  }
  if (!simulation.would_execute) {
    return { action: 'skip', reason: 'simulation did not pass', preview }
  }
  if (!LIVE) {
    return { action: 'preview', preview }
  }

  // One stable key per scheduled intent. Keep it when retrying a timed-out request.
  const idempotencyKey = `rebalance.${periodKey}.${over}.${under}`
  const swap = await request('/swap/execute', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ quote_id: quote.quote_id }),
  })
  return { action: 'submitted', swap, preview }
}
```

Use a durable scheduler (cron/queue/workflow) to supply a stable `periodKey` such as `2026-08-06T18`. Do **not** rely on an in-process `setInterval` for production: a restart can lose or duplicate work.

## 4. Reconcile before the next action

Persist the intent before live submission. After submission, record the returned `swap_id` and reconcile it through [`GET /swap/status/:id`](../api-reference/swap-status.md) or signed [webhooks](webhook-setup.md). If an execution request times out, do not blindly create a second intent — reuse the same `Idempotency-Key` and reconcile first.

Your ledger should capture at least:

- before and after allocation;
- quote expected/minimum output;
- estimated gas/route cost;
- simulation checks and warnings;
- managed swap ID and transaction hash;
- realized output and realized costs when settled.

That turns the rebalancer from a demo script into something you can backtest, paper trade, operate, and eventually sell as a service. See [Strategy Lifecycle](strategy-lifecycle.md) and [Build a Business on Suwappu](build-a-business.md).

> Educational example, not financial advice. Preview and paper-test first; live automation can lose funds.
