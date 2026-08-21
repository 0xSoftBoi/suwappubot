# Suwappu Execution Objective Spec

## Status

This document defines the quantitative objective, state representation, estimators, optimization problems, data contracts, and benchmark gates for Suwappu's pAMM maker, searcher, builder-routing, flash-liquidity, hedge, and capital-allocation system.

The core rule is simple: no subsystem optimizes a local proxy if doing so can reduce realized portfolio PnL. Maker spread, search routes, flash funding, builder bids, hedge timing, and yield allocation are all coupled through one portfolio objective.

## Builder-model data contract

Builder-market telemetry and Suwappu submission telemetry MUST remain separate until the training-row join.

- Relay `builder_blocks_received`, delivered payloads, and Titan top-bid updates describe market pressure and realized block delivery.
- Suwappu `BuilderSubmission` events describe our payment, expected pre-bid profit, opportunity age, slot phase, simulation confidence, and replacement sequence.
- Suwappu `BuilderOutcome` events provide labels for our submissions.
- Open submissions without terminal outcomes MUST NOT be labeled as losses.
- Replacement submissions collapse to the highest replacement sequence before training.
- Relay top-bid value is a feature; it is never substituted for Suwappu payment or inclusion outcome.

The first inclusion baseline is deliberately interpretable: one logistic model per builder, chronological walk-forward validation, Brier score and log-loss calibration metrics, and deterministic bid search maximizing:

```text
ExpectedRetainedValue(bid) = P_include(bid | context) * (ProfitBeforeBid - bid)
```

Reinforcement learning is out of scope until this baseline is calibrated on real Suwappu submission outcomes and demonstrates stable walk-forward performance.

## System objective

At decision time `t`, maximize expected risk-adjusted portfolio value over horizon `H`:

```text
J_t = E_t[
    MakerPnL_H
  + SearcherPnL_H
  + YieldPnL_H
  - BuilderLeakage_H
  - FailureLoss_H
]
  - lambda_q * InventoryRisk_H
  - lambda_lvr * LVR_H
  - lambda_dd * DrawdownRisk_H
  - lambda_liq * LiquidityShortfallRisk_H
```

A decision is accepted only if its expected incremental objective is positive after all marginal costs.

For one atomic search opportunity `o` executed via route `r`, funding source `f`, and builder `b`:

```text
EV(o,r,f,b) =
    P_include(o,r,b)
  * P_success(o,r,f,b)
  * [GrossPnL(o,r)
     - GasCost(r)
     - CalldataCost(r)
     - FundingCost(f)
     - BuilderPayment(b)
     - HedgeCost(o,r)
     - ExpectedAdverseSelection(o,r)]
  - LeakRisk(b,o)
  - FailureCost(o,r,f,b)
  - ReputationCost(b,o)
```

The searcher MUST rank routes by expected realized value, not gross arbitrage spread.

## Implementation status

The implementation lives under `execution/searcher/`, with a research-only executor baseline under `execution/executor-bench/`.

Current implemented components include deterministic replay, persisted fixtures, multi-horizon markouts, empirical LVR/toxicity labels, quote-denominated execution costs, versioned route graphs, bounded exact sizing, faster unimodal refinement checked against the exact oracle, Titan/MEV-Boost telemetry normalization, real frozen Titan relay fixtures, explicit Suwappu builder submission/outcome events, deterministic training-row joins, per-builder logistic inclusion baselines, chronological walk-forward evaluation, calibration metrics, and expected-retained-value bid optimization.

Transaction execution remains MONEY-PATH code and requires observed CI, adversarial/fork testing, semantic differential testing, and measured economic benefit before promotion.
