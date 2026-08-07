# Build a Lending Monitor

Build a useful lending product before you build an executor. Suwappu exposes current Morpho market snapshots through a small read-only REST/SDK/MCP surface, which is enough for screeners, watchlists, alerts, and team research without giving an agent authority to move funds.

This guide separates two things that are easy to blur:

- **customer outcome:** the APY, liquidity, and risk of a lending position;
- **builder business:** what customers pay you minus the cost to collect, store, evaluate, and deliver the monitoring product.

Current APY is not a promised return, and this API does not deposit, withdraw, borrow, repay, sign, or broadcast transactions.

## 1. Get a snapshot with no key

The lending REST routes are public. Start on Base (chain `8453`):

```bash
curl "https://api.suwappu.bot/v1/agent/lend/markets?chainId=8453"
```

The response is `{ "markets": [...] }`. Useful fields are:

| Field | Use it for |
|-------|------------|
| `id` + `chainId` | Durable market identity; always store both |
| `supplyApy`, `borrowApy` | Current percentage rates (`4.2` = 4.2%) |
| `utilization` | Current utilization percentage |
| `totalSupplyUsd`, `totalBorrowUsd` | USD-valued market size; nullable |
| `availableLiquidityUsd` | Current USD-valued liquidity available to borrow; nullable |
| `listed` | Morpho interface listing signal, not a safety guarantee |
| `warnings` | Current Morpho warning objects; empty does not mean risk-free |

Avoid treating missing USD values as zero. `null` means the upstream API did not provide that valuation, which is different from a market having zero liquidity.

For one stored market, make the chain explicit:

```bash
curl "https://api.suwappu.bot/v1/agent/lend/market/0xMARKET_ID?chainId=8453"
```

The detail route returns the market object directly and adds `oracle`, `irm`, and `createdAt`.

## 2. Build a risk-aware watchlist

Do not rank by APY alone. A practical research filter can require the signals your product cares about before it even considers a rate:

```ts
type Market = {
  id: string
  chainId: number
  supplyApy: number
  utilization: number
  availableLiquidityUsd: number | null
  listed: boolean
  warnings: Array<{ type: string; level: string }>
}

function isWatchlistCandidate(m: Market): boolean {
  return (
    m.listed &&
    m.warnings.length === 0 &&
    m.availableLiquidityUsd !== null &&
    m.availableLiquidityUsd >= 100_000 &&
    m.utilization <= 95
  )
}
```

Those thresholds are product policy, not Suwappu or Morpho risk scores. Tune them to your customers and expose them in the UI. `listed: true`, ample liquidity, and no current warnings still do not make a market safe.

## 3. Store snapshots, then compare deltas

An alert needs change over time, not just a fresh sort. Persist a compact snapshot with a schema version, capture timestamp, chain ID, market ID, rate/utilization fields, nullable USD liquidity, listing state, and warnings.

Compare percentage fields in **percentage points**:

```ts
const supplyApyDeltaPp = current.supplyApy - previous.supplyApy
const utilizationDeltaPp = current.utilization - previous.utilization
```

If APY moves from 4.0% to 5.0%, that is `+1.0` percentage point, not `+1%`. Always surface market additions/removals and warning/listing changes even if a rate threshold was not crossed.

The public [`suwappu-yield-farmer`](https://github.com/0xSoftBoi/suwappu-yield-farmer) repo is a small reference implementation with versioned snapshots and deterministic delta commands in TypeScript and Python.

## 4. Make alerts stateful

Naive polling turns a useful signal into notification spam. Keep alert state per `(chainId, marketId, rule)`:

1. trigger only when a threshold is crossed or a warning/listing state changes;
2. record the value and timestamp that caused the alert;
3. deduplicate repeated snapshots;
4. require a recovery band before re-arming the same threshold (hysteresis);
5. keep delivery failures separate from market state so retries do not create duplicate economic events.

A premium product can add saved watchlists, per-team policies, Slack/email/webhook delivery, retained history, and audit trails without ever taking custody of customer funds.

## 5. Know your polling economics

Share upstream reads across customers whenever their freshness requirements match. One five-minute poll is:

- 288 reads/day;
- 8,640 reads in a 30-day month.

That is one shared market snapshot stream, not 8,640 reads **per customer**. Cache the snapshot and fan it out to every matching watchlist.

Public REST request counts and hosted MCP credits are different units. The REST lending routes do not require an API key. Hosted `lend_markets` and `lend_market` currently require agent authentication and cost 1 MCP credit per tool call; do not convert that into a permanent dollar estimate in your product model.

For your business, track contribution margin separately from customer yield:

```text
builder contribution margin
= subscription/API revenue
- polling + storage + queue + delivery + hosting + support costs
```

Customer APY, gas, slippage, defaults, liquidation, and position P&L belong to the customer's financial outcome ledger—not your SaaS revenue ledger.

## 6. A product ladder that earns trust

Start with the least authority and add value before automation:

| Product | Customer pays for | Authority |
|---------|-------------------|-----------|
| Explorer | normalized current market view | read-only |
| Alerts | saved rules, dedupe, delivery, retained deltas | read-only |
| Team workspace | shared watchlists, notes, history, auditability | read-only |
| Data API/webhooks | normalized snapshots and change events | read-only |
| Execution handoff | a separately reviewed deposit/withdraw workflow | outside this lending API |

The last step should be a separate authority boundary. The current Suwappu lending surface cannot execute a lending transaction, so a monitor should never imply that an alert was acted on automatically.

## 7. Know when to use Morpho directly

Suwappu is deliberately not a replacement for Morpho's full developer stack.

Use Suwappu when you value a small normalized REST/SDK/MCP shape that composes with Suwappu's other agent-facing domains. Use Morpho directly when you need richer market data, history, positions, rewards, public-allocator data, or transaction construction. Morpho's official `@morpho-org/morpho-sdk` supports reads and ready-to-send transactions; Suwappu's lending API is read-only.

Current limitations to design around:

- Suwappu returns at most 50 markets per chain, ordered by USD supplied value;
- the surface is a current snapshot, not a historical time-series API;
- it does not expose Morpho positions, rewards, or lending execution;
- USD-valued fields can be `null`;
- Morpho listing status and warnings are signals, not guarantees;
- Morpho documents its API as having no SLA, so production monitors need retry/backoff and stale-data handling.

For the upstream capabilities and current contract, use Morpho's [API overview](https://docs.morpho.org/developers/api/get-started/), [Morpho Blue API](https://docs.morpho.org/developers/api/morpho/), [API changelog](https://docs.morpho.org/developers/api/changelog/), and [official SDKs](https://github.com/morpho-org/sdks).

## 8. Decide what “good” means

Measure the product funnel independently from market returns:

- time from first API call to first saved watchlist;
- share of users who configure one useful alert;
- alert precision / dismiss rate;
- retained weekly active watchlists;
- paid conversion and builder contribution margin;
- delivery latency and stale-snapshot rate.

If users cannot get to a trustworthy first alert quickly, adding execution is not the next feature. Fix the monitor first.

Next: see the exact [Lending Markets API contract](../api-reference/lend.md) or use the [MCP protocol](../protocols/mcp.md) when your agent already speaks MCP.
