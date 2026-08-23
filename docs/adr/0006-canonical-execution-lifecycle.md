# ADR 0006: Canonical execution lifecycle for money-moving orders

**Status:** Proposed  
**Classification:** Core  
**Issues:** #892, #911

## Context

Suwappu currently has multiple execution surfaces (spot swaps, limits, perps, bridge flows, and upcoming scheduled/solver execution) that expose provider-specific status and retry semantics. A transaction hash, HTTP success, wallet signature, venue acknowledgement, fill, and final settlement are materially different facts, but ad-hoc flows can collapse them into one UI status.

That fragmentation makes partial fills, ambiguous transport failures, app/process restarts, cancel/fill races, and cross-chain recovery difficult to reason about safely. It also prevents the future ledger (#908) and transaction-cost analysis (#898) from consuming one authoritative execution history.

## Decision

All money-moving execution will converge incrementally on the following operational model:

`ExecutionIntent -> CandidatePlan[] -> ParentOrder -> ChildPlacement[] -> Fill[] -> Settlement[]`

Postgres is the authoritative persistence layer. Each material parent-order transition emits an immutable `ExecutionEvent` with a monotonically increasing per-parent sequence. A deterministic reducer reconstructs the materialized parent state from those events.

The canonical parent lifecycle includes:

`draft -> quoting -> ready -> authorizing -> scheduled/active -> paused/partial/reconciling -> filled | cancelled | failed | expired`

`reconciling` is first-class. If Suwappu cannot determine whether an external money-moving request was accepted, it must resolve the existing external identity before issuing a new one. Transport success, a signature, a tx hash, or provider acknowledgement never implies a fill.

Commands that can reach an external execution system use durable idempotency keys and request fingerprints. Provider adapters preserve external correlation identifiers and map provider events into the canonical model. Consumers of lifecycle events are at-least-once and must be idempotent; financial correctness must not depend on exactly-once transport.

During incremental migration, each canonical `ParentOrder` may carry a stable `(source_type, source_ref)` identity such as `("swap", "123")`. That pair is unique. This gives retries, backfills, reconciliation workers, and support tooling one deterministic bridge between the canonical execution and the legacy source row without adding a different foreign-key column for every old execution subsystem.

A canonical fill must support both order-book and swap economics. `quantity`/`price` provide the normalized trajectory/TCA view used by scheduled execution; exact `input_asset/input_amount` and `output_asset/output_amount` preserve the economics of AMM, bridge, RFQ, and solver fills where a single base/quote pair is not enough to describe what settled. Amounts are stored exactly, not as binary floating point.

Lifecycle events are published through a transactional outbox committed with the source state change.

Operational execution truth is deliberately separate from economic accounting. `ExecutionEvent` says what happened operationally; #908 will translate authoritative economic events into balanced ledger postings. #898 will retain market/benchmark snapshots and compute execution-quality measurements from the same canonical execution history.

This ADR does **not** require rewriting all existing execution paths at once. Existing spot, limit, perps, bridge, solver, and scheduled adapters migrate incrementally behind the canonical lifecycle, with equivalence/reconciliation tests before their existing status models are retired.

## Consequences

- Retries and restarts have an explicit identity and replay model instead of client-memory semantics.
- Partial fills and recovery states become representable without prematurely marking an entire parent order failed.
- Legacy and canonical rows have a deterministic migration/reconciliation identity.
- Fill storage can represent exact AMM/cross-chain input-output amounts without losing the normalized quantity/price representation needed by execution algorithms.
- Terminal/mobile clients become projections over server execution truth rather than independent state machines.
- Every provider integration must define status lookup, idempotency/correlation, partial-fill, cancellation/amendment, timeout ambiguity, and finality semantics.
- More rows/events are persisted, and adapters require deliberate translation work.
- Event schema compatibility and replay tests become part of the money-path contract.
- The operational event store must not be used as a substitute for the double-entry economic ledger.
