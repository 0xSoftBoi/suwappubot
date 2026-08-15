# Build a Standalone Perps Risk Monitor

Build a Hyperliquid position-risk and alerting product on Suwappu without giving the monitor trading authority.

The current Suwappu perps Agent API is deliberately a **read/quote surface**: supported markets, indicative quotes, and address-based open positions. There is no Agent API endpoint to open, close, or modify a perpetual position.

That makes monitoring a good product boundary: sell alerts, research, history, team workflows, or an API first. Add venue execution later only as a separate authority class if customers actually need it.

## 1. Know the three interfaces

| Capability | REST | SDK | Hosted MCP |
|---|---|---|---|
| markets | `GET /v1/agent/perps/markets` | `client.perps.markets()` | `perps_markets` |
| indicative quote | `POST /v1/agent/perps/quote` | `client.perps.quote(...)` | `perps_quote` |
| positions | `GET /v1/agent/perps/positions?address=...` | `client.perps.positions(address)` | `perps_positions` |

REST market discovery is public. REST quote/position calls require authentication. The hosted MCP server currently requires an agent Bearer key for all three perps tools; `perps_positions` additionally limits the requested address to that agent's managed EVM wallet.

The REST positions route accepts the documented `suwappu_sk_*` agent key as well as the user-session auth used by Suwappu's first-party terminal. Agent-key compatibility is covered by the core route contract; builders do not need a terminal session to use the REST/SDK path.

Hosted MCP endpoint: `https://api.suwappu.bot/mcp`.

## 2. Browse live market evidence

No key is required for the REST market list:

```bash
curl https://api.suwappu.bot/v1/agent/perps/markets
```

Important returned fields:

- `maxLeverage`: maximum accepted by the current Suwappu quote route for that market;
- `venueMaxLeverage`: raw maximum reported by Hyperliquid;
- `markPrice`: current Hyperliquid mark;
- `fundingRate`: current raw market funding rate.

Do not substitute `venueMaxLeverage` for `maxLeverage`. The current Suwappu quote ceiling is 20x, so a venue can advertise more leverage than the Suwappu quote path accepts.

Do not hard-code Suwappu's supported market list; use the returned names.

## 3. Price a hypothetical position

```bash
curl -X POST https://api.suwappu.bot/v1/agent/perps/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "market": "ETH-USD",
    "side": "long",
    "size": 0.5,
    "leverage": 10
  }'
```

The response is an **indicative, read-only quote**: entry, margin, approximate liquidation price, current funding context, and fee estimate. It does not place an order, model a guaranteed fill, or account for complete order-book depth/slippage.

Treat `size` as base-asset position size and validate leverage against the returned `maxLeverage`.

The hosted MCP contract currently marks `perps_quote` read-only but non-idempotent. A production client should therefore not invent blind automatic retry semantics for the POST just because no trade is placed.

## 4. Inspect positions

```bash
curl "https://api.suwappu.bot/v1/agent/perps/positions?address=0xYOUR_HYPERLIQUID_ADDRESS" \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

`liquidationPrice: 0` means Hyperliquid did not report a liquidation price on this path. Treat that as unavailable—not a real zero-price liquidation boundary.

`fundingRate` is current raw market context for the asset. It is **not** accrued position funding P&L and is not a forecast.

Position state and market context involve independent upstream reads. Never call the combined object an atomic venue snapshot.

## 5. Derive a risk snapshot

A monitor can add useful customer semantics without adding authority:

```text
notionalUsd = abs(size) × markPrice
pnlOnMarginPct = unrealizedPnl / margin × 100       (when margin > 0)
long liquidation distance = (mark - liquidation) / mark × 100
short liquidation distance = (liquidation - mark) / mark × 100
leverage utilization = leverage / returned maxLeverage × 100
```

Return `null`/unknown when required evidence is missing. Do not turn `liquidationPrice: 0`, a malformed mark, or missing market metadata into a reassuring number.

The standalone v2 reference monitor uses local `computedAt` only as computation time; it does not pretend that timestamp came from the exchange.

## 6. Make `watch` restart-safe

A sellable alert product needs durable state, not `if (distance < 10) sendEmail()` on every cron tick.

The standalone v2 contract keys each rule by:

```text
wallet + market + side + warning threshold + recovery threshold
```

The upstream position index is deliberately excluded from identity because it is not a safe durable key.

A sample customer-configured rule might warn at a reported liquidation distance `<= 10%` and recover at `>= 12%`. The 2-point gap is hysteresis; these numbers illustrate the state machine and are **not** a Suwappu risk recommendation.

Emit transitions like this:

| Evidence | Prior state | Decision | Notify? |
|---|---|---|---|
| distance enters warning region | healthy | `warning` | once |
| distance remains in warning/hysteresis region | warning | `unchanged` | no |
| distance reaches recovery boundary | warning | `recovered` | once |
| liquidation evidence unavailable | any | `insufficient_data` | no; preserve prior state |
| previously alerted position no longer returned | warning | `not_returned` | once for reconciliation; **do not infer recovery** |

If a missing position reappears but its liquidation evidence is unavailable, end the missing interval while preserving the prior alert state. A later disappearance can then produce a new reconciliation notification instead of being suppressed as a duplicate of the old missing interval.

For a single-node process, persist the state with an exclusive writer lock and atomic durable writes. The reference v2 uses a `0700` directory, `0600` state/lock files, keeps the exclusive lock descriptor open for the watch lifetime, verifies both lock-file identity and ownership token before release, uses a unique temporary file + file `fsync` + atomic rename + best-effort directory `fsync`, rejects live or dangling symlinked state, and fails closed on corrupt JSON. It never guesses that a lock is stale and deletes it automatically.

That is a single-node guarantee. Multi-replica services should use transactional shared state plus a delivery outbox/queue.

## 7. Bound networking and logs

The v2 reference runtime makes its network policy explicit:

- 20s request timeout by default, bounded to 250ms–30s;
- 2 safe-read retries by default, bounded to 0–4;
- GET retry on transport failure, 408, 429, and 5xx with bounded backoff/`Retry-After`;
- no automatic quote POST retry;
- response-shape validation before risk calculations;
- no API key on the public markets read;
- authenticated calls refuse a custom non-Suwappu origin unless the operator explicitly opts in;
- optional metadata-only API events: operation, outcome, attempt, duration, status;
- no API keys, wallet-bearing URLs/queries, bodies, or raw upstream exception text in those events.

That failure contract is more valuable to a production product than a clever liquidation formula.

## 8. SDK version reality

Suwappu's repository currently carries TypeScript SDK source `0.6.0`, while the public npm package is still `0.4.0`. Check the [SDK version note](../quickstart/sdk-examples.md) before copying source-only examples into a published-package app.

The v2 standalone TypeScript monitor uses the documented REST wire contract directly so its timeout/retry/schema guarantees do not depend on that publishing gap. Its Python companion source-pins the Suwappu core SDK rather than pretending a PyPI package exists.

When you are on a compatible SDK version, the read composition is simply:

```ts
import { Suwappu } from '@suwappu/sdk'

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY })
const address = '0xYOUR_HYPERLIQUID_ADDRESS'

