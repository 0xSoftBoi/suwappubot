# ADR 0007: Institutional route control and shadow promotion

**Status:** Proposed / shadow-only  
**Scope:** Cross-chain execution decisioning and promotion into money paths

## Decision

Route selection is split into three separate responsibilities:

1. **Eligibility / feasibility** — fail-closed controls decide whether a route may be considered.
2. **Optimization** — only surviving candidates are ranked for economics, latency, settlement and recovery quality.
3. **Execution lifecycle** — a selected candidate is persisted, preflighted, submitted, reconciled and settled through the canonical execution schema.

A numeric score can never override a hard eligibility, authorization, notional, capacity, quote-freshness, venue-health, recovery or settlement restriction.

## Decision integrity

Each route decision is normalized into canonical JSON and receives a SHA-256 **integrity fingerprint** covering the candidate set, resolved settlement classifications, policy/optimizer/build identity, winner, alternatives and rejection reasons.

The fingerprint alone is **not tamper evidence** against a privileged database writer: historical data could be modified and re-hashed. `executionAuditCheckpoint.ts` therefore supports chained decision heads and signatures from an injected KMS/HSM-style signer. A signed chain head only becomes meaningful tamper evidence after it is anchored in storage with independent access/retention controls.

## Submission semantics

The execution boundary uses a write-ahead child placement:

`preflight_validated -> prepared child + submitting parent -> external call -> submitted/recovery_pending`

A durable `(parent_order_id, child_sequence)` uniqueness constraint arbitrates concurrent workers. Replaying the same economic instruction returns the existing child and **never grants permission to blindly submit again**.

External timeouts, connection resets and ambiguous 5xx responses are not terminal failure. If the request may have crossed the provider boundary, the lifecycle records:

`child: unknown`  
`parent: recovery_pending`

Recovery is a read/query capability, separate from submission. Provider adapters may attach a recovered external order ID, transaction hash or intent ID to the same durable child. `not_found` never automatically creates a second economic instruction, even when a provider claims the absence is authoritative; resubmission policy must be explicit and independently reviewed.

For EVM rails where the signer exposes fully signed serialized bytes before broadcast, the transaction hash should be derived and persisted before `eth_sendRawTransaction`, so chain reconciliation has a deterministic identity even when the broadcast response is lost.

## Settlement semantics

Source-chain inclusion, provider acknowledgement or solver acceptance is not completion for cross-chain value movement. A parent may close successfully only from an authoritative durable `destination_confirmed` settlement observation.

## Event delivery

Lifecycle state and its outbox record are written in the same database transaction. The publisher is explicitly **at-least-once**: a crash after publication but before `published_at` commits can duplicate delivery. `event_id` is therefore the consumer idempotency key; downstream consumers must persist/dedupe it before applying side effects. No exactly-once claim is made.

## Performance evidence

`bench:routing` measures only the deterministic CPU feasibility/ranking path and reports p50/p95/p99/max/mean under configurable candidate fan-out. Those numbers are useful regression evidence, not production SLOs. Production promotion additionally requires end-to-end order acknowledgement, provider/RPC latency, queueing, recovery duration, settlement latency and reconciliation backlog distributions.

## Promotion gate

Shadow control may influence live money movement only after all of the following are true:

- exact-head CI and security checks are green;
- provider adapters expose authoritative recovery/query operations;
- live submission is fenced by the durable execution lifecycle;
- principal/organization exposure controls execute at the actual dispatch choke point;
- kill switches and notional limits cannot be bypassed by choosing another venue/route;
- event consumers are idempotent under duplicate outbox delivery;
- signed audit checkpoints are externally anchored if tamper-evidence is claimed;
- restart, timeout-after-send, duplicate callback, stale worker and degraded-provider fault tests pass;
- shadow/soak evidence shows acceptable TCA, recovery and tail-latency behavior;
- activation begins with bounded notionals and independently reversible limits.

Until then this system remains shadow/infrastructure work, not an institutional production money path.
