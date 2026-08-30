# Production Contracts

Canonical reference for Suwappu's deployed smart contracts. Always verify the **chain ID** and the exact address against this page before signing any transaction.

> **Suwappu protocol contracts are live on Base Sepolia testnet only (chain ID 84532).** There are **no mainnet deployments** yet — any address presented to you as a "Suwappu mainnet contract" is not ours.

## Base Sepolia (testnet) — chain ID 84532

Current hardened deployment, redeployed after fixing 4 critical + 7 high internal-audit findings. These supersede all earlier testnet addresses.

| Contract | Address |
|----------|---------|
| SUWP token | [`0x0b96a41a2a4c9b50097049d24f43848be3A892e8`](https://sepolia.basescan.org/address/0x0b96a41a2a4c9b50097049d24f43848be3A892e8) |
| SuwppuStaking | [`0xFA1142C788b6BC09CD16490dFEdAcEAFC505bA17`](https://sepolia.basescan.org/address/0xFA1142C788b6BC09CD16490dFEdAcEAFC505bA17) |
| SuwppuBonds | [`0x9aCCf607AF27327B4940827a5c389F109847562D`](https://sepolia.basescan.org/address/0x9aCCf607AF27327B4940827a5c389F109847562D) |
| Superfluid GDA pool (reward streaming) | [`0x924c4FA120d647B432D1E9F6e9632c2f4CEDfCFf`](https://sepolia.basescan.org/address/0x924c4FA120d647B432D1E9F6e9632c2f4CEDfCFf) |

Verified live on-chain: `MIN_STAKE` guard, per-call `forceApprove`, and the no-active-stream guard are all active, and staking rewards stream per-second via Superfluid with claimable balances accruing continuously — no batch or claim step.

## External dependencies

Third-party canonical contracts the deployment integrates with (operated by Circle and Superfluid, not Suwappu):

| Contract | Address | Operator |
|----------|---------|----------|
| USDC (underlying) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | Circle (test USDC) |
| USDCx (super token) | `0xC821107bE6E8eD189F3fe05AD06C496243b53B55` | Superfluid |
| Superfluid Host | `0x4C073B3baB862572842bFB01F7B1FA40B61D1A06` | Superfluid |
| GDAv1Forwarder | `0x6DA13Bde224A05a288748d857b9e7DDEffd1dE08` | Superfluid (universal) |

## Base Mainnet — not yet deployed

Mainnet is gated on a readiness checklist: independent audit, public testnet soak, bug bounty, deployment-parameter review, and monitoring runbooks. Before mainnet, ownership and admin of all contracts transfer to the treasury multisig. This page will list mainnet addresses when — and only when — they exist.

## Security posture

The contracts pass internal tooling (Slither, Aderyn, Mythril, Medusa fuzzing) and two internal audit passes with every critical and high finding fixed and re-verified on-chain, including TWAP-based LP decomposition in Bonds that blocks flash-loan overmint attacks.

## Built to scale

- **Per-second reward streaming, O(1) in stakers.** Rewards distribute through a Superfluid GDA pool: one stream funds the pool and every staker accrues per second. Adding a staker adds no loops, no epoch-end batch jobs, and no keeper dependency.
- **Manipulation-resistant pricing.** Bonds price LP at TWAP, not spot, so pricing integrity holds under adversarial volume.
- **No contract surface per chain.** Fees are computed off-chain and collected through each venue's native mechanism, so new chains add zero contract risk.

Machine-readable snapshot and full deployment history live in the [GitHub repository](https://github.com/0xSoftBoi/suwappubot) under `docs/reference/`.
