# LayerZero ATLAS — Parity Map & Execution Log

_2026-08-26. Response to LayerZero's ATLAS announcement
([x.com/LayerZero_Core, Aug 25 2026](https://x.com/layerzero_core/status/2092250756195954899)).
Execution-tracking doc: every row either shipped, is in flight on a named
branch, or is scoped with an owner surface. Vendor performance figures are
marketing claims until benchmarked._

## What they announced

**ATLAS** ("Aggregated Trading Liquidity and Settlement"): a *headless
exchange* on Zero (their multi-core L1) that collapses **matching, clearing,
settlement, and risk** into one integrated stack. Claims: sub-millisecond
latency, 200k TPS at launch, no consumer frontend — venues, market creators,
and market makers plug in; ZRO secures the network and captures trading
economics.

Read: they are moving from messaging infrastructure into the exchange-stack
lane. That lane overlaps our stack directly — but we hold pieces they don't.

## Parity map

| ATLAS claim | Suwappu counter | Status |
|---|---|---|
| Headless matching engine | `suwappu-clob` on the DAG L1: deterministic price-time-priority CLOB, GTC/IOC/FOK/post-only, self-trade prevention | **Shipped** — `suwappu-dag` branch `claude/parity-dominance-execution-c4hz5l` |
| Clearing integrated with matching | Multilateral netting of fills → per-account (base, quote) deltas, conservation-checked, overflow-safe | **Shipped** — same crate (`settlement.rs`) |
| Settlement in the same stack | Constant-size SHA3-256 batch root applied by the execution substrate (suwappu-db balance map) and attested cross-chain via LTP | Root: **shipped**. Anchor-pipeline wiring: **planned** — `suwappu-lattice-protocol/plans/clob-settlement-attestation.md` |
| Risk in the stack | Engine-boundary risk today (STP, FOK atomicity, post-only, checked notional). Margin/position risk: not built | **Partial** — margin engine is the honest gap |
| Sub-ms latency / 200k TPS | Fast-path lane is 100–200 ms p95 *finality* (different metric than their unbenchmarked latency claim). No matching-engine benchmark yet | **Unverified both sides** — add a criterion bench before quoting numbers |
| No consumer frontend (venues plug in) | Same architecture — CLOB is a chain-native lane; bot/webapp/mobile are just first clients, agents reach it via A2A + x402 | **Structural parity** |
| ZRO secures + captures economics | Dual-ring validator set with slashing; fee capture design lives in the tokenomics docs | Existing |

## Where we dominate (not just match)

1. **Post-quantum settlement.** ATLAS settles with classical crypto. Every
   long-lived Suwappu surface is ML-DSA-65 / ML-KEM-768 (FIPS 204/203). For
   venues with a compliance horizon, that is a category difference, not a
   feature difference.
2. **Cross-chain settlement is native, not adjacent.** Their exchange lives
   on one L1 and reaches other chains over messaging. Our batch root rides
   the LTP corridor at constant ≈1,600 B commitment regardless of fill
   count — netting scales off-commitment by construction.
3. **Distribution exists today.** The bot already executes across 7+ chains
   for real users and agents (x402-metered, A2A-discoverable). ATLAS at
   launch has infrastructure and no order flow; we have order flow and now
   the matching infrastructure.
4. **Determinism as consensus property.** The engine holds no clock and no
   randomness — replaying a certified order stream reproduces fills and the
   settlement root byte-for-byte, so matching can live *inside* consensus
   rather than beside it.

## Execution log

- **2026-08-26** — `suwappu-clob` crate shipped on `suwappu-dag`
  (book + engine + netting + batch root, 12 inline invariant tests, clippy
  clean; CI matrix validates on the branch).
- **2026-08-26** — LTP attestation plan filed
  (`plans/clob-settlement-attestation.md`): batch root → existing 32 B
  payload-root slot, `SUWAPPU-CLOB-SETTLEMENT-V1` DST pinned per LTP-A-022.
- **2026-08-26** — `/v1/clob/*` dev lane shipped in api-ts (in-memory
  engine mirroring suwappu-clob semantics + byte-identical batch roots)
  and **functionally verified live on the Railway dev deployment**
  (`api-ts-dev.up.railway.app`): two agents registered, book seeded,
  price-time-priority cross filled 5@102 then 3@103 at maker prices,
  FOK killed atomically, post-only rejected on cross, cancel enforced
  ownership (403 for non-owner), and the settlement window netted to
  conserving deltas (+8/−819 vs −8/+819) under batch root `4900b163…`.
  Live debugging also surfaced and fixed three real dev-DB drift bugs:
  `agents.organization_id` and `agents.last_active_at` missing from the
  Python runtime migration, and `agents.is_active`/`uuid` lacking the
  server defaults the Drizzle insert assumes (fresh registrations 401ed
  as inactive). All three fixes are additive migrations now on `dev`.

## Next wiring (in priority order)

1. **Anchor pipeline**: DAG checkpoint path submits batch roots as LTP
   payload roots (suwappu-dag, then conformance vector in the LTP repo).
2. **api-ts order routes**: `/v1/clob/*` — submit/cancel/book snapshot for
   agents and webapp, typed in `@suwappu/sdk`.
3. **Bot `/o` integration**: limit orders route to the CLOB lane when the
   pair has a listed market; AMM/aggregator path stays the fallback.
4. **Benchmark**: criterion bench on `MatchingEngine::submit` so our
   latency/throughput numbers are measured, not marketed.
5. **Margin/risk engine**: scope as its own sprint — the one parity row we
   should not hand-wave.
