# Suwappu Execution Searcher Research

This crate is the measurement-first substrate for Suwappu's pAMM, searcher, builder, and capital-allocation research. It is intentionally isolated from deployed services until benchmark and adversarial gates are satisfied.

## Current pipeline

1. normalize exchange, chain, pAMM, execution, capital, and builder events;
2. deterministically replay them with duplicate and source-sequence checks;
3. compute bounded fair-value markouts at 10ms, 100ms, 500ms, 1s, 1 block, and 5 blocks;
4. decompose spread capture from post-fill fair-value movement and empirical LVR/toxicity;
5. price gas, calldata, external calls, transfers, funding, builder payment, and risk into route economics;
6. invalidate only route candidates touched by changed versioned venue edges;
7. size routes against an exact bounded-grid oracle, with faster unimodal refinement required to match the oracle on fixtures.

## Builder telemetry

`builder.rs` normalizes MEV-Boost relay Data API bid traces and Titan top-bid messages into the shared `BuilderTrace` event. Relay slots are **not** treated as per-message sequence numbers because many valid builder submissions can occur inside one slot.

The intended live inputs are:

- MEV-Boost-compatible `builder_blocks_received` data for verified builder submissions;
- `proposer_payload_delivered` data for realized inclusion labels;
- Titan's authenticated `builder/top_bid` WebSocket when credentials/eligibility are available.

Representative wire fixtures live in `fixtures/titan_relay_bid.json` and `fixtures/titan_top_bid.json`. Transport and credential handling stay outside the economics core. The strategy/model consumes normalized events only.

## Executor baseline

The sibling `execution/executor-bench/` Foundry project is a research-only semantic and gas baseline. It measures a generic calldata-driven executor with an explicit final-token-balance postcondition. The venue mocks used in gas scenarios avoid storage writes so the report is useful for estimating executor overhead rather than primarily measuring SSTORE cost.

No assembly executor is accepted by default. A specialized implementation must preserve the same fail-closed semantics and demonstrate a material measured reduction in total route cost before its additional audit surface is justified.

## Release posture

Nothing in this directory is a deployed trading service. Transaction execution is MONEY-PATH code and requires adversarial review, fork tests, economic postconditions, and observed CI/benchmark results before promotion.
