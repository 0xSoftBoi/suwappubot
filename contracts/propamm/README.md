# contracts/propamm — proprietary AMM skeleton

**Status: skeleton. Compiles (solc 0.8.27 / cancun). Untested, unaudited, undeployed. MONEY-PATH.**
Do not fund with real inventory before: tests + fork parity vs the FermiSwap model, `money-path-reviewer`, `security-auditor`, external audit.

Background: `docs/plans/propamm-build-guide.md`, `docs/research/fermi-FINDINGS.md`, `docs/research/metric-FINDINGS.md`.

## Files
- `PropOracle.sol` — maker-written price feeds. Whitelisted hot pusher writes `(price 1e18, block)`; every push is step-bounded vs the price at the start of the block (FermiSwap has no bound); owner-only `seed` for init/recovery.
- `PropAMMPool.sol` — single-pair, self-custodied pool.

## Pricing (from the verified FermiSwap model)
```
p        = oracle price (must be pushed within maxAgeBlocks; 0 = this block)
skew     = skewCurve( (baseValue - targetBps*total) / total )   clamp ±maxSkew
edge     = max(minEdge, baseEdge + sizeCurve((sameBlockFlow + qty)/lo))
p2       = p*(1+skew) * (1 ∓ edge)      (taker sells base: -edge, buys base: +edge)
```
Units: 1e18 == 1 bp. Curves are cubic segments `[x0,x1,c2,c3,c4,c5]`, `y = c5 + c4 t + c3 t² + c2 t³`, `t=(v-x0)/(x1-x0)`.

## Deliberate differences vs FermiSwap
| FermiSwap | Here |
|---|---|
| no freshness/sanity bound in engine; oracle ts ignored | pool enforces freshness; oracle step-bounded; mandatory fresh 2nd-source anchor |
| payout silently clamped to vault balance | reverts `InsufficientLiquidity` |
| size over `hi` is silently scaled | reverts `TooLarge` |
| `executeGeneral` arbitrary-call manager, no timelock | no arbitrary call; owner = multisig (TODO on-chain timelock); guardian pause-only |
| strategist/owner can set any curve | `minEdge` floor + `maxSkew` cap enforced at pricing time |
| no stop-loss | decaying-peak value stop-loss (Metric `OracleValueStopLoss` style) |
| separate vault | pool holds inventory; `withdraw` owner-only |

## Integration
- Swap entrypoint: `swap(tokenIn, int256 amountSpecified, amountCheck, recipient, cbData)`; `>0` exact-in, `<0` exact-out; empty `cbData` = allowance pay, else `propAMMSwapCallback`.
- Titan ACE needs `IPropAMM.sol` conformance (repo `propamm-router-contracts`) — **not yet implemented**; get the interface from Titan during onboarding.
- Quote publisher (off-chain): sign `PropOracle.push` tx each ~50 ms → Titan `/ws/sendquoteupdate` (protobuf, fixed UUID + monotonic seq). Key in KMS/HSM.

## Review status
First adversarial money-path review (read-only, no tests run) returned **BLOCK** on the first draft. Fixed in this commit:
1. Oracle step bound compounded within a block → now bounded vs the price at the START of the block.
2. Oracle bound was waived after downtime → never waived; owner `seed()` is the only unbounded write; pushes to an unseeded feed revert.
3. Skew round-trip extraction → `setRisk` enforces `0 < minEdge`, `maxSkew <= minEdge`.
4. Anchor freshness unchecked → `maxAnchorAge` added; anchor now mandatory (`setRisk` reverts without one).
5. Rounding favoured takers / 1e8 price scale too coarse → price scale 1e18, pool-favouring rounding on `p1`/`p2`.
6. Decimals passed by hand → read from tokens.
7. Stop-loss baseline set post-trade → pre-trade value folded into peak first.
9. `setRisk` validation tightened (hi != 0, decay cap, maxAgeBlocks ≤ 10, anchor params), SafeCast on narrowing casts.
Second review ("ship with fixes") then fixed: H1 stop-loss marks at min(oracle, anchor) and decay capped at ~1%/day (was rearming in ~17 min, so a compromised pusher's loss had no real ceiling); M2 `maxAnchorDevBps <= 300`, `maxAgeBlocks <= 2`; L4 `quoteSwap` reverts mid-callback; L5 event field renamed `oraclePrice1e18`. Oracle is *rate-limited*, not un-walkable: pool-side bound = anchor band + stop-loss.
Worst case (est., step 50bps, minEdge 1bp, drawdown 1%, dev band 50bps): compromised pusher ≈ drawdown + 2×dev ≈ 2–3% of inventory then ~1%/day until paused (guardian bot should pause on `StopLoss` reverts); compromised strategist cannot misprice beyond mid·(1±maxSkew²) but can cut edge to `minEdge` and DoS via bad curves.
Known/open: L6 exact-in vs exact-out size accounting differ slightly (edge-on-edge); L7 `block.number` on Arbitrum is the L1 block (freshness/acc window stretch ~12s — decide per chain); L8 anyone can donate to raise the stop-loss peak (griefing; donor loses funds, owner can reset via withdraw).
Accepted/documented: (8) stop-loss marks at oracle price so a plain market move also trips it (circuit breaker); curve coverage over [-1e18,1e18] is not validated on-chain (uncovered input reverts, losing nothing); router trusted for recipient/payer/amountCheck.
**Not yet re-reviewed after these fixes, and no tests exist.**

## Parity vs FermiSwap model (scratch harness, not committed)
Differential run against `docs/research/fermi-engine/decomp2/final_model.py` with the live WETH/USDT curves: **4,431 successful swaps (two scenarios, 1–3 same-block swaps each, exact-in/out, both directions) bit-exact vs a Python port of the pool's own integer math, 0 mismatches**; reverts match. Exact-in max relative error vs the Fermi model 3.5e-10 (live curves, minEdge floor binding) / 8.7e-9 (scaled curves) — from 1e18-vs-1e8 price precision. Exact-out vs the model's algebraic inverse ≤ 8.5e-7 (≈1 raw unit on a ~$1 input; exact-out agreement INFERRED, the model has no exact-out). Same-block cumulative flow matches. Intended differences confirmed: revert instead of clamp (`InsufficientLiquidity`), revert above `hi` (`TooLarge`). Fermi's per-token inventory cap path was not exercised. Harness lives untracked in `docs/research/propamm-parity/` of the worktree (it contains a `.t.sol`; CLAUDE.md forbids committing tests unprompted).

## TODO before real money
1. Foundry tests + fork parity harness vs `docs/research/fermi-engine/decomp2/final_model.py` (same inputs → same outputs, modulo the revert-vs-clamp differences).
2. On-chain timelock for loosening `setRisk` changes; EIP-191 hot-key delegation; packed multi-feed hot path (~8k gas/feed).
3. `IPropAMM` conformance + router; events for indexers.
4. Address findings from the money-path review (see PR/commit notes).
5. Decide per-chain: oracle ordering guarantee only exists where a builder/sequencer provides it.
