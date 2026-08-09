# Build a Standalone Prediction Monitor

Build a credential-free prediction-market screener, market-health monitor, and durable alert product on Suwappu before you consider trading authority.

The public [Suwappu Standalone Prediction Monitor](https://github.com/0xSoftBoi/suwappu-prediction-bot) is the executable reference for this guide. Version 2 adds a production-shaped one-shot `watch` worker, restart-safe alert state, bounded reads, structured telemetry, a non-root container, and release gates while deliberately keeping order placement out of the repo.

## Start with the strongest authority boundary: no credential

Suwappu's prediction market-data routes are public reads. A research worker does **not** need `SUWAPPU_API_KEY` at all:

| Capability | Credential | Capital can move? |
|---|---|---:|
| markets / events / detail / price / book / trades | none | No |
| standalone `snapshot` / `watch` built from those reads | none | No |
| hosted MCP prediction research tools | MCP/client auth as configured | No |
| `positions` / `orders` account views | Suwappu agent key + initialized prediction credentials | No |
| place / cancel prediction orders | Suwappu agent + trading credentials | **Yes** |

Do not mount a trading credential into a research container “just in case.” Least authority is easier to audit when the secret is absent, not merely unused.

## Know the three identifiers

A market response carries identifiers with different jobs:

| Field | Use it for |
|---|---|
| `id` | Suwappu market detail, book, price, and trades routes; pass this to MCP `market_id` |
| `conditionId` | Venue/on-chain condition identity and settlement context |
| `tokens[].tokenId` | A specific outcome token; the prediction order endpoint takes this value |

Do not pass `conditionId` where an API or MCP tool asks for market `id`, and do not place an order with a market `id` where a `tokenId` is required.

## 1. Run the standalone research path

No key is required:

```bash
git clone https://github.com/0xSoftBoi/suwappu-prediction-bot.git
cd suwappu-prediction-bot
bun install --frozen-lockfile

bun src/cli.ts browse --query bitcoin --top 5
bun src/cli.ts snapshot --id <market-id> --trades 20
```

The underlying REST discovery call is equally small:

```bash
curl "https://api.suwappu.bot/v1/agent/predict/markets?query=bitcoin&limit=5"
```

The current route supports `query` and `limit`; it does not expose `category` or `offset` query parameters.

## 2. Treat the four-read snapshot as evidence, not a forecast

The reference's `snapshot` runs these public reads concurrently:

```text
market detail
+ outcome midpoint prices
+ order books
+ recent trades
-> normalized market-health snapshot
```

For every outcome it derives midpoint, best bid/ask, spread, share depth within one cent of each best price, last-trade context, capture time, and obvious book-consistency warnings.

That datum has important limits:

- the four requests are not atomic; the venue can move between them;
- a midpoint is market data, not an executable fill price;
- a midpoint is not automatically your own calibrated probability forecast;
- a narrow spread does not guarantee enough size for a customer's intended trade;
- a crossed/incomplete/cross-read-inconsistent book is missing evidence, not a reason to invent a number.

Persist `capturedAt` and the exact evidence used for customer-facing alerts or research history.

## 3. Turn snapshots into a restart-safe watch rule

`watch` evaluates exactly one rule and exits, so cron, Kubernetes, a queue worker, or another scheduler can own cadence:

```bash
bun src/cli.ts watch \
  --id <market-id> \
  --outcome Yes \
  --above 0.60 \
  --hysteresis 0.02 \
  --max-spread 0.03 \
  --min-depth 50 \
  --cooldown-seconds 3600
```

The decision is JSON. The important fields are:

```json
{
  "schemaVersion": 1,
  "watchId": "<stable-rule-hash>",
  "state": "triggered",
  "alert": true,
  "reason": "rule transitioned into alert state",
  "capturedAt": "...",
  "marketId": "...",
  "outcome": "Yes",
  "observed": {
    "midpoint": 0.61,
    "spread": 0.02,
    "bidDepthWithinOneCentShares": 80,
    "askDepthWithinOneCentShares": 95
  }
}
```

The state machine is intentionally conservative:

| Situation | Result |
|---|---|
| midpoint newly crosses the rule and quality gates pass | `triggered`, `alert: true` |
| condition remains active | `unchanged`; no duplicate alert |
| value moves inside the hysteresis band | stays active; no threshold flapping |
| value crosses the hysteresis reset boundary | `reset` |
| retrigger occurs inside cooldown | `suppressed`; it can alert after cooldown if still true |
| market inactive/unknown, book incomplete/crossed/inconsistent, or required quality gate unavailable | `insufficient_data`; preserve prior state |

Spread/depth gates are **market-quality filters**, not proof of alpha.

## 4. Make watch state an operating contract

The local default is `.suwappu-prediction/watch-state.json`. Production should set `SUWAPPU_PREDICTION_STATE_DIR` to durable storage.

The reference enforces:

- directory mode `0700`, state and lock mode `0600`;
- an exclusive `watch.lock` so two local writers cannot independently alert from the same prior state;
- ownership-token release: a process deletes only the lock it can prove it owns;
- unique temporary file + file `fsync` + atomic rename + best-effort directory `fsync`;
- fail-closed invalid/corrupt state;
- no time-based “stale lock” auto-deletion.

If a crashed process leaves a lock, first prove no worker still owns that exact state directory, then remove only that lock and run one manual evaluation before resuming automation.

This is a strong **single-node/filesystem** contract. A multi-replica hosted product should move the economic state and uniqueness constraint to tenant-scoped durable storage rather than sharing this file between replicas.

## 5. Bound every read and keep telemetry safe

The canonical TypeScript runtime uses Suwappu's read-only REST surface directly so every research command gets one consistent network policy:

```text
SUWAPPU_REQUEST_TIMEOUT_MS=20000   # allowed: 250..30000
SUWAPPU_READ_RETRIES=2             # allowed: 0..4
SUWAPPU_API_EVENTS=0               # set 1 for metadata-only stderr events
```

Only safe `GET` reads retry. Transport errors/timeouts and HTTP 408, 429, or 5xx are retryable within the configured bound; `Retry-After` is honored with a bounded delay. Other 4xx responses fail without retry. Successful malformed JSON/response shape fails closed.

The optional event stream contains only operation name, outcome, attempt, duration, and HTTP status. It intentionally excludes API keys, URLs, queries, market IDs, bodies, and exception text. Upstream response bodies are also omitted from TypeScript error messages.

## Choose REST, SDK, or MCP deliberately

| Surface | Best fit | Current prediction authority |
|---|---|---|
| REST | standalone workers, exact wire contract, explicit network policy | public research + separate authenticated account/trading routes |
| TypeScript/Python SDK | application code that wants typed Suwappu namespaces | source SDK has the richer prediction namespace |
| hosted MCP | conversational/agent product using multiple Suwappu primitives | prediction tools are read-only |

The hosted MCP server currently lists five prediction research tools: `predict_markets`, `predict_market`, `predict_book`, `predict_price`, and `predict_trades`. `predict_market_detail` remains a legacy alias for detail; use `predict_market` in new clients. Pass the Suwappu market `id` as `market_id`.

Package availability can lag the `suwappubot` source tree. As checked on 2026-08-07, local core source identifies the TypeScript SDK as `0.6.0` while public npm still reports `@suwappu/sdk@0.4.0`; verify the package you actually install before copying a method from `main`. The standalone monitor therefore uses REST for its TypeScript runtime, while its Python companion pins the current source SDK to a known commit.

## Know when direct Polymarket is the better layer

For new direct-venue integrations, benchmark against Polymarket's official unified [TypeScript SDK](https://github.com/Polymarket/ts-sdk) and [Python SDK](https://github.com/Polymarket/py-sdk), not its archived legacy CLOB client. The unified SDKs cover direct venue workflows and are the better fit for authentication, order lifecycle, and venue-specific features.

Polymarket's current [real-time market data](https://docs.polymarket.com/market-data/realtime-data) exposes public WebSocket book, price-change, last-trade, tick-size, and lifecycle updates with documented heartbeat behavior. If customer value depends on sub-poll freshness or maintaining a live order book, use the venue's stream rather than running a four-request Suwappu snapshot every few seconds.

Polymarket also publishes current [API rate limits](https://docs.polymarket.com/api-reference/rate-limits). Those limits are not a product budget: your Suwappu tier, customer count, retry traffic, storage/model cost, and notification cost still determine your own unit economics.

The Suwappu reference wins when a builder wants a narrow, auditable authority surface and reusable alert/evidence logic inside the broader Suwappu ecosystem. The direct venue SDK wins when full venue control is the product. Do not rebuild the venue SDK just to make this repo larger.

## Build a product before adding execution

Use a capability ladder:

| Tier | Customer value | Authority |
|---|---|---|
| free screener | discovery + a small manual/saved watchlist | public read-only |
| individual paid | more durable rules, deduplicated alerts, retained evidence/history | public read-only |
| team/API | shared rules, roles, webhooks/API, exports, audit retention | public read-only |
| execution handoff | explicit order review in a separate controlled workflow | money-moving |

The activation event is not “called the API.” A useful funnel is:

```text
signup
-> saved market/rule
-> first evidence-bearing watch evaluation
-> first useful delivered alert
-> retained rule / research follow-up
-> paid capability usage
```

Track alert opens/follow-up actions, muted/noisy alerts, `insufficient_data` rate, delivery latency, retained watchlists, exports/webhook usage, and support interventions. Those measure product value. Cherry-picked profitable outcomes do not.

## Budget request economics before pricing

One `snapshot`/`watch` evaluation is approximately four Suwappu reads. A simple baseline is:

```text
read calls/day
  ~= watched markets × evaluations per market/day × 4
```

For example, 25 markets evaluated every five minutes is roughly `25 × 288 × 4 = 28,800` reads/day before discovery, retries, customer refreshes, model calls, or delivery.

Measure real cost, then keep the builder ledger explicit:

```text
watchlist contribution margin
  = allocated subscription / usage revenue
  - Suwappu read cost
  - notification + model + storage cost
  - payment + allocated support/refund cost
```

Sell retained capabilities—history, more rules, alerts, collaboration, webhooks/API, reliability/support—not “higher win rate.” See [Build a Business on Suwappu](build-a-business.md) for the broader commercial boundary.

## If you publish forecasts, keep a separate immutable ledger

Market midpoint and model forecast are different claims. Store at least:

```text
forecast_id + customer/model identity
market id + outcome
forecast probability
market midpoint observed at forecast time
feature/data cutoff + captured_at
model / prompt / rule version
resolution status + final outcome
```

Score only after resolution. Brier score or log loss can measure probabilistic calibration/accuracy across a meaningful sample. Neither proves an executable strategy is profitable. If a customer later trades, spread, fills, fees, sizing, realized P&L, and marked P&L belong in a separate execution ledger.

Avoid look-ahead and survivorship bias: a backfilled report must use only information actually available when the forecast would have been emitted.

## Trading is a different product boundary

The standalone reference exposes no order/cancel command. Suwappu does have authenticated prediction order and cancel routes; the current order body is:

```json
{
  "tokenId": "<outcome-token-id>",
  "price": "0.42",
  "size": "10",
  "side": "BUY"
}
```

It submits a GTC limit order. Prediction order placement does not currently have the same durable request-idempotency contract as managed swap execution. If the client loses a response after submission, do not blindly retry a money-moving request; reconcile account/venue state first.

Before exposing trading to an agent, add explicit approval/policy, per-action and daily exposure limits, durable intent state, ambiguous-outcome recovery, order/fill reconciliation, and an auditable kill switch.

`positions` and `orders` are read-only but require prediction trading credentials for the agent. A research-only agent can legitimately have none; never place a dummy order just to initialize an account view.

## Graduate the deployment before calling the hosted service enterprise-ready

The public v2 repo has meaningful enterprise-shaped controls, but a filesystem worker is not a multi-tenant enterprise service. Add and verify:

- tenant-scoped managed storage for rules, snapshots, rule versions, and delivery state;
- queue-backed delivery with idempotency keys, retries, dead-letter handling, and replay tooling;
- authentication + tenant isolation, RBAC/SSO where required, and audit-retention policy;
- per-tenant quotas/request budgets, abuse controls, caching, and cost attribution;
- defined data-freshness/delivery SLOs plus operational alerts;
- backup/restore tests, incident/runbook ownership, capacity and HA/regional design matching what you sell;
- secret management only in workers that truly require account/trading access;
- privacy/retention controls for customer watchlists and alert evidence.

The reference's CI provides a useful source/release floor: frozen dependency install, TypeScript tests/typecheck, standalone compile/help, Python compatibility tests, high-severity dependency audit, non-root container build + zero-network startup, and TypeScript/Python CodeQL.

For exact current wire shapes, see the [Prediction Markets API reference](../api-reference/predict.md).
