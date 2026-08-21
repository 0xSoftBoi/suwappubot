# Suwappu Execution Searcher

Research implementation for the quantitative execution objective in `docs/research/SUWAPPU_EXECUTION_OBJECTIVE_SPEC.md`.

This crate is deliberately measurement-first. It is not a deployed trading service and does not submit transactions.

## Sprint 1 measurement contract

The first layer is:

`normalized events -> deterministic replay -> markouts -> fill economics`

Rules:

- monetary and price values use signed fixed point with `FIXED_SCALE = 1e9`;
- replay ordering is deterministic and independent of ingestion order;
- event IDs are idempotency keys: exact duplicates are removed and conflicting duplicates fail closed;
- sequence gaps and regressions are surfaced rather than silently repaired;
- markout sign is maker-centric: positive means favorable to Suwappu;
- spread capture is measured against fair value at the fill;
- post-fill fair-value movement is measured separately from spread capture;
- the current `lvr_proxy` is an empirical adverse-selection label, not a claim to be the exact continuous-time theoretical LVR quantity;
- stale/missing fair-value samples do not get silently forward-filled beyond the configured sampling policy.

When execution is added later, it is a MONEY-PATH subsystem under the repository architecture rules and requires the adversarial review gate before merge or deployment.
