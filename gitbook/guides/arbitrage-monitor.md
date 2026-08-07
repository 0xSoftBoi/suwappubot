# Build a Quote-Qualified Arbitrage Monitor

[`suwappu-arb-scanner`](https://github.com/0xSoftBoi/suwappu-arb-scanner) is the maintained read-only reference for turning Suwappu swap quotes into a cross-chain market-intelligence product.

Its useful lesson is not “this spread is profit.” It is how to move from a cheap market screen to size-aware route qualification while keeping execution authority completely outside the scanner.

```text
reference market idea
  -> same-notional Suwappu quotes
  -> first-pass cross-chain ranking
  -> exact second-leg quote
  -> conservative quoted edge
  -> alert / analyst decision
  -> optional separate execution workflow
```

## Do not invent a chain dimension on `/prices`

[`GET /v1/agent/prices`](../api-reference/prices.md) is a CoinGecko-backed USD reference feed. It accepts token symbols, is cached for 60 seconds, and has **no `chain` query parameter**.

That makes it useful for dashboards, broad signals, and USD reference values. It does not make this valid:

```text
ETH price from /prices “on Base”
vs
ETH price from /prices “on Arbitrum”
```

Those are not two executable markets.

For a cross-chain route screen, use [`POST /v1/agent/quote`](../api-reference/quote.md) with the same size and token pair on each chain. A quote gives you route-specific `amount_out`, `amount_out_min`, gas/fee estimates, price impact, and a short expiry window.

## Run the maintained reference

Requirements: Bun 1.3+ and a Suwappu agent key.

```bash
git clone https://github.com/0xSoftBoi/suwappu-arb-scanner.git
cd suwappu-arb-scanner
bun install --frozen-lockfile

export SUWAPPU_API_KEY=suwappu_sk_...
bun run scan
```

The default screen uses a 100 USDC notional for ETH on Ethereum, Arbitrum, Base, and Optimism. Those defaults are intentionally boring: the same ETH/USDC pair is available on every compared chain, which makes the economics comparable.

For WETH across a wider EVM set:

```bash
bun run scan -- \
  --assets WETH \
  --chains ethereum,arbitrum,base,optimism,polygon \
  --notional 500 \
  --min-edge 0.25
```

The scanner sends quote requests only. It does not pass a wallet, sign, prepare a managed execution, or broadcast a transaction.

## Understand the two-stage request budget

Quoting every exact buy/sell pair at every possible size grows quickly. The reference uses two stages.

For one asset across `N` chains:

1. Quote `USDC -> asset` with the same USDC notional on every chain.
2. Take the median expected asset output as a common probe size.
3. Quote that `asset -> USDC` probe on every covered chain.
4. Rank cross-chain buy/sell combinations by effective expected price.
5. Exact-qualify only the best `K` directions.

That costs at most:

```text
quote requests per asset per scan = 2N + K
```

With the reference defaults (`N=4`, `K<=3`), one asset uses at most 11 quote requests per scan. The program exposes `quoteRequests` so a paid product can measure this rather than hiding its API cost.

Run multiple assets sequentially or add your own queue/rate limiter. Do not assume the free-tier request budget can absorb an arbitrarily large asset × chain matrix at a short polling interval; read the current [Pricing](../billing/pricing.md), `GET /v1/agent/billing`, and live rate-limit headers.

## Exact qualification is the important step

Suppose the first-pass screen prefers buying ETH on Base and selling on Arbitrum.

For illustration, a Base buy quote could include this response fragment:

```json
{
  "amount_in": "100",
  "amount_out": "0.030000",
  "amount_out_min": "0.029100",
  "estimated_gas_usd": "$0.04",
  "expires_in_seconds": 60
}
```

Do not multiply a spot/reference price by `0.0291` and call that the second leg. Ask Suwappu for a fresh Arbitrum sell quote whose input is exactly the first leg's **minimum** output:

```json
{
  "from_token": "ETH",
  "to_token": "USDC",
  "amount": "0.0291",
  "chain": "arbitrum"
}
```

Now the two quoted legs describe the same conservative asset size.

The reference calculates:

```text
expected quoted edge
  = second-leg expected USDC output
  - first-leg USDC input
  - both estimated gas costs

conservative quoted edge
  = second-leg minimum USDC output
  - first-leg USDC input
  - both estimated gas costs
```

It fixes the accounting token to USDC so token amounts and USD gas estimates stay in a practical dollar unit. If your product uses a non-USD accounting asset, convert gas with an explicit live price source before doing this math.

### Do not double-count route fees

The [pricing contract](../billing/pricing.md) states that routed output already reflects the applicable Suwappu platform fee. A Li.Fi quote can separately report fee costs as `bridge_fee_usd`; that field is useful for attribution, but subtracting an already-embedded fee again would understate the quoted output twice.

The reference therefore:

- uses routed `amount_out` / `amount_out_min` as fee-inclusive route outputs;
- subtracts the separately reported gas estimate;
- reports route-fee totals for auditability; and
- refuses to promote an EVM candidate when either leg lacks a gas estimate.

It also rejects a qualified candidate if the older of its two quotes has 5 seconds or less remaining. A product should usually use a much larger operational margin because network, model, human approval, and submission latency consume the same short quote lifetime.

## “Two legs” still does not mean “cross-chain execution”

The scanner compares two **independent same-chain** routes. Buying ETH on Base does not make ETH appear on Arbitrum.

So every candidate has an explicit assumption:

> The operator already has the required inventory on both chains, or has a separate inventory/rebalancing system whose cost and risk are not included in this screen.

That missing inventory leg can erase an apparent edge. A real strategy ledger must include:

- funding/capital cost;
- inventory drift;
- rebalance/bridge cost and latency;
- route/venue fees already embedded in fills;
- realized gas;
- MEV/adverse selection;
- hedge or unwind loss after a one-leg failure.

Do not call `conservativeEdgeUsd` realized profit. It is a quote-time decision feature.

## Build the paid product before the trading bot

The cleanest business path has three stages.

### 1. Quote-qualified monitor

Sell intelligence with zero wallet authority:

- saved asset/chain/notional screens;
- configurable conservative-edge threshold;
- verified webhook/email/chat delivery;
- history and decay time;
- market-coverage and quote-failure diagnostics;
- exports or a customer-facing API/MCP surface.

Good paid limits are monitor count, cadence, history, delivery destinations, exports, and team seats.

Do not define activation as “found a profitable arb.” A real dislocation may be rare. A healthier activation event is **first configured scan with at least two covered chains plus a verified delivery destination**.

### 2. Analyst / approval workspace

Add the workflow around a candidate:

- actual inventory snapshot on both chains;
- fresh customer-sized quotes;
- quote TTL, minimum output, route, gas, and assumptions;
- stored risk decision / human approval;
- comments and immutable intent history;
- “candidate decayed before action” as a first-class outcome.

This can be more valuable than another signal. Teams pay for faster, safer decisions and an audit trail.

### 3. Bounded managed automation

Only add money movement after the monitor/workspace retains users and you can state the failure contract.

For each intended leg:

1. verify the authenticated managed wallet has the required chain inventory;
2. fetch a **fresh wallet-bound** quote;
3. call [`POST /v1/agent/swap/simulate`](../api-reference/simulate.md);
4. require `would_execute=true` and apply your own edge/exposure policy;
5. persist the economic intent and stable `Idempotency-Key` before submission;
6. execute only after the application/user approval boundary;
7. reconcile the returned swap ID to a terminal outcome; and
8. calculate P&L from final amounts, not the scanner snapshot.

A two-leg strategy has a special requirement: define what happens if one leg lands and the other does not **before** submitting either leg. Suwappu's managed swap endpoint executes a quoted swap; it does not make two independent chain actions atomic for you.

Use [Strategy Lifecycle](strategy-lifecycle.md) and [Flywheel](flywheel.md) for the durable intent/reconciliation patterns when you graduate past the read-only monitor.

## Make alert quality a moat

A polling script that repeats the same row every minute is not a durable paid product.

Add state around the screen:

- deduplicate the same asset/buy-chain/sell-chain direction;
- alert on transition into a qualified state instead of every poll;
- use separate enter/exit thresholds (hysteresis);
- surface market-coverage degradation;
- measure how often a first-pass screen survives exact qualification;
- store quote age and how long the candidate remained valid;
- label downstream outcomes: ignored, decayed, rejected by risk, approved, executed, reconciled.

Those features reduce notification cost and create data you can use to improve ranking without weakening the custody boundary.

## Measure business economics separately from strategy P&L

For your product:

```text
builder contribution margin
  = subscription + usage revenue
  - Suwappu API cost
  - model / alert / storage / compute cost
  - payment fees
  - attributable support and operations cost
```

For an executed customer strategy:

```text
realized strategy P&L
  = final sell proceeds
  - final acquisition cost
  - realized gas and non-embedded fees
  - inventory transfer / rebalance cost
  - hedge or unwind loss
```

Never use the scanner's quoted edge as either your SaaS revenue or the customer's realized P&L.

Useful product metrics include:

| Layer | What to track |
|---|---|
| Activation | first cross-chain-covered scan; first verified delivery |
| Signal quality | coverage, quote failure, first-pass → exact qualification, decay rate |
| Retention | active monitors/week, repeat teams/users, saved screens |
| Delivery | success rate, latency, duplicate-alert rate |
| Business | API cost/customer, paid conversion, ARPA, churn, contribution margin |
| Execution, if added | simulation blocks, one-leg failures, terminal completion, reconciliation latency, duplicate economic actions |

## Know where mature OSS sets the bar

[Hummingbot's Arbitrage Executor](https://hummingbot.org/strategies/v2-strategies/executors/arbitrage-executor/) validates candidate markets, tracks both orders, and evaluates profitability with transaction costs before execution. Its [XEMM Executor](https://hummingbot.org/strategies/v2-strategies/executors/xemm-executor/) adds balance validation, live order state, and changing profitability calculations.

That is the benchmark for claiming “arbitrage execution engine.” The Suwappu scanner intentionally does less:

| Capability | `suwappu-arb-scanner` |
|---|---|
| Suwappu executable-route screening | Yes |
| Exact second-leg qualification | Yes |
| Minimum-output + estimated-gas guard | Yes |
| Read-only/no wallet authority | Always |
| Two-leg order/fill lifecycle | No |
| Inventory/rebalancing engine | No |
| Historical strategy evaluation | No |

That narrower scope is valuable when you use it as an **integration and product reference**, not when you market it as a substitute for a mature trading framework.

## Production checklist

Before charging for an arb monitor or workflow, verify:

- `/prices` is used only as a reference feed, not fabricated chain liquidity;
- scan comparisons use the same asset, chain-compatible token, and notional;
- exact qualification uses a fresh second-leg quote at the conservative first-leg size;
- routed fees are not subtracted twice;
- missing gas/cost coverage cannot silently become “profit”;
- expired/nearly expired quotes cannot be promoted;
- failed markets remain visible as partial coverage;
- quote-call volume fits the customer's current Suwappu tier and your margin;
- watch jobs cannot overlap and create request storms;
- webhook delivery is observable and safe for your threat model;
- alerts state the pre-positioned-inventory assumption;
- builder revenue and customer strategy P&L use different ledgers;
- any future execution path has simulation, approval, idempotency, reconciliation, caps, a kill switch, and a tested one-leg failure policy.

Copy the maintained implementation and regression tests from [`suwappu-arb-scanner`](https://github.com/0xSoftBoi/suwappu-arb-scanner), then add the customer workflow that makes the signal worth paying for.
