# Strategy Lifecycle: Replay -> Paper -> Live

A strategy example becomes useful when a builder can answer two questions: **would this decision have survived realistic costs?** and **can I operate the same logic safely with real state?**

Use one decision engine across historical replay, paper trading, and live execution. Only the market-data/execution adapters should change.

## The promotion path

| Stage | Capital moves? | What must be true before promotion |
|-------|----------------|------------------------------------|
| Historical replay / backtest | No | No look-ahead, realistic costs, reproducible inputs, net metrics recorded |
| Live paper | No | Same live signals and quote path as production; restart-safe state; alerts/reconciliation work |
| Capped live | Yes, small limits | Explicit live flag, policies/caps, simulation, idempotency, failure recovery, reconciled fills |
| Scaled live | Yes | Enough observed live history to justify the risk; limits remain in force |

Do not skip paper mode because a backtest looks attractive. Historical data does not reproduce RPC failures, stale quotes, rate limits, partial upstream outages, or your own scheduler bugs.

## 1. Write the strategy as a pure decision

Separate the decision from execution:

```ts
type Decision =
  | { action: 'hold'; reason: string }
  | { action: 'swap'; from: string; to: string; amount: string; reason: string }

function decide(snapshot: MarketSnapshot, state: StrategyState): Decision {
  // No network calls and no wallet side effects here.
  return { action: 'hold', reason: 'example' }
}
```

The replay runner feeds historical snapshots to `decide()`. Paper mode feeds current snapshots and records the hypothetical execution. Live mode feeds the same snapshots, then puts the resulting intent through quote, simulation, policy, and execution gates.

This makes strategy changes testable without granting a test suite access to funds.

## 2. Model costs before calling anything profit

Gross price movement is not P&L. At minimum record:

- entry and exit/final mark prices;
- actual or modeled venue fee;
- gas and bridge fees;
- quoted minimum output and realized output;
- realized slippage versus the decision-time reference;
- position size and capital locked/used;
- timestamps for decision, quote, submission, and finalization.

For a closed position:

```text
net P&L = exit value - entry value - all execution costs
```

For an open position, report unrealized mark-to-market separately. Never mark a buy as profitable because its entry quote returned more destination units than a naive conversion expected.

## 3. Backtest without hindsight

Historical replay should only expose information that would have been available at each decision timestamp. Pin the strategy configuration and data range so another developer can reproduce the run.

Useful report fields include:

- net return after modeled costs;
- realized and unrealized P&L;
- maximum drawdown;
- turnover and number of actions;
- average modeled/realized slippage;
- capital utilization and peak exposure;
- win/loss rate when the strategy actually has closed trades;
- rejected/skipped decisions and why.

Sharpe or another risk-adjusted metric can be helpful on enough data, but it is not a substitute for the cost ledger or drawdown.

## 4. Paper trade the production path

Paper mode should call the same live discovery, price, quote, and simulation paths as live mode. It should stop immediately before the irreversible action and record what it **would** have done.

For a Suwappu swap flow:

```text
get live state
  -> strategy decision
  -> POST /quote
  -> POST /swap/simulate
  -> policy/approval check
  -> record paper intent
  -> STOP
```

Persist enough state that a restart cannot duplicate an interval or forget an in-flight intent. Paper mode is where you test scheduling, idempotency keys, webhook handling, stale-quote refreshes, and alerting.

## 5. Make live execution an explicit capability

Use a positive opt-in such as `SUWAPPU_LIVE=1`; absence must mean no funds move. Add a second control at the wallet/policy layer so one environment-variable mistake cannot remove every limit.

A robust managed-wallet flow is:

```text
fresh quote
  -> simulation passes
  -> expected cost stays inside strategy threshold
  -> wallet policy / approval passes
  -> idempotent managed execution
  -> status/webhook reconciliation
  -> ledger update from realized result
```

For self-custody, replace managed execution with unsigned transaction preparation and an explicit wallet signature. Never describe preparation as submission.

## 6. Design retries around side effects

Reads and fresh quote requests are usually safe to retry with normal backoff. An execution timeout is different: first determine whether a side effect occurred. Use idempotency keys and a durable intent record for managed execution; reconcile status before submitting another economic action.

If the process crashes between submission and persistence, recovery should search/reconcile the known intent instead of simply firing the trade again.

## 7. Keep a decision and money ledger

For every cycle store something like:

```json
{
  "strategyVersion": "2026-08-06.1",
  "mode": "paper",
  "decisionAt": "2026-08-06T14:00:00Z",
  "decision": "swap",
  "reason": "target drift 8.2% > 5% threshold",
  "quoteId": "q_...",
  "expectedOutput": "...",
  "minimumOutput": "...",
  "estimatedGasUsd": "...",
  "estimatedRouteFeeUsd": "...",
  "simulationPassed": true,
  "executionId": null,
  "txHash": null
}
```

Live reconciliation later fills the execution/fill fields. That is what lets you distinguish strategy error, execution cost, infrastructure failure, and model/operator error.

## 8. Report the two scoreboards

If this strategy powers a paid product, show two independent scoreboards:

1. **Customer strategy outcome:** net P&L, drawdown, costs, exposure, and reliability.
2. **Builder business outcome:** customer revenue minus Suwappu/API, model, infrastructure, subsidized chain costs, support, and refunds.

See [Build a Business on Suwappu](build-a-business.md) for the builder-margin model.

## Reference implementation

[`suwappu-flywheel`](https://github.com/0xSoftBoi/suwappu-flywheel) is the ecosystem's strategy-lab example. Its job is to make this replay -> paper -> live contract reusable so DCA, rebalancing, arbitrage research, and trading examples do not each reinvent accounting and promotion rules.

Treat any example strategy as educational infrastructure, not a promise of profit. Promote based on measured evidence and operational safety, not backtest cosmetics.
