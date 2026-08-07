# Building a Trading Bot

Build a price-triggered product without confusing a market signal, an executable route, permission to trade, and a completed outcome.

The public [`suwappu-trading-bot`](https://github.com/0xSoftBoi/suwappu-trading-bot) is the concrete reference. It is **preview-only by default** and intentionally narrow: USDC in, one target-price trigger, one managed-swap action. It demonstrates Suwappu integration and recovery semantics; it does not claim that the toy strategy is profitable.

For strategy research—backtests, paper/live parity, exits, drawdown, and net P&L—start with [Strategy Lifecycle](strategy-lifecycle.md). This guide focuses on the action boundary you can reuse in a real product.

## The four states builders must keep separate

| State | Evidence | What it authorizes |
|-------|----------|--------------------|
| Reference signal | `GET /prices` | Decide whether a route is worth checking |
| Qualified route | wallet-aware `POST /quote` | A candidate transaction at a specific size/chain |
| Execution permission | `POST /swap/simulate` with `would_execute: true` + your policies | Permission to submit that specific economic action |
| Reconciled outcome | `GET /swap/status/:id` / webhook | Accounting, reporting, and the next economic decision |

Skipping one of those boundaries is where a tiny example becomes misleading or unsafe.

## 1. Use reference prices only as a trigger

`GET /v1/agent/prices` is a chain-neutral CoinGecko-backed reference feed. It has no `chain` parameter and does not prove that 100 USDC can buy ETH at that price on Base, Arbitrum, or any other route.

Use it to avoid unnecessary quote requests:

```ts
const response = await fetch(
  'https://api.suwappu.bot/v1/agent/prices?symbols=ETH',
  { headers: { Authorization: `Bearer ${process.env.SUWAPPU_API_KEY}` } },
)
const data = await response.json()
const referencePrice = Number(data.prices.ETH.usd)

if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
  throw new Error('Invalid reference price')
}
if (referencePrice >= targetUsd) return { action: 'wait' }
```

The reference repo fixes the source asset to USDC so `--amount`, the target, and the client-side ceiling have explicit USD accounting. If your product supports arbitrary source assets, convert and account for them explicitly instead of calling a token quantity “USD.”

## 2. Let the executable route decide

When the reference signal passes, request a fresh quote for the actual size and chain. In managed mode, bind it to the intended wallet:

```ts
const quote = await request('/quote', {
  method: 'POST',
  body: JSON.stringify({
    from_token: 'USDC',
    to_token: 'ETH',
    amount: '100',
    chain: 'base',
    wallet_address: process.env.SUWAPPU_WALLET_ADDRESS,
  }),
})
```

Fail closed if the quote is malformed, the input amount does not match what you requested, `amount_out_min > amount_out`, estimated gas is missing, or the quote has too little time left to use safely.

For this fixed-USDC example, the conservative acquisition price is:

```text
(input USDC + estimated_gas_usd) / amount_out_min
```

Only promote a candidate when that price is below the configured target. Use `amount_out_min`, not optimistic `amount_out`.

`bridge_fee_usd` is useful route-cost attribution, but routed output already reflects the routed platform/route fee. Do not subtract the same route fee from output a second time. Gas is separate, which is why the example adds the gas estimate to its fixed-USDC acquisition cost.

The reference repo also defaults `SUWAPPU_MAX_TRADE_USDC=1000`. A client cap is defense in depth; keep restrictive [managed-wallet policies](managed-wallets.md) on the server as the independent control.

## 3. Treat `would_execute` as the permission bit

Before managed submission, simulate the wallet-bound quote:

```ts
const simulation = await request('/swap/simulate', {
  method: 'POST',
  body: JSON.stringify({
    quote_id: quote.quote_id,
    wallet_address: process.env.SUWAPPU_WALLET_ADDRESS,
  }),
})

if (simulation.would_execute !== true) {
  return {
    action: 'blocked',
    warnings: simulation.warnings ?? [],
    checks: simulation.checks ?? [],
  }
}
```

This distinction matters: an HTTP-successful simulation can still return `would_execute: false` because a balance, gas, policy, or other safety check failed. Never use `response.ok` or a top-level `success: true` as the trade-permission bit.

The public bot additionally requires both:

```text
--execute
SUWAPPU_ALLOW_MANAGED_EXECUTION=1
```

Absence of either means preview-only. Credentials being present must not silently turn preview code into a money-moving process.

## 4. Persist intent before submission risk

The managed execute endpoint accepts a caller-owned `Idempotency-Key` (1–64 characters using `A-Z`, `a-z`, `0-9`, `_`, `.`, `:`, or `-`). The key belongs to the **economic action**, not to one HTTP attempt.

Before the first `POST /swap/execute`:

1. create an intent with exact economic terms (`chain`, assets, source amount);
2. persist its idempotency key durably;
3. mark the intent as `submitting` durably;
4. send that same key with the execute request;
5. reuse it after restart or an ambiguous failure.

```ts
await persist({
  id: intentId,
  phase: 'submitting',
  terms: { chain: 'base', from: 'USDC', to: 'ETH', amount: '100' },
})

const result = await fetch(`${BASE}/swap/execute`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': intentId,
  },
  body: JSON.stringify({ quote_id: quote.quote_id }),
})
```

Do not generate a fresh key from the retry timestamp. That turns one user/business intent into multiple economic actions.

## 5. A timeout can mean “it happened”

Network failure, timeout, 5xx, or a malformed successful execute response can leave the outcome unknown. Do not record that state as a proven failure and fire a fresh trade.

The reference bot persists `outcome_unknown`. Recovery follows two rules:

- if a swap ID is known, poll that swap; do not resubmit;
- if no swap ID is known, keep the original economic terms and idempotency key. A fresh quote can be used for a same-key retry only if the action still satisfies its original guard and simulation.

Why re-check the target? If the first request never reached Suwappu, a same-key retry may become the first real submission. You should not execute a newly bad route merely because the retry is idempotent.

## 6. Submission is not success

`POST /swap/execute` starts or reports a workflow. Use `GET /v1/agent/swap/status/:id` or [webhooks](webhook-setup.md) to reconcile it.

Store at least:

- intent/idempotency key and exact economic terms;
- quote ID, expected output, minimum output, gas estimate, and simulation evidence;
- swap ID and transaction hash when known;
- terminal status;
- final input/output amounts;
- errors and operator resolution.

The public bot's `--max-trades` counts terminal-success swaps, not request submissions. Quoted output and final output stay separate so a product can report what actually happened.

Operators can inspect its durable journal without submitting anything:

```bash
bun src/cli.ts executions
bun src/cli.ts executions --reconcile
```

`--reconcile` polls known swap IDs only. The example's local JSON journal assumes one process owns the state directory; use transactional storage and concurrency controls before running multiple workers.

## Run the reference safely

```bash
git clone https://github.com/0xSoftBoi/suwappu-trading-bot.git
cd suwappu-trading-bot
bun install

export SUWAPPU_API_KEY=suwappu_sk_...

# Preview: price + route only, never submission.
bun src/cli.ts --chain base --from USDC --to ETH --amount 25 --target 2000
```

For intentionally capped managed execution:

```bash
export SUWAPPU_WALLET_ADDRESS=0x...
export SUWAPPU_ALLOW_MANAGED_EXECUTION=1
export SUWAPPU_MAX_TRADE_USDC=100

bun src/cli.ts \
  --chain base \
  --from USDC \
  --to ETH \
  --amount 25 \
  --target 2000 \
  --execute \
  --max-trades 1
```

Its Python companion is intentionally preview-only. There is one authoritative live state machine instead of two implementations that can drift on idempotency/recovery semantics.

Docker Compose is also preview-only by default, persists the execution journal, and uses `restart: "no"` so a process that intentionally stops after its trade limit is not silently started again.

## Turn the integration into something people pay for

A threshold bot by itself is a weak product. A useful progression is:

| Product stage | Customer value | Capital moves? |
|---------------|----------------|----------------|
| Route-qualified monitor | “Tell me when my actual size can reach this threshold” | No |
| Approval workspace | Explain route/cost/policy context and make review faster | No until explicit approval |
| Bounded automation | Repeated execution within customer-defined limits, with an audit trail | Yes, explicitly |

Measure the funnel before adding strategy complexity:

- target created -> first route-qualified preview;
- candidate -> qualified route rate;
- simulation block rate and reasons;
- approval / managed-execution conversion;
- terminal success/failure/unknown-outcome rate;
- time to terminal outcome;
- weekly retained users or intentionally enabled policies.

At the default 30-second poll interval, one always-on target can make up to **2,880 reference-price requests/day** before quote calls. That belongs in the product cost model. Price your service from measured Suwappu, infrastructure, model/notification, support, and payment costs—not from hoped-for strategy returns.

Keep the two scoreboards separate:

```text
builder contribution margin
= customer subscription / usage revenue
- Suwappu + infrastructure + model/notification + support/payment costs

customer strategy result
= realized strategy proceeds/value
- acquisition cost
- execution and strategy costs
```

This toy entry rule has no exit/P&L lifecycle, so it cannot honestly display a trading ROI. See [Build a Business on Suwappu](build-a-business.md) for monetization boundaries and [Strategy Lifecycle](strategy-lifecycle.md) for the customer-performance ledger.

## Know when to use a larger framework

The Suwappu example should stay small and copyable.

- [Freqtrade](https://www.freqtrade.io/en/stable/strategy-101/) is a better benchmark when you need a strategy-development framework with backtesting and dry-run; it also documents [stop-loss](https://www.freqtrade.io/en/stable/stoploss/) and [protections](https://www.freqtrade.io/en/stable/plugins/).
- [Hummingbot Strategy V2](https://hummingbot.org/strategies/v2-strategies/) is a useful architecture benchmark when you need controllers plus Executors that own finite order lifecycles.

Use Suwappu for the financial action plane and keep the research/orchestration framework as sophisticated as your product actually needs.

> Educational example, not financial advice. Live automated trading can lose funds.
