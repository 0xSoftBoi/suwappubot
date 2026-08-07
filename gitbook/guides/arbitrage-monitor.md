# Build a Quote-Qualified Arbitrage Monitor

Run or build a stateful, permanently read-only cross-chain opportunity monitor with bounded Suwappu quote work, durable history, and idempotent alerts.

The maintained [`suwappu-arb-scanner`](https://github.com/0xSoftBoi/suwappu-arb-scanner) 2.x reference turns that boundary into an operable product surface. Its useful lesson is not “this spread is profit.” It is how to move from a cheap market screen to size-aware route qualification and paid workflow value while keeping execution authority completely outside the scanner.

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

Requirements: Bun 1.3.14+ and a Suwappu agent key.

```bash
git clone https://github.com/0xSoftBoi/suwappu-arb-scanner.git
cd suwappu-arb-scanner
bun install --frozen-lockfile

export SUWAPPU_API_KEY=suwappu_sk_...
bun run scan -- --json --fail-on-degraded
bun run history -- --json
```

The default screen uses a 100 USDC notional for ETH on Ethereum, Arbitrum, Base, and Optimism. Those defaults are intentionally boring: the same ETH/USDC pair is available on every compared chain, which makes the economics comparable.

For WETH across a wider EVM set:

```bash
bun run scan -- \
  --assets WETH \
  --chains ethereum,arbitrum,base,optimism,polygon \
  --notional 500 \
  --min-edge 0.25 \
  --max-quote-calls 50 \
  --max-concurrent-quotes 4
```

The scanner sends quote requests only. It does not accept a wallet key, sign, submit simulation, prepare a managed execution, or broadcast a transaction. `scan --json` emits a versioned read-only record, while `history` reads local evidence without spending more quote calls.

## Understand the two-stage request budget

Quoting every exact buy/sell pair at every possible size grows quickly. The reference uses two stages.

For each asset across `N` chains:

1. Quote `USDC -> asset` with the same USDC notional on every chain.
2. Take the median expected asset output as a common probe size.
3. Quote that `asset -> USDC` probe on every covered chain.
4. Rank cross-chain buy/sell combinations by effective expected price.
5. Exact-qualify only the best `K` directions across the complete scan.

For `A` configured assets, that costs at most:

```text
worst-case quote requests per scan = 2 × A × N + K
```

With the reference defaults (`A=1`, `N=4`, `K<=3`), a scan uses at most 11 quote requests. The program exposes `quoteRequests`, `maxQuoteCalls`, and `maxConcurrentQuotes` so a paid product can measure and constrain API work instead of hiding it.

Version 2.x enforces both sides of the operational problem:

- `--max-quote-calls` defaults to 100 and rejects the worst-case matrix **before the first request**;
- `--max-concurrent-quotes` defaults to 8 and bounds a request burst independently of total spend;
- assets are processed sequentially and exact qualification is sequential; and
- `watch --interval 60` waits after a completed scan, with exponential backoff up to 8× after consecutive full scan failures.

Do not raise those controls just to make a large configuration fit. Read the current [Pricing](../billing/pricing.md), `GET /v1/agent/billing`, and live rate-limit headers, then choose the monitor/cadence from measured customer economics.

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

### Bound upstream work and keep errors safe

The maintained adapter bounds each direct quote operation with `SUWAPPU_OPERATION_TIMEOUT_MS` (25 seconds by default, allowed range 100–30,000 ms). HTTP failures expose the status code without copying an upstream response body into operator logs; timeout/network failures are sanitized too.

Set `SUWAPPU_API_EVENTS=1` when you need machine-readable stderr telemetry. Those events contain only operation, outcome, duration, and HTTP status when present. They intentionally omit API keys, token/chain/notional configuration, quote IDs, response bodies, and error text.

There is no automatic in-scan retry that can silently exceed `--max-quote-calls`. Let the next scheduled scan make the next bounded attempt.

### Persist monitoring evidence safely

State defaults to `~/.suwappu-arb-scanner` and can be moved with `SUWAPPU_ARB_STATE_DIR`. The monitor file is schema-validated fail-closed and replaced atomically after fsync; scan history is bounded by `SUWAPPU_ARB_HISTORY_LIMIT` (5,000 by default).

`monitor.lock` covers the complete local cycle—quote work, state transition, webhook delivery bookkeeping—so a second process sharing that state directory fails before creating another quote burst. A crash can leave a stale lock. Prove the owning process/container is gone before removing that exact lock; age alone is not proof.

The repository's container runs non-root and persists state under `/data`. Its default is one `scan --json --fail-on-degraded` with Compose restart disabled. Continuous `watch` is an explicit operator choice because indefinite polling is also an indefinite API-cost decision.

`--fail-on-degraded` still records state and emits the JSON scan evidence before returning non-zero for partial quote failure, which gives a scheduler a health signal without erasing the failed observation.

For stale-lock recovery, webhook incidents, SLOs, and release gates, follow the reference repository's [operations runbook](https://github.com/0xSoftBoi/suwappu-arb-scanner/blob/main/docs/OPERATIONS.md).

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

The 2.x reference already gives you the non-custodial substrate for this tier: durable scanner-qualified state/history, config fingerprints, transition/cooldown alerting, stable retry `alertId` values, cost/concurrency bounds, and machine-readable scan records. A hosted product still needs tenant auth/billing, customer-scoped database state, delivery integrations, and a UI/API/MCP surface. Do not share the CLI's local state directory across replicas and call that multi-tenancy.

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

The maintained reference now implements the base alert-state contract:

- fingerprint the normalized market/notional/threshold/request policy;
- keep bounded local scan history and scanner-qualified candidate state;
- alert on entry and optional cooldown rather than every poll;
- keep an undelivered/retried alert's `alertId` stable so receivers can deduplicate it;
- mark a candidate inactive only when an error-free scan can actually establish absence; and
- keep degraded coverage visible instead of manufacturing a decay/re-entry notification loop.

Set `--alert-cooldown 0` for transition-only delivery; the default 900 seconds permits a reminder for a continuously qualified candidate. A webhook is marked delivered only after HTTP 2xx. Timeout/transport failure is **delivery-outcome unknown**—the receiver may have processed it—so downstream `alertId` idempotency still matters.

For production webhook delivery, set an exact `SUWAPPU_WEBHOOK_ALLOWED_HOSTS` allowlist and a random `SUWAPPU_WEBHOOK_SECRET`. Signed requests use `X-Suwappu-Timestamp` plus `X-Suwappu-Signature: sha256=<HMAC>` over `timestamp + "." + rawBody`. Require HTTPS, reject stale timestamps, use constant-time signature comparison, and deduplicate `alertId`. The CLI's hostname checks are not a complete DNS-rebinding/SSRF boundary; a multi-tenant service accepting untrusted URLs needs connection-time egress controls.

Then build the product-specific moat on top: enter/exit hysteresis, longer database-backed history, explicit decay-duration analytics, useful/irrelevant feedback labels, ranking, team review, and downstream outcomes such as ignored, rejected by risk, approved, or reconciled. Do not describe those hosted extensions as features of the local reference until you implement them.

## Put the same product behind REST, SDK, or MCP

The maintained scanner calls REST directly so its quote count and economic evidence are easy to audit. Your customer surface does not have to.

- For application code, use the current [SDK examples](../quickstart/sdk-examples.md) when the **published** `@suwappu/sdk` version contains the method you need; verify the registry version instead of assuming core source has shipped.
- For an LLM/agent product, connect the [hosted MCP server](../quickstart/mcp-clients.md) and discover its live tools with `tools/list`. Keep your own monitor/call budget around agent loops; MCP tool discovery is not permission to spend without bounds.
- For this monitor's canonical quote-evidence path, REST [`POST /v1/agent/quote`](../api-reference/quote.md) remains a stable fallback.

Whichever interface you choose, preserve the same customer contract: quote evidence is read-only, alerts are stateful/idempotent, and a later execution workflow has a visibly different authority boundary. MCP's historically named `execute_swap` prepares an **unsigned self-custody transaction**; it is not managed broadcast and should not be wired into the read-only monitor as a hidden action.

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

Turn those costs into product limits instead of hoping usage averages out. For each plan, choose an explicit maximum monitor count, asset × chain matrix, cadence, retained-history window, and delivery destinations. Then model:

```text
monthly quote-call ceiling/customer
  = worst-case calls/scan × scheduled scans/month

target contribution/customer
  = plan revenue - measured variable customer cost
```

Use actual billing data and retained usage to set the price/fences. Higher cadence is valuable only if customers repeatedly act on fresher evidence; otherwise it is just a more expensive polling loop. See [Build a Business on Suwappu](build-a-business.md) for the broader billing/attribution model.

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
| Durable scan/candidate state + idempotent alerts | Yes, local single-writer |
| Hard per-scan request + concurrency bounds | Yes |
| Read-only/no wallet authority | Always |
| Two-leg order/fill lifecycle | No |
| Inventory/rebalancing engine | No |
| Historical strategy evaluation | No |

That narrower scope is valuable when you use it as a **Suwappu-native intelligence/operations product**, not when you market it as a substitute for a mature trading framework. Hummingbot sets the execution-engine bar; this reference intentionally competes on safe quote provenance, alert state, request economics, and an explicit handoff to separate authority.

## Production checklist

Before charging for an arb monitor or workflow, verify:

- `/prices` is used only as a reference feed, not fabricated chain liquidity;
- scan comparisons use the same asset, chain-compatible token, and notional;
- exact qualification uses a fresh second-leg quote at the conservative first-leg size;
- routed fees are not subtracted twice;
- missing gas/cost coverage cannot silently become “profit”;
- expired/nearly expired quotes cannot be promoted;
- failed markets remain visible as partial coverage;
- the worst-case quote matrix fits `--max-quote-calls` **before** work starts and concurrency fits your rate/upstream budget;
- per-operation deadlines are bounded and telemetry cannot leak keys/raw response bodies/customer market parameters;
- scan/history state is persisted, backed up where needed, and one state directory has exactly one writer;
- watch jobs cannot overlap and failure backoff cannot turn an outage into a request storm;
- webhook delivery uses stable `alertId` deduplication and, in production, an allowlist + HMAC + bounded egress policy;
- webhook timeout/transport failure is treated as delivery-outcome unknown rather than proof the receiver did nothing;
- hosted/multi-replica products move local JSON/locks to customer-scoped service storage instead of sharing one CLI state directory;
- alerts state the pre-positioned-inventory assumption;
- builder revenue and customer strategy P&L use different ledgers;
- releases pass typecheck/tests/build, dependency audit, the non-root container contract, and code scanning; and
- any future execution path has simulation, approval, idempotency, reconciliation, caps, a kill switch, and a tested one-leg failure policy.

Copy the maintained implementation and regression tests from [`suwappu-arb-scanner`](https://github.com/0xSoftBoi/suwappu-arb-scanner), then add the customer workflow that makes the signal worth paying for.
