# Building a Standalone Trading Bot

Build and monetize a standalone price-triggered product without confusing a market signal, an executable route, permission to trade, and a completed outcome.

The public [`suwappu-trading-bot`](https://github.com/0xSoftBoi/suwappu-trading-bot) v2 is the concrete implementation. It is **preview-only by default** and intentionally narrow: USDC in, one target-price trigger, one managed-swap action. It demonstrates a production-shaped Suwappu authority/recovery boundary; it does not claim that the toy strategy is profitable.

For strategy research—backtests, paper/live parity, exits, drawdown, and net P&L—start with [Strategy Lifecycle](strategy-lifecycle.md). This guide focuses on the action boundary you can reuse in a real product.

## What “standalone” means here

Version 2 closes the single-node operating gaps that matter when the reference can move money:

| Boundary | v2 behavior |
|---|---|
| Safe start | package/container start performs one preview evaluation; continuous monitoring is explicit |
| Local concurrency | managed execution and reconciliation require one exclusive state-directory owner |
| Durable intent | atomic/fsynced journal, `0700` directory, `0600` journal/lock, corrupt state fails closed |
| Retention | resolved records can age out; unresolved idempotency state never does |
| Network ambiguity | bounded operations; timeout/network/HTTP 408/5xx/malformed execute success become outcome-unknown |
| Telemetry | optional metadata-only operation/outcome/duration events, with no keys, wallet/market terms, IDs, bodies, or error text |
| Release safety | frozen dependency graph, TypeScript/Python tests, build, dependency audit, container build, and CodeQL |

It is still a **single-node** reference. Multi-tenant roles, distributed serialization, durable background reconciliation, billing, strategy research, exits, and portfolio risk belong in the product you build around this boundary.

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

Fail closed if the quote is malformed, `success !== true`, the returned token pair or input amount does not match what you requested, `amount_out_min > amount_out`, estimated gas is missing, or the quote has too little time left to use safely.

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

This distinction matters: an HTTP-successful simulation can still return `would_execute: false` because a balance, gas, policy, or other safety check failed. The v2 reference also requires `success: true` and the exact requested `quote_id`; only then can `would_execute: true` authorize submission. Never use `response.ok` or a top-level `success: true` by itself as the trade-permission bit.

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

The standalone v2 process holds an exclusive `execution.lock` while managed mode is active. `executions --reconcile` takes the same lock before it writes state. Journal replacement uses an atomic rename after file `fsync`, and malformed state stops new economic actions. A soft retention target defaults to 5,000 entries, but unresolved records are never pruned to satisfy it.

That lock is intentionally local. Before running replicas or multiple hosts, move intents to transactional storage, enforce uniqueness on the economic-action/idempotency key, and serialize conflicting actions. A shared JSON file is not a distributed execution service.

## 5. A timeout can mean “it happened”

Network failure, timeout, HTTP 408/5xx, or a malformed successful execute response can leave the outcome unknown. Do not record that state as a proven failure and fire a fresh trade.

The reference bot persists `outcome_unknown`. Recovery follows two rules:

- if a swap ID is known, poll that swap; do not resubmit;
- if no swap ID is known, keep the original economic terms and idempotency key. A fresh quote can be used for a same-key retry only if the action still satisfies its original guard and simulation.

Why re-check the target? If the first request never reached Suwappu, a same-key retry may become the first real submission. You should not execute a newly bad route merely because the retry is idempotent.

Suwappu's caller-owned managed-execution key is bound to the **economic terms**, not the short-lived quote ID. That is why a fresh same-terms quote can represent the same retry. Changing the economic terms is a different action and must not be disguised as recovery.

## 6. Submission is not success

`POST /swap/execute` starts or reports a workflow. Use `GET /v1/agent/swap/status/:id` or [webhooks](webhook-setup.md) to reconcile it.

Store at least:

- intent/idempotency key and exact economic terms;
- quote ID, expected output, minimum output, gas estimate, and simulation evidence;
- swap ID and transaction hash when known;
- terminal status;
- final input/output amounts;
- errors and operator resolution.

The public bot's `--max-trades` counts terminal-success swaps, not request submissions. Quoted output and final output stay separate so a product can report what actually happened. Its status adapter also requires `success: true` and the returned swap ID to match the ID requested before it updates the journal.

Operators can inspect its durable journal without submitting anything:

```bash
bun src/cli.ts executions
bun src/cli.ts executions --reconcile
```

`--reconcile` polls known swap IDs only. It cannot create a quote or submit a new economic action.

If `execution.lock` remains after an unclean stop, do not auto-delete it. Stop supervisors, inspect its PID/timestamp, prove the owner is gone, preserve the journal/lock as incident evidence, remove only the proven-stale lock, and reconcile before managed mode. Uncertainty is not a retry signal.

## Run the reference safely

```bash
git clone https://github.com/0xSoftBoi/suwappu-trading-bot.git
cd suwappu-trading-bot
bun install --frozen-lockfile

export SUWAPPU_API_KEY=suwappu_sk_...

# One preview evaluation: price + route only, never submission.
bun src/cli.ts --once --chain base --from USDC --to ETH --amount 25 --target 2000
```

`bun run start` is also one-shot preview. Use `bun run watch` when you intentionally want a continuous monitor; that can spend API credits indefinitely, so make polling cadence part of the product budget.

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

Its Python companion is intentionally preview-only (`python bot.py --once ...`). There is one authoritative live state machine instead of two implementations that can drift on idempotency/recovery semantics.

Docker runs non-root, mounts durable `/data`, and defaults to one JSON preview evaluation. Compose uses `restart: "no"`; continuous preview and money-moving commands must be selected explicitly rather than hidden behind a restart policy.

### Bound and observe API work

Every TypeScript Suwappu operation defaults to a 25-second deadline and can be configured from 100–30,000ms with `SUWAPPU_OPERATION_TIMEOUT_MS`. Invalid deadline configuration fails at startup rather than being mislabeled as a transport failure.

Set `SUWAPPU_API_EVENTS=1` for metadata-only stderr events such as:

```text
suwappu_api_event {"operation":"quote","outcome":"response_ok","duration_ms":184.2,"status":200}
```

These events omit credentials, wallet/market terms, quote/swap IDs, bodies, and error text. `response_ok` means the adapter received a parseable response at that layer—not that a managed trade reached terminal success. Reconciled state remains authoritative.

## Choose REST, SDK, or MCP deliberately

Suwappu exposes the same product surface through several developer interfaces, but their **authority is not interchangeable**:

| Interface | Best fit here | Money-moving boundary |
|---|---|---|
| REST | Exact v2 reference contract and lowest dependency surface | `POST /v1/agent/swap/execute` is managed signing/broadcast; `POST /v1/agent/swap` is unsigned self-custody preparation |
| TypeScript/Python SDK | Typed app integration | TypeScript `executeManagedSwap()` / Python `execute_managed_swap()` map to managed `/swap/execute`; `prepareSwap()` / `prepare_swap()` stay unsigned |
| Hosted MCP | Agents, discovery, quote/simulation/research workflows | Historical MCP `execute_swap` **prepares an unsigned self-custody transaction; it does not managed-broadcast** |

At this guide's v2 sync (2026-08-07), the TypeScript SDK source in this repository is `0.6.0`, while the public npm registry resolves `@suwappu/sdk` to `0.4.0`. Re-check with `npm view @suwappu/sdk version` when you build. Treat the installed package's exports as authoritative for your build; use the REST contract when you need an API added in source but not yet published. Do not paste a source-only SDK example into a registry-installed app without checking its installed version.

SDK convenience methods also do not replace your product's durable intent/idempotency/reconciliation state machine. Keep that application state even when the HTTP call is wrapped for you.

For hosted MCP, connect at `/mcp` and call `tools/list` instead of hard-coding the tool count. Useful tools for a trading product include `get_quote`, `simulate_swap`, `get_swap_status`, and `get_swap_history`. If you need Suwappu-managed execution after MCP research/approval, cross that boundary explicitly through REST/SDK managed execution and keep the durable economic intent/idempotency key in your application.

## Turn the integration into something people pay for

A threshold bot by itself is a weak product. A useful progression is:

| Product stage | Customer value | Example paid fence | Capital moves? |
|---------------|----------------|-------------------|----------------|
| Route-qualified monitor | “Tell me when my actual size can reach this threshold” | saved targets/history + alert destinations | No |
| Approval workspace | Explain route/cost/policy context and make review faster | team seats, approvals, audit retention | No until explicit approval |
| Bounded automation | Repeated execution within customer-defined limits, with an audit trail | intentionally enabled automations + reconciliation/support tier | Yes, explicitly |

Measure the funnel before adding strategy complexity:

- target created -> first route-qualified preview;
- candidate -> qualified route rate;
- simulation block rate and reasons;
- approval / managed-execution conversion;
- terminal success/failure/unknown-outcome rate;
- time to terminal outcome;
- weekly retained users or intentionally enabled policies.

At the default 30-second poll interval, one always-on target can make up to **2,880 reference-price requests/day** before quote calls. That belongs in the product cost model. Price your service from measured Suwappu, infrastructure, model/notification, support, and payment costs—not from hoped-for strategy returns. Put call/cost ceilings around paid plans instead of maximizing request volume for its own sake.

Keep the two scoreboards separate:

```text
builder contribution margin by plan/customer cohort
= customer subscription / usage revenue
- Suwappu + infrastructure + model/notification + support/payment costs

customer strategy result
= realized strategy proceeds/value
- acquisition cost
- execution and strategy costs
```

This toy entry rule has no exit/P&L lifecycle, so it cannot honestly display a trading ROI. See [Build a Business on Suwappu](build-a-business.md) for monetization boundaries and [Strategy Lifecycle](strategy-lifecycle.md) for the customer-performance ledger.

The activation metric should also be a **product action**, not a vanity number: target created → route-qualified preview → decision/approval → reconciled outcome, depending on the tier. Track retention and contribution margin after activation; “API calls made” and “signals fired” are costs/activity, not proof of value.

## Know when to use a larger framework

The Suwappu example should stay small and copyable.

- [Freqtrade backtesting](https://www.freqtrade.io/en/stable/backtesting/) is a better benchmark when you need reproducible strategy research. Its docs explicitly say backtesting does not replace dry-run, and it provides dedicated [lookahead analysis](https://www.freqtrade.io/en/stable/lookahead-analysis/) and [protections](https://www.freqtrade.io/en/stable/plugins/).
- [Hummingbot Strategy V2](https://hummingbot.org/strategies/v2-strategies/) is a useful architecture benchmark when you need controllers plus [Executors](https://hummingbot.org/strategies/v2-strategies/executors/) that own finite order lifecycles.

Use Suwappu for the financial action plane and keep the research/orchestration framework as sophisticated as your product actually needs.

## Enterprise graduation checklist

Before turning this single-node product into a multi-user managed service, require evidence for each boundary:

- tenant-scoped roles/approvals, aggregate budgets, server wallet policy, and a kill switch;
- transactional intent storage with unique economic-action keys and distributed serialization;
- durable reconciliation workers and an owned incident queue for stale `submitting` / `outcome_unknown`;
- central tenant-safe metrics/logs/traces with retention rules;
- measured per-plan usage, billing, support cost, and contribution margin;
- reproducible strategy eval/backtest/dry-run evidence before making performance claims;
- signed/SBOM/provenance controls if required by your deployment/customer policy.

For the maintained single-node boundary, the source repository's [operator runbook](https://github.com/0xSoftBoi/suwappu-trading-bot/blob/main/docs/OPERATIONS.md) is the operational contract. Its release gate requires the frozen dependency graph, tests, build, dependency audit, container contract, and CodeQL before a money-path change is merged.

> Educational example, not financial advice. Live automated trading can lose funds.
