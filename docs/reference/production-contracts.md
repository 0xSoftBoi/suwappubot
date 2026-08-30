# Production Contracts Reference

> **Canonical addresses, fee configuration, and revenue-sharing parameters for Suwappu.**
> Fee parameters verified against repository code and addresses **verified on-chain via
> Blockscout on August 30, 2026 at block 46,164,700** (Base Sepolia). Machine-readable
> snapshot: [`contracts.json`](contracts.json). Drift-checked in CI by
> `scripts/check_contracts_ref.py` (part of `scripts/verify.sh docs`).

> ⚠️ **Verify before you sign.** Always confirm the **chain ID** and the exact contract
> address against this page (or the JSON snapshot) before signing any transaction.
> Suwappu protocol contracts are currently deployed on **Base Sepolia testnet only
> (chain ID 84532)**. **There are no Suwappu mainnet contract deployments yet** — any
> address presented to you as a "Suwappu mainnet contract" is not ours.

## Contents

- [Base Sepolia (chain ID 84532)](#base-sepolia-testnet--chain-id-84532)
- [External protocol dependencies](#external-protocol-dependencies)
- [Base Mainnet status](#base-mainnet--not-yet-deployed)
- [Swap fees](#swap-fees)
- [Fee sharing (referral revenue)](#fee-sharing-referral-revenue)
- [Chain-specific fee integrations](#chain-specific-fee-integrations)
- [Fee collection & sweeping](#fee-collection--sweeping)
- [Performance & scalability](#performance--scalability)
- [Governance & ownership](#governance--ownership)

---

## Base Sepolia (testnet) — chain ID 84532

Current hardened deployment (post-audit redeploy after fixing 4 critical + 7 high
findings; supersedes all earlier testnet addresses).

All four addresses confirmed live on-chain (deployed June 7, 2026 by the Suwappu
deployer; re-checked August 30, 2026 at block 46,164,700):

| Contract | Address | Explorer source |
|----------|---------|-----------------|
| SUWP token (ERC-20 "Suwappu", 18 decimals, 1,000,000 supply) | [`0x0b96a41a2a4c9b50097049d24f43848be3A892e8`](https://sepolia.basescan.org/address/0x0b96a41a2a4c9b50097049d24f43848be3A892e8) | unverified |
| SuwppuStaking | [`0xFA1142C788b6BC09CD16490dFEdAcEAFC505bA17`](https://sepolia.basescan.org/address/0xFA1142C788b6BC09CD16490dFEdAcEAFC505bA17) | unverified |
| SuwppuBonds | [`0x9aCCf607AF27327B4940827a5c389F109847562D`](https://sepolia.basescan.org/address/0x9aCCf607AF27327B4940827a5c389F109847562D) | unverified |
| Superfluid GDA pool (reward streaming) | [`0x924c4FA120d647B432D1E9F6e9632c2f4CEDfCFf`](https://sepolia.basescan.org/address/0x924c4FA120d647B432D1E9F6e9632c2f4CEDfCFf) | verified (BeaconProxy → `SuperfluidPool`) |

> **Known gap:** explorer **source verification is not yet published** for the three
> Suwappu-authored contracts (the on-chain bytecode is live and behavior-verified, but
> the explorer cannot yet display matching source). Publishing verified source is a
> pre-mainnet task; until then, match the source in [`contracts/`](../../contracts/)
> against the creation transactions below.

**Deployment provenance** (creation transactions, all sent by the deployer
`0xfbe006d9364Cc59EcAaC0721552014f76354AadB`):

- SUWP: [`0x756dd3eb…dadb5b`](https://sepolia.basescan.org/tx/0x756dd3eb5a5e38cdfb50e93c730488f3755ae122722edbd6aa093e1a49dadb5b)
- SuwppuStaking (and its GDA pool, same tx): [`0x412f0c72…cd8403`](https://sepolia.basescan.org/tx/0x412f0c72e13cea44292c29203750f0d9deb080e40c2de31f56b414abcbcd8403)
- SuwppuBonds: [`0x11628d89…12d4c`](https://sepolia.basescan.org/tx/0x11628d89448587816a354a30ce6e9aafd3042d97f1ce836b69c4cbd48e112d4c)

**Verified live on-chain:** `MIN_STAKE` guard, per-call `forceApprove`, and the
no-active-stream guard are all active; staking rewards stream per-second via Superfluid
(USDCx at 0.000055/sec in the verification run) with claimable accruing continuously —
no batch/claim step. A second audit pass additionally verified the TWAP-based LP
decomposition in Bonds (flash-loan overmint blocked) and multi-epoch stream funding
(epoch 1 → epoch 2 transition confirmed on a verification deployment,
[`0xAe0E9e82cdc8E72F75B6E15c1989858Dd01Fb9a6`](https://sepolia.basescan.org/address/0xAe0E9e82cdc8E72F75B6E15c1989858Dd01Fb9a6)).

Full deployment history, including superseded addresses: [`contracts/DEPLOYMENTS.md`](../../contracts/DEPLOYMENTS.md).

## External protocol dependencies

Third-party canonical contracts the Suwappu testnet deployment integrates with (not
deployed or controlled by Suwappu):

| Contract | Address | Operator |
|----------|---------|----------|
| USDC (underlying) | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) | Circle (test USDC) |
| USDCx (super token) | [`0xC821107bE6E8eD189F3fe05AD06C496243b53B55`](https://sepolia.basescan.org/address/0xC821107bE6E8eD189F3fe05AD06C496243b53B55) | Superfluid |
| Superfluid Host | [`0x4C073B3baB862572842bFB01F7B1FA40B61D1A06`](https://sepolia.basescan.org/address/0x4C073B3baB862572842bFB01F7B1FA40B61D1A06) | Superfluid |
| GDAv1Forwarder | [`0x6DA13Bde224A05a288748d857b9e7DDEffd1dE08`](https://sepolia.basescan.org/address/0x6DA13Bde224A05a288748d857b9e7DDEffd1dE08) | Superfluid (universal address) |

## Base Mainnet — not yet deployed

Mainnet deployment is gated on the readiness checklist in
[`contracts/MAINNET_READINESS.md`](../../contracts/MAINNET_READINESS.md): independent
audit, public testnet soak, bug bounty, deployment-parameter review, and
monitoring/runbook. Before mainnet, ownership/admin of all contracts transfers to the
treasury multisig. This page will list mainnet addresses when (and only when) they exist.

Security posture to date — internal tooling passes (Slither, Aderyn, Mythril, Medusa
fuzzing) and two internal audit passes with all critical/high findings fixed and
re-verified on-chain: [`contracts/SECURITY.md`](../../contracts/SECURITY.md).

---

## Swap fees

Swap fees are **tier-based**, charged on execution, and configured in
`bot/services/fee_service.py` (single source of truth — every routing integration takes
its fee from `fee_service.get_fee_bps(tier)`).

| Tier | Fee | In bps |
|------|-----|--------|
| Free | 1.0% | 100 bps |
| Pro | 0.5% | 50 bps |
| Premium | 0.3% | 30 bps |
| Enterprise | 0.1% | 10 bps |

**Discount stacking** (applied in this order):

1. **Points discount** — earned via XP; capped at 60% of the tier rate and floored so
   the post-points rate never beats the Enterprise rate (10 bps).
2. **Position-card discount** — holding a Suwappu Positions card (Robinhood Chain,
   chain ID 4663) grants a proportional discount of up to 40% off the post-points rate.
3. **Referee rebate** — users who joined via a referral get 10% off their first 5 swaps.
4. **Absolute floor** — the final effective fee never drops below **2 bps (0.02%)**, so
   referral fee-sharing and the treasury split can never be zeroed.

**Swap limits:** $1 minimum, $100,000 maximum per swap (USD notional).

## Fee sharing (referral revenue)

Referrers earn from three commission streams (`bot/services/referral_service.py`):

**1. Swap commission** — a share of every Suwappu swap fee the referred user pays:

| Referrer tier | Share of swap fee |
|---------------|-------------------|
| Standard / Power | 30% |
| Elite | 40% |

Subject to a minimum-volume gate before payout and a rolling 30-day per-referee reward
cap. Recorded idempotently per swap.

**2. Perps commission** — a share of the Suwappu builder fee on the referred user's
HyperLiquid orders, tiered on the referee's 14-day rolling perps notional volume:

| 14-day referee perps volume | Share of builder fee |
|-----------------------------|----------------------|
| < $10k | 20% |
| $10k – $50k | 30% |
| $50k – $250k | 40% |
| $250k – $1M | 55% |
| ≥ $1M | 80% |

**3. Milestone bonuses** — one-time USD payouts at verified-referral counts:

| Verified referrals | Bonus |
|--------------------|-------|
| 5 | $5 |
| 10 | $15 |
| 20 | $40 |
| 50 | $125 |
| 100 | $300 |

All three streams are idempotent at the database level (keyed per swap, per perp order,
and per milestone respectively), so double-payouts are structurally impossible.

## Chain-specific fee integrations

Fees are collected through each chain's native aggregator/venue mechanism; the
tier-based rate above remains the single source of truth wherever the venue accepts a
caller-supplied fee:

| Venue / chain | Mechanism | Configured value |
|---------------|-----------|------------------|
| HyperLiquid (perps) | Builder fee per order | 1 bp default (`hl_builder_fee_tenths_bps = 10`), user-approved cap 0.1% |
| Starknet (AVNU) | Integrator fee bps | Tier-based via `fee_service`; 100 bps fallback aligned to the no-tier default |
| Solana (Jupiter) | Referral account | `jupiter_referral_account(s)` |
| NEAR Intents (1-Click bridge) | appFee bps | 0 by default (`near_intents_fee_bps`) |
| Cross-chain (Li.Fi) | Integrator ID | `SuwappuProduction` (attribution) |
| Cross-chain (Across) | Integrator ID | attribution only |
| Tempo | Sponsored gas | First-swap gas sponsorship, $100/day budget cap |

## Fee collection & sweeping

- **Collector addresses** — configured per curve: `FEE_COLLECTOR_EVM` and
  `FEE_COLLECTOR_SOLANA` (deployment setting, not hard-coded).
- **Fee sweeper** — background service (`bot/services/fee_sweeper.py`) consolidates
  collected fees **hourly**, with a $1 minimum sweep threshold and a 180s per-sweep
  timeout. Started from the API lifespan; it is an async task, not a separate process.

## Performance & scalability

Properties of the contract + fee architecture that matter for scale:

- **Per-second reward streaming, O(1) in stakers.** Staking rewards distribute via a
  Superfluid GDA pool: one stream funds the pool and every staker's claimable balance
  accrues per second. Adding a staker is O(1) — no reward loops, no epoch-end batch
  jobs, no per-user claim transactions required to accrue.
- **No keeper dependency for accrual.** Because accrual is stream-based, there is no
  cron/keeper that can lag or be griefed to stall rewards.
- **Manipulation-resistant pricing.** Bonds decompose LP at **TWAP, not spot**,
  blocking flash-loan overmint attacks — pricing integrity holds under adversarial
  volume, not just normal load.
- **Off-chain fee computation, on-chain-agnostic collection.** Fee tiers, discounts,
  and referral splits are computed in the API layer and delivered through each venue's
  native fee mechanism, so adding a chain adds no contract surface.
- **Idempotent revenue ledgers.** Referral earnings are keyed per swap / per perp
  order / per milestone with DB-level uniqueness, so retries and replays under load
  cannot double-pay.
- **Hourly sweep batching.** Fee consolidation batches transfers on an hourly cadence
  with a minimum threshold, keeping collection gas amortized as swap volume grows.

## Governance & ownership

- **Testnet deployer/owner:** `0xfbe006d9364Cc59EcAaC0721552014f76354AadB`
  (standalone testnet key — testnet only).
- **Mainnet plan:** ownership/admin of SUWP, SuwppuStaking, and SuwppuBonds transfers
  to the treasury multisig before any mainnet deployment
  ([`contracts/MAINNET_READINESS.md`](../../contracts/MAINNET_READINESS.md)).

---

**Related:** [`contracts/README.md`](../../contracts/README.md) (contract design) ·
[`contracts/DEPLOYMENTS.md`](../../contracts/DEPLOYMENTS.md) (deployment history) ·
[`contracts/SECURITY.md`](../../contracts/SECURITY.md) (security tooling & audits) ·
[Product status](../product-status.md)
