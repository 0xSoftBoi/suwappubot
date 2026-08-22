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

Lifecycle events are published through a transactional outbox committed with the source state change.

Operational execution truth is deliberately separate from economic accounting. `ExecutionEvent` says what happened operationally; #908 will translate authoritative economic events into balanced ledger postings. #898 will retain market/benchmark snapshots and compute execution-quality measurements from the same canonical execution history.

This ADR does **not** require rewriting all existing execution paths at once. Existing spot, limit, perps, bridge, solver, and scheduled adapters migrate incrementally behind the canonical lifecycle, with equivalence/reconciliation tests before their existing status models are retired.

## Consequences

- Retries and restarts have an explicit identity and replay model instead of client-memory semantics.
- Partial fills and recovery states become representable without prematurely marking an entire parent order failed.
- Terminal/mobile clients become projections over server execution truth rather than independent state machines.
- Every provider integration must define status lookup, idempotency/correlation, partial-fill, cancellation/amendment, timeout ambiguity, and finality semantics.
- More rows/events are persisted, and adapters require deliberate translation work.
- Event schema compatibility and replay tests become part of the money-path contract.
- The operational event store must not be used as a substitute for the double-entry economic ledger.