const [positions, markets] = await Promise.all([
  client.perps.positions(address),
  client.perps.markets(),
])
```

## 9. Product economics

One standalone risk/watch evaluation uses one positions read plus one markets read. A service can share the markets result across wallets in the same cycle.

For 100 wallets polled once per minute:

```text
naive  = 100 × 2 × 1,440 = 288,000 HTTP reads/day
shared = (100 + 1) × 1,440 = 145,440 HTTP reads/day
saved  = 142,560 HTTP reads/day
```

Those are request counts, not a claim about Suwappu billing. Convert them to dollars only using the current terms and unit costs that actually apply to you.

Track the builder business separately from customer trading performance:

```text
realized product revenue
  = subscription + usage revenue - discounts - refunds

variable cost
  = Suwappu/API + notification delivery + storage + variable compute/egress + variable support

contribution margin
  = realized product revenue - variable cost
```

The activation funnel should be `real wallet → saved rule → evidence-bearing watch → delivered transition`. Then measure acknowledgement, retained monitored wallets, delivery success, and contribution margin. Customer trading P&L is not your product revenue.

## 10. Graduate to enterprise deliberately

The single-node reference is not a claim that a JSON file is an enterprise SaaS database. Before selling a shared/HA product, add:

- tenant-scoped watchlists, rule state, destinations, and history;
- transactional state and a durable, idempotent delivery outbox;
- SSO/RBAC and audited privileged/rule/destination changes;
- secret-manager-backed Suwappu and webhook credentials with rotation;
- signed webhooks, SSRF-safe destination validation, retries/replay, and acknowledgement state;
- backups plus tested restores and an explicit data-retention/deletion policy;
- provider/rate-limit, stale-data, scheduler, queue-age, and failed-delivery monitoring;
- measured SLOs before advertising an SLA.

Keep execution behind a separate product/authority review. A read-only alert acknowledgement must never silently become permission to trade.

See [Build a Business on Suwappu](build-a-business.md) and [Strategy Lifecycle](strategy-lifecycle.md).

## 11. Know when direct Hyperliquid is better

Suwappu is useful here as a smaller agent-facing REST/SDK/MCP read/quote boundary. Hyperliquid's official surface is much broader.

Use Hyperliquid directly when you need low-latency streaming, complete venue-specific features, or signing/execution. Hyperliquid documents [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions), [rate and user limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits), and an [official Python SDK](https://github.com/hyperliquid-dex/hyperliquid-python-sdk) that includes trading flows.

Do not rebuild those venue capabilities inside a read-only monitor merely to make the repository look larger. The valuable standalone product is the operational layer Suwappu does not give you automatically: durable rules, evidence, delivery, collaboration, and honest unit economics.

## Current boundary recap

- no Agent API perps open/close/order route;
- no Suwappu perps WebSocket surface;
- supported subset of the Hyperliquid perp universe;
- quote is indicative, not a fill promise;
- position funding is current market context, not accrued funding P&L;
- polling snapshots are not atomic venue observations;
- MCP `perps_positions` is managed-wallet-scoped even though the authenticated REST positions endpoint is address-based.
