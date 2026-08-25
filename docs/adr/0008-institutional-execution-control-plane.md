# ADR 0008: Institutional execution control plane

- Status: Proposed
- Date: 2026-08-24
- Scope: Suwappu best execution, cross-chain routing, solver routing, venue routing
- Parent program: #899
- Precursor: #937
- Related: #898, #902, #904, #907, #938, #939

## Context

A route scorer is not an institutional execution system.

Institutional users require a system that can prove which routes were considered, which were rejected, why the selected plan was permitted, which market and risk data authorized that decision, and what happened after execution. Low-latency trading users additionally require deterministic behavior, explicit tail-risk controls, bounded jitter, high availability, and operational isolation when a venue or dependency degrades.

Suwappu therefore needs two separate layers:

1. **Control plane / feasibility** — decides whether a candidate is permitted to compete.
2. **Optimization / execution** — ranks or solves only across candidates that survived the control plane.

A weighted score must never override a hard risk, compliance, authorization, freshness, capital, recovery, settlement, or venue-health constraint.

This ADR does not claim that Suwappu is a broker-dealer, investment manager, exchange, or otherwise subject to a particular securities rule. FINRA Rule 5310 and SEC Rule 15c3-5 are used as useful engineering references for best-execution review and pre-trade risk-control design where relevant.

## External engineering references

- BlackRock Aladdin describes pre-, during-, and post-trade compliance, quality-controlled data, exception workflows, risk monitoring, and auditability as core institutional platform capabilities.
- Jane Street describes determinism, tail-event analysis, low jitter, high throughput, strong reliability guarantees, and real-time trading visibility as core properties of its trading technology.
- FINRA Rule 5310 requires reasonable diligence in determining the best market and ongoing review of execution quality for covered activity.
- SEC Rule 15c3-5 requires documented pre-trade financial and regulatory risk controls for covered market access.
- Circle CCTP is now the canonical CCTP version. Standard Transfer and Fast Transfer have materially different finality and fee characteristics and must be modeled as separate candidates.

References:

- https://www.blackrock.com/aladdin/benefits/compliance
- https://www.blackrock.com/aladdin/platforms/products/aladdin-risk
- https://www.janestreet.com/performance-engineering/
- https://www.janestreet.com/what-we-do/overview/
- https://www.finra.org/finramanual/rules/r5310/
- https://www.sec.gov/rules/final/2010/34-63241fr.pdf
- https://www.circle.com/cross-chain-transfer-protocol

## Decision

### 1. All money-path candidates pass a versioned hard feasibility gate

Before optimization, every candidate is evaluated against a policy identified by immutable `policyVersion`.

Minimum institutional gate inputs:

- authorization/custody state
- quote timestamp and expiry
- executable economics, not display-only headline output
- settlement type and trust class
- jurisdiction/compliance decision
- expected duration/finality bounds
- executable capacity for the requested notional
- recovery/refund availability
- venue/provider health
- data confidence and provenance
- account capital/collateral/buying power when applicable

Unknown values remain unknown. A strict institutional policy may reject an unknown value rather than assign it a neutral score.

PR #937 introduces `routeFeasibility.ts` as the first pure, deterministic control-plane primitive. It is intentionally not connected to live execution yet.

### 2. Rejections use stable reason codes

Every infeasible candidate returns machine-readable reason codes. Examples:

- `quote_expired`
- `capacity_insufficient`
- `compliance_unknown`
- `settlement_not_allowed`
- `authorization_unconfirmed`
- `recovery_unavailable`
- `venue_degraded`
- `data_confidence_below_minimum`

These codes are part of the execution audit contract. They may be aggregated into operator dashboards, client reports, post-trade analysis, and policy-review workflows.

### 3. Optimization only sees eligible candidates

The optimizer cannot rescue an infeasible route with better price, lower fees, or faster latency.

Among feasible candidates, optimization remains versioned and explainable. The objective may include:

`expected all-in execution cost + latency/finality risk + failure/recovery risk + lambda * tail risk`

For sufficiently large or sensitive orders, optimization must support worst-case/CVaR-style penalties and explicit scenario stress rather than expectation-only ranking.

### 4. Asset-manager and market-maker profiles are policy families, not brand names

Do not hard-code customer names such as BlackRock or Jane Street in runtime policy.

Use explicit, versioned policy families instead:

- `asset_manager/*` — stronger emphasis on mandate/compliance, settlement certainty, operational recovery, auditability, and reconciled state.
- `market_maker/*` — stronger emphasis on quote freshness, deterministic latency, fill probability, inventory/capital constraints, venue health, and tail jitter.

Both families inherit the same non-bypassable authorization, security, and accounting controls.

### 5. CCTP Standard and Fast Transfer are distinct candidates

For native USDC routes, CCTP must not appear as one generic `issuer_native` route.

Model at least:

- CCTP Standard Transfer
- CCTP Fast Transfer

Each candidate must carry its own:

- quoted fee
- attestation/finality mode
- expected completion distribution
- current Fast Transfer availability/allowance signal where applicable
- source/destination support
- transaction size/capacity constraints
- recovery semantics
- destination mint/forwarding behavior

Fast Transfer is infeasible when required capacity/allowance or fee data is unavailable under a strict policy; it does not merely receive a lower score.

### 6. Every execution produces a replayable decision record

