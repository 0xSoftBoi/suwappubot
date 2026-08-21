# Suwappu Execution Objective Spec

## Status

This document defines the quantitative objective, state representation, estimators, optimization problems, data contracts, and benchmark gates for Suwappu's pAMM maker, searcher, builder-routing, flash-liquidity, hedge, and capital-allocation system.

The core rule is simple: no subsystem optimizes a local proxy if doing so can reduce realized portfolio PnL. Maker spread, search routes, flash funding, builder bids, hedge timing, and yield allocation are all coupled through one portfolio objective.

## 1. System objective

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

The searcher MUST rank routes by this expected realized value, not gross arbitrage spread.

## 2. State vector

The canonical decision state is:

```text
S_t = {
  market_state,
  orderflow_state,
  pamm_state,
  builder_state,
  portfolio_state,
  funding_state,
  protocol_state,
  execution_cost_state,
  risk_state
}
```

### 2.1 Market state

Per instrument and venue:

```text
best_bid
best_ask
mid
microprice
bid_depth[N]
ask_depth[N]
book_slope
realized_vol_10ms
realized_vol_100ms
realized_vol_1s
realized_vol_12s
basis_to_reference
funding_rate
mark_price
last_trade_price
last_trade_side
last_trade_size
```

Fair value is multi-timescale. The engine MUST NOT collapse all horizons into one scalar.

### 2.2 Order-flow state

```text
book_imbalance
aggressive_buy_volume
aggressive_sell_volume
signed_volume_ewma
trade_sign_autocorrelation
buy_event_intensity
sell_event_intensity
large_trade_intensity
quote_acceptance_rate
post_fill_markout_by_horizon
```

The minimum imbalance feature is:

```text
I_t = (V_bid - V_ask) / (V_bid + V_ask)
```

### 2.3 Builder state

Per builder/relay:

```text
arrival_latency_ms
simulation_latency_ms
slot_phase_ms
recent_inclusion_rate
recent_revert_rate
recent_timeout_rate
median_payment_bps
reputation_tier
private_flow_available
supports_replacement
supports_end_of_block
supports_sponsorship
supports_trace
regional_endpoint
```

### 2.4 Portfolio state

```text
inventory_by_asset
inventory_usd
hot_capital
warm_capital
cold_capital
unrealized_hedge_delta
realized_pnl
inventory_age
strategy_liquidity
max_withdrawable_yield_capital
```

### 2.5 Funding state

For every capital source `f`:

```text
available_amount
explicit_fee
marginal_gas
callback_cost
failure_probability
opportunity_cost
latency_cost
```

Examples:

```text
internal_hot_inventory
internal_warm_inventory
Aave flashLoanSimple
ERC-3156 source
protocol-native flash accounting
```

## 3. Fair-value engine

The maker, searcher, and hedger MUST share the same fair-value engine.

For horizon `tau`:

```text
FV(t,tau) =
    mid_t
  + beta_I(tau) * imbalance_t
  + beta_F(tau) * signed_flow_t
  + beta_B(tau) * basis_t
  + beta_M(tau) * microprice_dislocation_t
  + beta_X(tau) * cross_venue_signal_t
```

The initial production implementation SHOULD use interpretable linear / regularized models before nonlinear models.

Required outputs:

```text
fv_10ms
fv_100ms
fv_1s
fv_12s
fv_sigma_10ms
fv_sigma_100ms
fv_sigma_1s
fv_sigma_12s
```

All model predictions MUST carry uncertainty estimates or calibrated prediction intervals.

## 4. Markout and toxicity model

Every pAMM fill is labeled by future markout:

```text
M_tau = side * (P_fill - FV_{t+tau})
```

where `side = +1` for maker sell and `-1` for maker buy, so positive markout means maker-favorable execution.

Required horizons:

```text
10ms
100ms
500ms
1s
1 block
5 blocks
```

Condition the estimator on:

```text
venue
builder
side
size
spread
quote_age
inventory
volatility
book_imbalance
signed_flow
slot_phase
hedge_depth
```

The maker SHOULD widen, reduce size, or close when expected markout becomes sufficiently negative.

Define toxicity probability:

```text
Tox_t = P(M_tau < -loss_threshold | S_t)
```

This value feeds maker spread and max size.

## 5. pAMM quote-control objective

