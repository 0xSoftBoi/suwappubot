# Build a Strategy Product with Flywheel

[`suwappu-flywheel`](https://github.com/0xSoftBoi/suwappu-flywheel) is the compact reference for turning Suwappu market data, quotes, and managed execution into a stateful product without pretending that an accepted request is already a fill.

Use it when you want to learn or copy the **application architecture** around a strategy. Do not treat its DCA, grid, arb, prediction, yield, or scalper examples as evidence that a strategy is profitable.

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
| Durable Suwappu intent + idempotency + reconciliation example | Included | You need a distributed production order/fill service |
| Historical backtesting | Not a built-in engine | You need reproducible large-scale backtests and analysis |
| Exchange/venue connector ecosystem | Not its goal | You need many native trading connectors |
| Production observability | Readable local reference state | You need database-backed ledgers, queues, leases, and fleet operations |

[Freqtrade](https://www.freqtrade.io/en/stable/strategy-101/) is a useful benchmark for backtesting plus dry-run/forward evaluation. [Hummingbot](https://github.com/hummingbot/hummingbot) is a useful benchmark for broader algorithmic-trading and connector infrastructure.

Do not rebuild either inside Flywheel. Combine the evaluation or infrastructure you actually need with Suwappu's action surface.

## Start in paper mode

Requirements: Bun 1.3+ and a Suwappu agent key.

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

`arb` is intentionally quote/screening-only. A real cross-chain arbitrage workflow needs both legs, bridge/inventory handling, reconciliation, and an unwind policy; executing one buy leg is not arbitrage.

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

If a request times out or returns a 5xx after submission may have started, its outcome is unknown. Keep the same economic intent and idempotency key. If a `swap_id` is known, poll it rather than submitting another trade.

Inspect the local journal at any time:

```bash
bun run src/cli.ts executions
bun run src/cli.ts executions --reconcile
```

`--reconcile` only polls known swaps; it does not create a new action.

The reference journal is a local JSON file. For a multi-worker paid service, move the same state machine into a transactional database, enforce a unique economic-intent key, and add locking/leases plus an append-only audit trail.

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

If you want self-custody instead, `POST /v1/agent/swap` prepares an **unsigned** transaction for the user's wallet to review and sign. That is a different authority model from managed `POST /swap/execute`.

The Docker and `run-dca.sh` entrypoints follow the same safe default: one paper/read-only run unless live execution is explicitly requested. Avoid restart loops around a money-moving one-shot command.

## SDK version boundary

Flywheel currently installs the published `@suwappu/sdk` contract used for quote construction and isolates newer managed-execution REST calls in `src/suwappu.ts`. The core repository can move ahead of package registries, so verify the SDK version you actually install and use the REST/OpenAPI contract as the fallback instead of copying an unpublished method into production.

## Production graduation checklist

Before turning the reference into a paid live service:

- Keep read, prepare, managed-execute, and signing authority explicit in the UI and code.
- Put customer/workflow state in a real database; do not share Flywheel's local JSON directory across workers.
- Persist intent/idempotency state atomically before managed submission.
- Simulate every fresh live quote and enforce wallet policies/caps independently.
- Reconcile final status before accounting, learning, notifications that claim completion, or billing tied to execution.
- Add historical replay/walk-forward evaluation appropriate to the strategy.
- Run one paper and one live ledger; never blend them.
- Expose a kill switch, audit history, alerts, and outcome-unknown recovery.
- Instrument first useful outcome -> retained use -> paid conversion -> contribution margin.
- Never market an example screen, quote, APY, backtest, or paper result as guaranteed profit.

Flywheel's best value is as a readable boundary between **idea**, **financial intent**, **irreversible action**, and **verified outcome**. Copy that boundary first; replace the example signals with the problem your users repeatedly pay you to solve.