Before any live MONEY-PATH promotion, persist an append-only decision envelope containing:

- intent ID and order type
- policy version
- optimizer/model version
- candidate snapshot IDs
- source timestamps and provenance
- all feasibility decisions and reason codes
- winner and top alternatives
- cost/risk decomposition
- authorization identity and policy scope
- preflight snapshot
- submit timestamp and execution identifiers
- settlement/recovery identifiers
- realized result and post-trade reconciliation
- counterfactual regret versus captured alternatives

Replay invariant:

> The same normalized candidate set, same policy version, same optimizer version, and same injected clock must reproduce the same feasibility result and ranking.

### 7. Pre-trade and in-flight controls are separate

Passing the initial feasibility gate does not authorize execution forever.

Immediately before submission, revalidate at minimum:

- quote expiry/freshness
- venue/provider health
- balances/collateral/reservations
- slippage/min-received/price bounds
- gas/fee bounds
- chain health/finality assumptions
- authorization and kill-switch state

If the preflight snapshot materially differs from the decision snapshot, invalidate and recompute rather than silently mutating the plan.

### 8. Operational controls are first-class

Required before institutional production:

- global execution kill switch
- per-chain, per-venue, per-provider kill switches
- notional and concentration limits
- provider/venue circuit breakers
- retry budgets with idempotency keys
- duplicate-execution prevention
- bounded queue/backpressure behavior
- dead-letter/recovery workflows
- maker-checker approval for policy changes
- staged rollout and instant rollback
- immutable policy/version history

No deployment or runtime configuration change may silently widen a money-path risk limit.

### 9. Post-trade reconciliation closes the loop

Execution success is not equivalent to settlement success.

Track states such as:

`authorized -> submitted -> source_confirmed -> attested/fill_confirmed -> destination_confirmed -> reconciled`

A plan is terminal-success only after the expected asset/account state is reconciled.

Recovery/refund states must be explicit and measurable.

### 10. Execution quality is reviewed from realized data

Shadow and live systems must capture enough counterfactual evidence to answer:

- What alternatives were executable at decision time?
- Why was each alternative rejected or ranked lower?
- What was the expected all-in result?
- What actually happened?
- How much regret/slippage/latency/failure occurred relative to the best feasible counterfactual?

Route priors are bootstrapping assumptions only. Replace static settlement/recovery priors over time with measured distributions and confidence/sample-size metadata. Learned estimates may affect optimization but never bypass hard feasibility.

## Performance and determinism requirements

Do not choose vanity latency targets in this ADR. Each deployed profile must publish measured budgets for:

- candidate normalization p50/p95/p99
- feasibility p50/p95/p99
- optimizer p50/p95/p99
- preflight p50/p95/p99
- end-to-end decision jitter
- dependency timeout budget
- stale-data rejection rate

Benchmark the critical path with representative candidate counts and adverse dependency behavior. Tail latency and jitter are release gates, not dashboard curiosities.

## Data governance requirements

Every market/routing signal used to authorize execution must have:

- source/provider
- observation timestamp
- schema/version
- confidence/quality state
- freshness policy
- normalization logic version

Do not silently coerce malformed or missing external data into zero, success, or `healthy`.

## Security boundary

The execution system assumes all external quote, solver, venue, bridge, token, RPC, attestation, and chain metadata can be malformed, stale, contradictory, or adversarial.

Provider names and token symbols are display metadata, not authorization identity. Canonical asset identity must be chain/domain + verified address/asset ID. Contract targets, approval spenders, calldata destinations, and settlement recipients require explicit allowlist/verification policy before signing.

## Promotion gates

PR #937 may remain shadow-only until all of the following are true:

1. TypeScript and repository CI are green on the exact head.
2. Feasibility reason-code tests cover missing, stale, degraded, unauthorized, over-capacity, and disallowed-settlement cases.
3. #938 emits real CCTP Standard/Fast normalized candidates with canonical native-USDC identity.
4. #939 supplies jurisdiction/compliance policy results rather than a synthetic score.
5. Candidate decisions and rejected reason codes are persisted, not only logged.
6. Realized settlement/TCA can join back to the exact decision snapshot.
7. Global and scoped kill switches exist and are tested.
8. Preflight revalidation is implemented.
9. Duplicate execution/idempotency behavior is tested under retry and partial failure.
10. A soak/shadow period demonstrates stable tail latency and no money-path side effects.
11. An adversarial review signs off on provider trust boundaries, signing targets, asset identity, and recovery semantics.
12. Live activation uses staged notional limits with immediate rollback.

## Consequences

### Positive

- Hard controls cannot be outweighed by price.
- Institutional decisions become replayable and explainable.
- Best-execution review can use realized evidence rather than provider marketing claims.
- Asset-manager and market-maker requirements can diverge without forking the execution engine.
- New bridges, solvers, venues, and issuer-native rails become replaceable adapters behind one control plane.

### Negative

- More data must be known before a route is eligible.
- Strict policies will intentionally reject routes that retail routing might accept.
- Adapter implementation becomes more demanding because capacity, recovery, health, provenance, and confidence are part of the contract.
- Production activation takes longer because reconciliation and operational controls become mandatory rather than follow-up work.

That cost is intentional. For institutional money movement, inability to prove why an execution was allowed is a product defect.