For maker side `s` and size `x`:

```text
ExpectedMakerEdge(s,x) =
    SpreadCaptured(s,x)
  - ExpectedLVR(s,x)
  - ExpectedMarkoutLoss(s,x)
  - ExpectedHedgeImpact(s,x)
  - InventoryPenalty(s,x)
  - QuoteUpdateCost
```

A quote MUST NOT be emitted if this quantity is non-positive after safety margin.

### 5.1 Reservation price

Initial reservation price:

```text
r_t = FV_t - gamma * sigma_t^2 * T_hedge * q_t
```

where:

```text
q_t      = signed inventory
sigma_t  = horizon-consistent volatility
T_hedge  = expected hedge latency
```

### 5.2 Dynamic half-spread

```text
h_t(x) =
    h_base
  + a_sigma * sigma_t
  + a_tox * Tox_t
  + a_latency * builder_execution_uncertainty
  + a_hedge * ExpectedHedgeImpact(x)
  + a_inv * abs(q_t)
  + a_size1 * x
  + a_size2 * x^2
```

Quotes:

```text
bid_t(x) = r_t - h_t(x)
ask_t(x) = r_t + h_t(x)
```

### 5.3 Dynamic-fee control

Maker fee/spread control SHOULD be volatility- and toxicity-sensitive and SHOULD include an economic deadband.

Do not update quote parameters when:

```text
ExpectedBenefit(new_quote) <= UpdateGas + BuilderUpdateCost + StateChurnRisk
```

This prevents over-reactive micro-updates whose expected edge is smaller than their operational cost.

## 6. LVR accounting

Every pAMM fill MUST have an estimated Loss-Versus-Rebalancing contribution.

At minimum:

```text
LVR_fill ~= value of fill versus contemporaneous external fair value
```

The production estimator SHOULD be benchmarked against the formal LVR framework for AMMs.

Track:

```text
gross_spread_capture
estimated_lvr
realized_markout
hedge_cost
net_maker_edge
```

The maker objective MUST optimize net edge after LVR, not fee revenue alone.

## 7. Event-intensity model

Short-horizon flow is clustered. The initial implementation MAY use exponentially weighted event intensity:

```text
lambda_buy_t = mu_buy + EWMA(recent_buy_events)
lambda_sell_t = mu_sell + EWMA(recent_sell_events)
```

A calibrated Hawkes upgrade SHOULD use:

```text
lambda_t = mu + sum_i alpha * exp(-beta * (t - t_i))
```

Separate self- and cross-excitation terms for buy/sell/large-trade events.

The maker may use intensity asymmetry to skew quotes before inventory changes occur.

## 8. Search graph

The searcher maintains a directed token/venue graph.

Each edge exposes:

```text
quote(x)
marginal_price(x)
execution_gas
calldata_bytes
fixed_activation_cost
liquidity_limit
settlement_domain
state_version
```

A state update invalidates only routes touching the changed edges.

The engine MUST use incremental recomputation rather than rescanning all cycles after every tick.

## 9. Gas-aware routing optimization

Routing is a fixed-cost optimization problem.

For venue activations `z_i in {0,1}` and flow `x_i`:

```text
maximize:
    Utility(final_output)
  - sum_i FixedExecutionCost_i * z_i
  - sum_i VariableTradingCost_i(x_i)
```

subject to venue conservation and liquidity constraints.

The optimizer SHOULD:

1. solve a continuous relaxation;
2. identify economically plausible venue activations;
3. enumerate a small neighborhood of route topologies;
4. optimize input size for each candidate;
5. exact-EVM simulate finalists;
6. compile only the winner.

Do not brute-force every route on-chain.

## 10. Input-size optimization

For a route `r`:

```text
x* = argmax_x [Output_r(x) - x - TotalExecutionCost_r(x)]
```

`TotalExecutionCost` includes:

```text
protocol fees
price impact
gas
calldata
flash funding
builder payment
hedge impact
failure reserve
```

For smooth route segments, numerical root-finding MAY use Brent/Newton methods. Piecewise/tick-based routes MUST segment discontinuities before optimization.

## 11. Capital-source optimizer

Funding is solved as a marginal cost problem.

For source `f`:

```text
C_f(x) =
    explicit_fee_f(x)
  + gas_f(x)
  + opportunity_cost_f(x)
  + failure_risk_f(x)
  + liquidity_risk_f(x)
```

