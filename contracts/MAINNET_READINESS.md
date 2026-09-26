# Mainnet Readiness — Core Primitives

Scope: `primitives/SuwappuTimeCurve.sol`, `primitives/SuwappuAmortizingVault.sol`,
`primitives/SuwappuMutualCredit.sol`. These are **immutable** (no owner, no pause,
no upgrade), so every bug is permanent and the readiness bar is higher than for an
upgradeable system.

**Status: engineering-hardened, NOT yet cleared for real user funds.** The
engineering work below is done; the human gates in §2 are not, and they are
non-negotiable before deposits.

---

## 1. Done (engineering)

- **Zero dependencies.** Each contract is one self-contained file — inlined ERC-20
  (curve token), reentrancy guard, safe-transfer, 512-bit `mulDiv`, `wadExp`. Each
  compiles standalone with `solc` alone. No transitive supply-chain surface.
- **Two adversarial money-path review passes** (internal). Round 1 found and fixed
  4 critical + 4 high fund-loss bugs (netCycle debt fabrication, first-depositor
  share inflation, structurally-insolvent growth curve, unliquidatable-on-illiquid,
  bad-debt phantom assets, free mint at vanishing multiplier, int-cast limit
  bypass, proposal-squatting DoS). Round 2 verified the gas refactor introduced no
  regressions. **These were LLM reviews, not a professional audit — see §2.**
- **Test coverage:** 37 unit tests (`test/PrimitivesTest.t.sol`) + a stateful
  invariant/fuzzing suite (`test/PrimitivesInvariant.t.sol`) asserting the core
  solvency & accounting invariants over randomized call sequences + a Base-mainnet
  **fork suite** (`test/PrimitivesFork.t.sol`) exercising real 6-decimal USDC and a
  real Morpho ERC-4626 (skips gracefully without an RPC).
- **Non-standard-token hardening.** Custody inflows assert exact receipt
  (balance-delta) and reject fee-on-transfer / rebasing tokens (`NonStandardToken`)
  rather than silently under-collateralize.
- **Reentrancy:** EIP-1153 transient-storage guard on every state-changing entry.
- **MEV:** `deadline` on price/health-sensitive entrypoints (curve buy/sell; vault
  open/withdraw/liquidate) + caller slippage bounds + sink exit-tax. Oracle-free, so
  no feed to manipulate. See README "MEV posture".
- **Gas tuned** (transient guard, struct slimming, cached SLOADs).
- **Deploy scripts** with parameter sanity-checks (`deploy/DeployPrimitives.s.sol`).

## 2. Required before real funds — needs humans, cannot be self-served

1. **Independent professional audit** (e.g. Trail of Bits, Spearbit, Zellic,
   OpenZeppelin). At least one; two for anything holding size. Priority scope:
   TimeCurve solvency under rounding × sink × exp-floor, and the AmortizingVault's
   ERC-4626 coupling (§3).
2. **Public testnet soak** on Base Sepolia — deploy, run real buys/sells,
   open/repay/liquidate, and cycle-netting for weeks with real usage before mainnet.
3. **Bug bounty** (Immunefi or similar) live before/at launch, sized to TVL.
4. **Formal solvency argument** for the curve, ideally machine-checked (the current
   claim is argued + fuzzed, not proven).
5. **Deployment-parameter review.** Immutable params are forever — a wrong
   `basePrice`/`slope`/`rate`/`liqLtv` cannot be fixed. Have the exact constructor
   args reviewed and simulated on a fork before broadcast.
6. **Monitoring & runbook** — since there is no pause, the only response to an
   incident is social (warn users, deprecate the front-end). Have alerting on
   reserve/solvency ratios and a documented "it's broken, here's what we tell
   people" plan *before* launch.

## 3. Per-contract residual risk

### SuwappuTimeCurve
- Solvency for `rate <= 0` is argued + fuzzed, not formally proven; the interaction
  of ceil-on-buy / floor-on-sell, the value-sink, `reserveScale`, and the `wadExp`
  floor is the highest-value audit target.
- Deep-decay end state: as `m(t)` approaches its floor, small buys round to a
  0-cost quote and revert (`ZeroAmount`) — the curve becomes inert rather than
  exploitable, but existing reserve is only recoverable while `m(t) > 0`. Confirm
  the chosen `rate` keeps the curve economically live over its intended horizon.
- Time-based growth (`rate > 0`) is rejected at deploy — an upward path must be
  expressed via `slope`.

### SuwappuAmortizingVault — highest residual risk
- **The ERC-4626 collateral vault IS the price oracle.** "Oracle-free" means no
  Chainlink feed, not risk-free: LTV, liquidation, and seize-sizing all read the
  4626's `convertToAssets`/`convertToShares`. The vault inherits that 4626's entire
  risk surface — share-price manipulation, its own inflation/donation bugs, its
  `maxWithdraw` caps, a malicious or upgradeable implementation. **Vet the
  collateral vault as hard as this contract**: prefer a large-TVL, immutable or
  well-governed, audited 4626; verify its share price cannot be flash-manipulated.
- Interest is **simple/linear** (poke-independent by design), not compounding — a
  deliberate trade-off; lenders may earn below a compounding market rate.
- Lending model is intentionally minimal: no utilization-based rate curve, single
  asset, first-come withdrawal against `totalCash`. Bad debt is socialized via
  writeoff, but pro-rata fairness in a run is not guaranteed — model the economics
  for your parameters.
- Liquidations rely on rational third-party liquidators choosing `repayAssets`;
  there is no keeper incentive beyond `liqBonus`. Ensure the bonus clears gas costs
  on Base.
- **Known bounded rounding (surfaced by the invariant suite):** the lender-share
  virtual offset (`VIRTUAL = 1e6`) means that *after the pool takes losses*
  (`totalLendShares > poolAssets`), the sum of per-lender withdrawable values can
  exceed `poolAssets` by a provably-bounded `< VIRTUAL` wei (≈1 unit for a
  6-decimal asset in a near-total-loss state). This is in the over-claim direction
  only and is neutralized because every `withdraw` is gated by `assets_ <=
  totalCash` and `totalCash` equals the real balance — no lender can pull more than
  the vault holds. It can leave the last withdrawer short by that dust in a wipeout.
  Auditors should confirm the bound and the gate; consider a larger offset or a
  dead-shares mint if the dust matters for your asset's decimals.

### SuwappuMutualCredit
- **Viability, not just safety:** `netCycle` pays the caller nothing and cycle
  discovery is off-chain, so multilateral netting may simply never be called in
  practice. A layer that incentivizes/relays netting is likely needed for the
  primitive to deliver its benefit.
- Uncollateralized credit rests on off-chain enforcement; the on-chain `defaults`
  counter is a reputation signal, not recovery. Only deploy with counterparties who
  understand this.
- Interest folds into the balance per `_accrue`, so frequent pokes compound it; the
  `MAX_FEE_RATE` ceiling bounds the drift and debtors can settle any time, but pick
  a low `feeRate`.
- Peer-to-peer `settle` assumes a standard token (chosen by both parties at
  `proposeLine`) — a fee-on-transfer unit of account would under-deliver.

## 4. Verification commands
```bash
forge test --match-path "test/PrimitivesTest.t.sol"       # unit
forge test --match-path "test/PrimitivesInvariant.t.sol"  # invariant/fuzz
BASE_MAINNET_RPC_URL=<rpc> forge test --match-path "test/PrimitivesFork.t.sol" -vvv  # fork
```
