# Build a Strategy Product with Flywheel

[`suwappu-flywheel`](https://github.com/0xSoftBoi/suwappu-flywheel) is a standalone Suwappu strategy-operations product and a compact reference implementation for turning market data, quotes, and managed execution into a stateful workflow without pretending that an accepted request is already a fill.

Run it when you want a paper-first workspace for DCA, grid, opportunity screens, portfolio reporting, or scalping experiments. Copy its **application architecture** when you are building your own product. Do not treat any included signal as evidence that a strategy is profitable.

The useful contract is:

```text
observe -> decide -> quote -> simulate -> persist intent
       -> explicitly execute -> reconcile -> account from final amounts
```

That same contract can power an alerting product, a trade copilot, or bounded automation.

## What Flywheel is — and is not

Flywheel deliberately does less than a mature trading framework.

| Need | Flywheel | Use a deeper trading framework when... |
|------|----------|----------------------------------------|
| Suwappu quotes, lending, prediction, and managed execution patterns | Core purpose | — |
| Paper/read-only development | Default | You need exchange-specific simulation infrastructure |
| Durable Suwappu intent + idempotency + reconciliation | Included for a single local writer | You need a distributed production order/fill service |
| Historical backtesting | Not a built-in engine | You need reproducible large-scale backtests and analysis |
| Exchange/venue connector ecosystem | Not its goal | You need many native trading connectors |
| Local operations | Fail-closed state, execution lock, persistent container volume, reconciliation | You need database-backed ledgers, queues, leases, and fleet operations |
| Release safety | Tests, builds, dependency audit, container contract, CodeQL | You need your own deployment, SLO, and compliance controls |

[Freqtrade](https://www.freqtrade.io/en/stable/strategy-customization/) is a useful benchmark because the same strategy concept spans backtesting, dry/forward testing, and live operation; it also ships dedicated [lookahead-bias analysis](https://www.freqtrade.io/en/stable/lookahead-analysis/). [Hummingbot](https://hummingbot.org/docs/) is a useful benchmark for a broader connector/multi-bot platform whose V2 controllers can be [backtested](https://hummingbot.org/dashboard/backtest/).

Do not rebuild either inside Flywheel. Combine the evaluation or infrastructure you actually need with Suwappu's action surface.

## Start in paper mode

Requirements: Bun 1.3.14+ and a Suwappu agent key.

```bash
git clone https://github.com/0xSoftBoi/suwappu-flywheel.git
cd suwappu-flywheel
bun install --frozen-lockfile
cp .env.example .env
```

Put `SUWAPPU_API_KEY` in `.env`, then run one cycle:

```bash
bun run src/cli.ts run
```

No live strategy action happens merely because a key exists. DCA, grid, the composed `run` workflow, the scalper, and the TUI require a positive `--execute` opt-in for their money-moving paths.

Useful read/paper commands:

```bash
bun run src/cli.ts yield --top 5
bun run src/cli.ts arb --tokens ETH,SOL --chains base,arbitrum,optimism
bun run src/cli.ts predict --top 10
bun run src/cli.ts dca --token ETH --amount 10
bun run src/cli.ts scalp --amount 2
bun run src/tui.ts
```

`arb` is intentionally quote/screening-only. A real cross-chain arbitrage workflow needs both legs, bridge/inventory handling, reconciliation, and an unwind policy; executing one buy leg is not arbitrage. For the dedicated size-aware screening and paid-monitor pattern, use the [Quote-Qualified Arbitrage Monitor](arbitrage-monitor.md) and its maintained `suwappu-arb-scanner` reference.

## Copy the money-moving boundary first

Before copying a signal, study these files in Flywheel:

| File | Pattern to reuse |
|------|------------------|
| `src/suwappu.ts` | Current managed-swap REST boundary |
| `src/execution.ts` | Durable intent, simulation, idempotent submit, reconciliation |
| `tests/execution.test.ts` | Outcome-unknown and no-resubmit regression tests |
| `src/strategies/dca.ts` | Confirmed-only history |
| `src/strategies/grid.ts` | Downstream accounting from verified inventory/final amounts |

For a managed swap, Flywheel does this:

1. decide the economic terms once;
2. fetch a fresh quote;
3. call `POST /v1/agent/swap/simulate`;
4. persist a stable intent and `Idempotency-Key` **before** submission;
5. call `POST /v1/agent/swap/execute`;
6. reconcile the `swap_id` with `GET /v1/agent/swap/status/:id`; and
7. update holdings, P&L, history, or learning state only from terminal-success final amounts.

If a managed submission times out, loses its network response, returns HTTP 408/5xx, or returns a malformed success response after submission may have started, its outcome is **unknown**. Keep the same economic intent and idempotency key. If a `swap_id` is known, poll it rather than submitting another trade. Never turn transport uncertainty into a second economic action.

Flywheel bounds managed simulate/execute/status calls with `SUWAPPU_OPERATION_TIMEOUT_MS` (25 seconds by default; accepted range 100–30000 ms). `SUWAPPU_API_EVENTS=1` adds metadata-only operation/outcome/duration/status events to stderr. Those events intentionally omit API keys, wallets, quote/swap IDs, response bodies, and error messages.

Inspect the local journal at any time:

```bash
bun run src/cli.ts executions
bun run src/cli.ts executions --reconcile
```

`--reconcile` only polls known swaps; it does not create a new action.

The local financial state is strict and fail-closed: an existing corrupt journal/history/state file is an operational error, not permission to silently start from an empty ledger. Writes use an atomic-replace pattern. Managed execution also takes an exclusive local `execution.lock`, so two writers cannot concurrently submit against the same state directory.

A crash can deliberately leave that lock behind. Stop all writers, run reconciliation, prove no writer is active, and only then clear a stale lock. Do not automate stale-lock deletion around live money. The complete recovery and incident contract lives in Flywheel's [operations runbook](https://github.com/0xSoftBoi/suwappu-flywheel/blob/main/docs/OPERATIONS.md).

For a multi-worker paid service, move the same state machine into a transactional database, enforce a unique economic-intent key, and add locking/leases plus an append-only audit trail.

## Understand the state before calculating P&L

Keep quote estimates and final outcomes separate:

| State | What it proves | Strategy accounting |
|-------|----------------|---------------------|
| Decision | A rule/user wanted an action | None |
| Quote | A route was estimated at a point in time | None |
| Simulation | Preflight checks passed/failed | None |
| Submitted | The service accepted or may have accepted the action | Still no fill |
| Outcome unknown | A side effect may have happened | Reconcile; do not replace |
| Completed + final amounts | Terminal success with realized quantities | Apply once |

This is why Flywheel excludes legacy DCA/grid rows that older versions wrote at submission time. They cannot prove finality retroactively.

Paper and live scalper state are also separate. Never let hypothetical outcomes train or report as live trading results.

## Evaluate the signal before adding authority

Flywheel is a strategy lab, not a historical backtest engine. Before live automation, add an evaluation layer that records inputs available at decision time, strategy version, intended terms, quote/simulation, costs, skips, and final live outcomes.

Promote through the full [Strategy Lifecycle](strategy-lifecycle.md):

```text
historical replay -> live paper -> capped live -> scaled live
```

For the included examples specifically:

- **Arb:** the cost model is a screening estimate, not a guaranteed two-leg profit.
- **Prediction:** `YES + NO` price-sum deviation is a screen; spreads, stale books, fees, and execution still matter.
- **Yield:** APY is a snapshot, not a promised annual return; account for incentive, oracle, collateral, liquidity, and protocol risk.
- **Grid/DCA:** only reconciled terminal successes belong in inventory/accounting.
- **Scalper:** paper outcomes are simulations even when they use fresh live quotes.

Flywheel's DCA evaluator matures observations through roughly 15m -> 1h -> 24h windows as the data becomes available. Kelly sizing and attribution use the most mature later observed return, not the entry quote or a synthetic fill-time return. A 15-minute score is therefore an early observation, not a final strategy label.

The local risk report is also deliberately qualified. `maxObservedDrawdown` is the worst drawdown the process has actually observed; `currentDrawdownDurationDays` is the age of the current drawdown. Sharpe, Sortino, and parametric VaR are estimates over the available local observations, not an institutional risk engine.

## Three products to build from it

Start with the smallest authority surface that creates repeat value.

### 1. Opportunity monitor

Build a read-only product around arb spreads, lending snapshots, prediction deviations, or route comparisons:

1. let the customer save markets/chains and thresholds;
2. run the screen repeatedly;
3. alert only when the customer's rule matches;
4. link to fresh evidence/quotes for verification; and
5. retain history so the customer can judge whether alerts are useful.

Paid boundaries can be monitor frequency, more saved screens, team delivery, history, exports, or webhooks. You can test willingness to pay without execution authority.

### 2. DCA or treasury copilot

Turn a recurring decision into a controlled workflow:

```text
saved policy -> fresh quote -> simulation -> human approval
            -> durable intent -> execute -> reconcile -> report
```

Charge for saved policies, approval roles, reporting, workspaces, audit history, and workflow automation. Keep trade-size caps and wallet policies below the model/application layer.

### 3. Strategy operations console

Power users running their own logic still need reliable operations. Productize the execution journal into a UI that shows:

- intent and quote IDs;
- decision/approval timestamps;
- simulation result;
- submitted vs outcome-unknown vs completed state;
- swap/transaction IDs and final amounts;
- reconciliation latency and errors; and
- whether final accounting consumed the outcome.

That sells control and observability rather than a promise that your signal beats the market.

## Measure whether the product is valuable

Instrument the path to retained utility instead of counting API calls.

| Funnel | Useful measures |
|--------|-----------------|
| Activation | Time to first useful report/quote; first saved rule; first successful simulation |
| Retention | User returns for another report/alert; saved workflow still active after 7/30 days |
| Execution quality | Simulation block rate; completion rate; outcome-unknown rate; reconciliation latency; duplicate economic actions (target: zero) |
| Business | Paid conversion; revenue/customer; variable cost/customer; contribution margin; support/refund burden |

Keep two ledgers:

```text
customer strategy outcome
  = realized + unrealized trading result - trading/chain costs

builder contribution margin
  = customer subscription/usage revenue
  - Suwappu/API costs
  - model/data/compute costs
  - infrastructure/observability costs
  - payment processing
  - variable support/refunds
```

Never use strategy P&L as a substitute for product revenue. Read [Build a Business on Suwappu](build-a-business.md) for the complete monetization boundary.

## Turn on live execution deliberately

Only after paper evaluation and wallet policies are ready:

```bash
# Optional wallet-aware simulation and local cap.
export SUWAPPU_MANAGED_WALLET_ADDRESS=0x...
export SUWAPPU_MAX_TRADE_USD=25

bun run src/cli.ts dca --token ETH --amount 5 --execute
```

The managed wallet is controlled by the Suwappu agent/API authority. `WALLET_ADDRESS` in Flywheel is only an observation address for portfolio/balance reads; do not confuse it with signing authority.

The scalper does not invent a wallet balance for percentage Kelly sizing. Set a real positive `SUWAPPU_SCALPER_USDC_BUDGET` if you want percentage sizing; otherwise the requested `--amount` is the budget ceiling. Live DCA/scalper cap configuration fails closed when `SUWAPPU_MAX_TRADE_USD` is present but invalid.

If you want self-custody instead, `POST /v1/agent/swap` prepares an **unsigned** transaction for the user's wallet to review and sign. That is a different authority model from managed `POST /swap/execute`.

The Docker and `run-dca.sh` entrypoints follow the same safe default: one paper/read-only run unless live execution is explicitly requested. Compose mounts a named `flywheel_state` volume at `/data`, and the image runs non-root, so `docker compose run --rm ...` does not throw away the execution/idempotency journal. Back up that volume before a live upgrade and never remove it while an intent is unresolved. Avoid restart loops around a money-moving one-shot command.

## SDK version boundary

Flywheel currently installs the published `@suwappu/sdk` contract used for quote construction and isolates newer managed-execution REST calls in `src/suwappu.ts`. The core repository can move ahead of package registries, so verify the SDK version you actually install and use the REST/OpenAPI contract as the fallback instead of copying an unpublished method into production.

## Production graduation checklist

Before turning the reference into a paid live service:

- Keep read, prepare, managed-execute, and signing authority explicit in the UI and code.
- Put customer/workflow state in a real database; do not share Flywheel's local JSON directory across workers.
- For a single-node deployment, persist and back up the state directory/`flywheel_state` volume and keep exactly one managed-execution writer.
- Persist intent/idempotency state atomically before managed submission.
- Bound outbound managed calls, classify ambiguous responses as outcome-unknown, and reconcile rather than blind-retrying.
- Simulate every fresh live quote and enforce wallet policies/caps/budgets independently.
- Reconcile final status before accounting, learning, notifications that claim completion, or billing tied to execution.
- Add historical replay/walk-forward evaluation appropriate to the strategy.
- Run one paper and one live ledger; never blend them.
- Expose a kill switch, audit history, alerts, and outcome-unknown recovery.
- Gate releases on typecheck/tests, all shipped entrypoint builds, a dependency audit, the container contract, and code scanning; keep your deployed artifact pinned and reproducible.
- Instrument first useful outcome -> retained use -> paid conversion -> contribution margin.
- Never market an example screen, quote, APY, backtest, or paper result as guaranteed profit.

Flywheel's best value is as a readable boundary between **idea**, **financial intent**, **irreversible action**, and **verified outcome**. Copy that boundary first; replace the example signals with the problem your users repeatedly pay you to solve.