Choose:

```text
f* = argmin_f C_f(x)
```

subject to source capacity and protocol constraints.

Own capital is NOT treated as free. Its opportunity cost includes foregone yield and inventory utilization.

## 12. Dynamic hot/warm/cold capital allocation

Capital buckets are stochastic reserves, not fixed percentages.

Choose hot liquidity `H_t` so that:

```text
P(Demand_{t,t+Delta} > H_t) < epsilon
```

where `Demand` is predicted short-horizon execution capital demand.

Suggested tiers:

```text
hot  = executor / immediately spendable inventory
warm = synchronously withdrawable yield capital
cold = slower / higher-yield capital
```

The capital allocator objective is:

```text
maximize:
    SearchExecutionPnL
  + MakerPnL
  + PassiveYield
  - LiquidityShortfallPenalty
  - CapitalMovementCost
```

The mixed-yield primitive's `maxWithdraw` / live-liquidity semantics feed directly into this model.

## 13. Builder inclusion model

Per builder `b`, estimate:

```text
P_include = sigmoid(
    beta0
  + beta1 * builder_payment
  + beta2 * gross_ev
  + beta3 * opportunity_age_ms
  + beta4 * slot_phase_ms
  + beta5 * simulation_confidence
  + beta6 * builder_reputation_state
  + beta7 * strategy_class
)
```

Start with logistic regression or isotonic calibration. Do not use reinforcement learning until the baseline is calibrated and stable.

Builder bid optimization:

```text
bid* = argmax_bid P_include(bid) * (ProfitBeforeBid - bid)
```

The builder engine MUST learn builder-specific curves rather than applying one global profit percentage.

## 14. Builder order-management state machine

Every search opportunity has an order-management lifecycle:

```text
NEW
SIMULATED
SUBMITTED
LIVE
REPLACE_PENDING
REPLACED
CANCEL_PENDING
LANDED
REVERTED
EXPIRED
DROPPED
```

Where replacement APIs exist, reuse one opportunity identity and monotonically replace stale candidate bundles instead of spraying unrelated submissions.

Track late-cancel risk explicitly.

## 15. Builder trace dataset

Persist per submission:

```text
opportunity_id
strategy_class
builder
region
submit_timestamp_ns
slot
slot_phase_ms
simulation_timestamp_ns
simulation_result
replace_sequence
builder_payment
bundle_gas
calldata_bytes
estimated_gross_pnl
landed
landed_block
winning_builder
realized_pnl
failure_reason
trace_reason
```

This dataset is required for builder inclusion and bidding calibration.

## 16. pAMM quote sequencing and freshness

Each quote update MUST be ordered and replay-resistant:

```text
epoch
sequence
valid_block_min
valid_block_max
valid_until_timestamp
prev_quote_hash
quote_parameters
```

with:

```text
Q_n = H(Q_{n-1}, epoch, sequence, validity, parameters)
```

Swaps MUST reject stale/invalid quote epochs.

Where builder commitments or acknowledgements are available, their evidence SHOULD be stored off-chain to detect stale-quote sequencing behavior.

## 17. pAMM operating modes

Required risk modes:

```text
STRICT
  builder-conditioned freshness required

PROTECTED
  wider spread / lower size under weaker guarantees

FALLBACK
  bounded passive execution surface

CLOSED
  no new maker execution
```

Mode selection depends on builder coverage, price-source health, markout toxicity, inventory, and hedge-venue health.

## 18. Hedge optimizer

A fill does not imply an immediate 1:1 market hedge.

Define inventory urgency:

```text
Urgency_t = f(
  abs(q_t),
  sigma_t,
  inventory_age,
  risk_limit_distance,
  hedge_depth,
  expected_offsetting_flow
)
```

The hedge optimizer chooses immediate and scheduled hedge components:

```text
hedge_now + hedge_later = desired_delta_reduction
```

Objective:

```text
minimize:
    expected_price_risk
  + temporary_impact
  + persistent_impact
  + fees
  + execution_failure_risk
```

## 19. Execution compiler

Economic search output is compiled into a minimal execution representation.

The compiler SHOULD choose among:

```text
specialized route executor
small conditional executor
compact generic executor VM
```

Preference order:

```text
specialized > bounded conditional > generic
```

when economic behavior is identical.

## 20. Execution IR

Minimum candidate opcode set:

```text
LOAD_BALANCE
STATICCALL_QUOTE
CMP_GT
CMP_LT
JUMP_IF
TRANSFER
APPROVE
CALL
FLASH
UNIV3_SWAP
UNIV4_UNLOCK
PAMM_SWAP
CURVE_SWAP
ASSERT_BALANCE_DELTA
PAY_BUILDER
SWEEP
```

The IR MUST support bounded on-chain evaluation but MUST NOT perform broad on-chain opportunity discovery.

## 21. Final-state postconditions

Every atomic program must assert economic outcome, not only intermediate `minOut`s.

Required postconditions:

```text
all flash debt repaid
starting non-strategy balances restored where required
profit asset balance >= starting balance + min_profit
no unauthorized residual approvals
no unexpected residual tokens above dust budget
builder payment <= configured maximum
```

The final profit assertion is the ultimate execution invariant.

## 22. Flash callback hardening

Flash callbacks MUST authenticate:

```text
msg.sender == configured liquidity source
initiator == executor where protocol exposes initiator
asset == expected asset
amount == expected amount
program_hash == transient expected hash
```

The callback MUST NOT interpret arbitrary unauthenticated user calldata.

## 23. Transient state

Transient storage is permitted only for transaction-local execution context such as:

```text
execution_lock
expected_flash_source
expected_asset
expected_amount
program_hash
beneficiary
```

Governance, strategy configuration, and persistent accounting MUST NOT depend on transient state.

## 24. Gas model

Every route shape exports an empirical cost model:

```text
gas_base
gas_per_leg
calldata_bytes
external_calls
erc20_transfers
storage_reads
storage_writes
transient_reads
transient_writes
```

The model MUST be fitted from actual fork execution, not static guesses.

Gas optimization priorities:

1. fewer external calls;
2. fewer token transfers;
3. protocol-native net settlement;
4. less calldata;
5. fewer dynamic allocations;
6. fewer approvals;
7. transient transaction-local state;
8. assembly only where benchmarked.

Micro-assembly optimization MUST NOT ship without measured benefit.

## 25. Specialized executor policy

A route family MAY receive a specialized executor when all are true:

```text
material share of realized/searchable PnL
stable venue interfaces
stable route topology
measurable gas/calldata advantage
fuzz-equivalent economic behavior
manageable audit surface
```

Examples to benchmark:

```text
PAMM -> Uniswap v4
Uniswap v3 -> Uniswap v4
Curve -> pAMM
Aave flash -> pAMM -> Uniswap v4
```

## 26. Benchmark suite

### 26.1 Contract benchmark

Per route shape record:

```text
gas_used
calldata_bytes
runtime_bytecode_size
external_call_count
token_transfer_count
approval_count
profit_assertion_cost
```

Compare:

```text
baseline Solidity
optimized Solidity
selective assembly
specialized executor
```

### 26.2 Search benchmark

Measure:

```text
market-update -> state-update latency
state-update -> candidate latency
candidate -> size-optimized latency
candidate -> exact-simulation latency
simulation throughput/sec
compile latency
sign latency
submit latency
```

Required percentiles:

```text
p50
p95
p99
p99.9
```

### 26.3 Economic benchmark

Per maker fill:

```text
gross_spread
LVR
10ms/100ms/1s/block markout
hedge_cost
inventory_pnl
builder_cost
net_edge
```

Per search execution:

```text
gross_arb
protocol_fees
gas
calldata
funding
builder_payment
failure_cost
realized_net_pnl
```

## 27. Economic adversarial simulation

The research harness MUST simulate:

```text
20-100 bps price jumps
10ms / 100ms / 1s / 12s quote latency
builder quote-update censorship
older-quote inclusion
selectively toxic takers
CEX outage
pAMM stream outage
hedge-depth collapse
stablecoin depeg
flash liquidity disappearance
Aave/Morpho liquidity contraction
inventory one-sided accumulation
builder inclusion collapse
base-fee spike
```

For each scenario measure:

```text
maker drawdown
LVR
inventory VaR
hedge slippage
searcher failure rate
capital shortfall
net portfolio PnL
```

## 28. Dataset contracts

### 28.1 Market event

