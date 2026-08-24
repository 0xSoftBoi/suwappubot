# ADR 0007: Shadow route intelligence before execution selection

**Status:** Proposed  
**Classification:** Capability / MONEY-PATH adjacent  
**Supersedes:** None  
**Related:** ADR 0006 canonical execution lifecycle

## Context

Suwappu already captures sampled counterfactual LI.FI routes and compares a second provider on some same-chain swaps, but execution still follows the provider-selected route. That gives us useful data without yet turning Suwappu into the decision layer described by ADR 0006's `ExecutionIntent -> CandidatePlan[]` model.

A route is not adequately described by output amount alone. Cross-chain execution can differ in settlement model, duration, capital exposure, recovery semantics, canonical-asset status, solver assumptions, and jurisdictional eligibility. Selecting solely on price can therefore be wrong for treasury or institutional flows even when it is reasonable for small retail swaps.

Changing live route selection is a MONEY-PATH change. We should not promote a new ranking function directly into execution without first measuring its counterfactual decisions against real captured routes.

## Decision

Introduce a pure, deterministic route-decision layer and run it in **shadow mode** against the existing counterfactual route-capture pipeline before it is permitted to affect execution.

The first scoring model has five dimensions:

1. **Economics** — fee- and gas-adjusted output relative to the best observed route.
2. **Latency** — expected execution duration when supplied by the provider.
3. **Settlement quality** — an explicit settlement model, preferring canonical/same-chain or issuer-native settlement over unknown or wrapped paths.
4. **Recoverability** — a conservative score derived from the settlement model until provider-specific recovery metadata exists.
5. **Compliance** — a policy-supplied 0-100 score. Unknown jurisdictional eligibility is neutral in shadow mode and is surfaced as a missing signal rather than guessed.

The layer supports three policy profiles:

- `retail`: economics and latency carry more weight.
- `treasury`: settlement quality and recoverability carry more weight.
- `institutional`: settlement quality plus compliance carry more weight.

Route classification is conservative. Same-chain routes and explicitly recognized issuer-native, solver/intent, and liquidity-bridge tools may receive a settlement type; unrecognized providers remain `unknown`. Adapters may later provide stronger structured metadata rather than relying on tool-name inference.

Shadow decisions are observational only. They may be logged and analyzed alongside captured route candidates, but they must not change quote responses, transaction calldata, signing, balances, fees, or execution provider selection in this phase.

## Promotion gate

A separate MONEY-PATH PR is required before ranked routes can become executable. Promotion requires:

- enough captured samples to compare provider-selected routes with profile-selected routes;
- explicit measurement of price delta, latency delta, route failures, and recovery/finality outcomes where available;
- no hidden dependency on provider-specific response shapes;
- adversarial MONEY-PATH review;
- deterministic tests for tie-breaking and missing data;
- a rollback/kill-switch path for live selection;
- provider adapters that expose execution, status lookup, idempotency/correlation, timeout ambiguity, and finality semantics consistent with ADR 0006.

## Compliance boundary

This ADR does **not** encode jurisdiction law, token allowlists, user-location rules, sanctions policy, or licensing conclusions. A later jurisdiction-policy adapter will supply structured eligibility/compliance signals to the scorer. Keeping that policy external prevents route math from becoming a hard-coded legal rules engine and lets the same execution core serve different regulated surfaces.

## Consequences

- Suwappu can measure whether its own routing policy would improve decisions before risking funds.
- Retail and institutional objectives can diverge explicitly instead of being hidden inside one provider's `RECOMMENDED` ordering.
- Unknown data is visible as missing rather than converted into false confidence.
- Canonical stablecoin routes such as CCTP can be identified as a distinct settlement class without requiring immediate execution changes.
- The first version is intentionally incomplete: provider-specific reliability, historical failure rates, chain finality, liquidity-at-risk, and jurisdiction policy must be added as measured inputs rather than invented constants.
