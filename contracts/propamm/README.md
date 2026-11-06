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
Accepted/documented: (8) stop-loss marks at oracle price so a plain market move also trips it (circuit breaker); curve coverage over [-1e18,1e18] is not validated on-chain (uncovered input reverts, losing nothing); router trusted for recipient/payer/amountCheck.
**Not yet re-reviewed after these fixes, and no tests exist.**

## TODO before real money
1. Foundry tests + fork parity harness vs `docs/research/fermi-engine/decomp2/final_model.py` (same inputs → same outputs, modulo the revert-vs-clamp differences).
2. On-chain timelock for loosening `setRisk` changes; EIP-191 hot-key delegation; packed multi-feed hot path (~8k gas/feed).
3. `IPropAMM` conformance + router; events for indexers.
4. Address findings from the money-path review (see PR/commit notes).
5. Decide per-chain: oracle ordering guarantee only exists where a builder/sequencer provides it.