```text
ts_ns
venue
instrument
event_type
bid
ask
bid_size
ask_size
trade_price
trade_size
trade_side
sequence
```

### 28.2 pAMM quote event

```text
ts_ns
quote_id
epoch
sequence
instrument
mid
bid_spread
ask_spread
size_curve
inventory
builder_mode
validity
```

### 28.3 Fill event

```text
ts_ns
quote_id
fill_id
side
size
price
builder
slot
slot_phase
inventory_before
inventory_after
```

### 28.4 Markout label

```text
fill_id
fv_10ms
fv_100ms
fv_500ms
fv_1s
fv_1block
fv_5block
markout_10ms
markout_100ms
markout_500ms
markout_1s
markout_1block
markout_5block
```

### 28.5 Search candidate

```text
opportunity_id
state_version
route_hash
input_size
gross_pnl
expected_gas
expected_calldata
expected_funding_cost
expected_builder_payment
expected_success_probability
expected_inclusion_probability
expected_ev
```

## 29. Calibration discipline

Every model must support walk-forward evaluation.

Forbidden:

```text
random train/test split across time
future-state leakage
using realized execution values as contemporaneous features
backtests that ignore failed/reverted submissions
backtests that omit builder payment or gas
```

Required:

```text
rolling train window
forward validation window
regime breakdown
transaction-cost-complete PnL
latency perturbation tests
```

## 30. Release gates

A subsystem is not production-ready because it works on historical PnL.

### Fair-value gate

```text
calibrated forecast error
stable out-of-sample sign/scale
no future leakage
regime-aware degradation metrics
```

### Maker gate

```text
positive net edge after LVR + markout + hedge cost
bounded drawdown under toxicity scenarios
inventory limits never exceeded
quote freshness invariants pass
```

### Searcher gate

```text
exact-sim success rate above configured threshold
realized/gross PnL ratio measured
failure rate bounded
no broad on-chain probing strategy
```

### Builder gate

```text
inclusion model calibrated
replacement/cancel lifecycle tested
trace reasons persisted
builder-specific EV ranking implemented
```

### Executor gate

```text
postcondition fuzzing
flash callback authentication tests
fork tests on supported venues
assembly equivalence tests
measured gas advantage
no arbitrary-call wallet surface
```

### Capital gate

```text
hot-liquidity shortfall probability below epsilon
warm-liquidity semantics use real protocol maxWithdraw/cash
stress loss bounded under yield-liquidity contraction
```

## 31. Initial implementation sequence

The first implementation phase SHOULD be research-instrumentation-first:

1. Define shared event/data schemas.
2. Build markout labeling pipeline.
3. Add LVR accounting per maker fill.
4. Build incremental venue graph and gas-aware route objective.
5. Build exact route-size optimizer.
6. Add builder submission telemetry and trace ingestion.
7. Fit baseline inclusion/bid model.
8. Build dynamic spread + inventory-skew controller.
9. Add capital-source optimizer.
10. Add hedge urgency model.
11. Benchmark generic vs specialized executor paths.
12. Only then commit to route-specific assembly specialization.

## 32. Research references

The design is informed by the following research directions:

- Milionis, Moallemi, Roughgarden, Zhang — Automated Market Making and Loss-Versus-Rebalancing.
- Milionis, Moallemi, Roughgarden — Automated Market Making and Arbitrage Profits in the Presence of Fees.
- Campbell, Bergault, Milionis, Nutz — Optimal Fees for Liquidity Provision in Automated Market Makers.
- Ghasemlu — Optimal Dynamic Fees for Automated Market Makers: A Stochastic Control Approach to Loss-Versus-Rebalancing.
- Cartea, Drissi, Monga — Predictable Loss and Optimal Liquidity Provision.
- Angeris, Evans, Chitra, Boyd — Optimal Routing for Constant Function Market Makers.
- Fixed-cost / gas-aware CFMM routing research extending convex routing with activation costs.
- Cartea / Jaimungal market-making and optimal-execution literature on order-flow imbalance, inventory risk, and execution impact.
- Empirical PBS / private-orderflow literature on builder concentration, inclusion, and block-value competition.
- Recent empirical arbitrage work contrasting targeted off-chain search with broad on-chain probing.

The implementation MUST use these as starting points, then validate every assumption with Suwappu-specific data.
