# Suwappu Contract Deployments

## Base Sepolia (testnet) — chain 84532

| Contract | Address |
|----------|---------|
| SUWP token | `0xFd3053F4D2fE884eE23ff3C4aBAe50D1f6f3cDa2` |
| SuwppuStaking | `0x5d46653d49242a26A314a0597c0A79E5Af6a6b4d` |
| SuwppuBonds | `0x8450Aa469fC6c6aA64AA8e3fCF9a6D9d329F4d84` |
| USDCx (super token) | `0xC821107bE6E8eD189F3fe05AD06C496243b53B55` |
| Superfluid GDA pool | `0x9bea50565BeCA34bdB0Bd02e66B3b915cd215177` |

- USDC (underlying): `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle test USDC)
- GDAv1Forwarder: `0x6DA13Bde224A05a288748d857b9e7DDEffd1dE08` (universal)
- Deployer/owner: `0xfbe006d9364Cc59EcAaC0721552014f76354AadB` (standalone testnet key)
- Explorer: https://sepolia.basescan.org/address/0xFd3053F4D2fE884eE23ff3C4aBAe50D1f6f3cDa2

State at deploy: 1M SUWP minted to deployer; Staking + Bonds both granted MINTER_ROLE;
Superfluid GDA streaming pool created successfully.

**Before mainnet:** transfer ownership/admin of all three contracts to the treasury multisig.

## Base Mainnet — not yet deployed

## Working SuwppuStaking (decimal-fixed) — Base Sepolia
After fixing the fundStream decimal bug (usdcx.upgrade must take the 18-dec amount):

| Contract | Address |
|----------|---------|
| SuwppuStaking (live, stream-verified) | `0x9a7F2AF86c6834F2043066de0060862626aCD0cf` |
| Superfluid GDA pool | `0x90e99a3bFc12d79C0c19D6B3a40f788cb8bD1237` |

Verified live: 5000 SUWP staked → USDCx streams to staker at 0.000115 USDCx/sec
(9.94 USDCx/day), claimable accrues per-second with no batch/claim step.
fundStream tx: 0xd1edf6f40c1de810649001baed833a9737a88f4518348649608bf18fd4cd24ac

## Hardened redeploy (post-audit) — Base Sepolia
After fixing 4 critical + 7 high audit findings. These supersede all addresses above.

| Contract | Address |
|----------|---------|
| SUWP | `0x0b96a41a2a4c9b50097049d24f43848be3A892e8` |
| SuwppuStaking | `0xFA1142C788b6BC09CD16490dFEdAcEAFC505bA17` |
| SuwppuBonds | `0x9aCCf607AF27327B4940827a5c389F109847562D` |
| Superfluid GDA pool | `0x924c4FA120d647B432D1E9F6e9632c2f4CEDfCFf` |

Verified live: MIN_STAKE guard, per-call forceApprove, no-active-stream guard all
active; USDCx streams at 0.000055/sec (4.75/day), claimable accrues per second.

## Second audit pass — verified fixes
- CRITICAL (Bonds): LP now decomposed at TWAP not spot (flash-loan overmint blocked)
- HIGH (Staking): removed the flowRate==0 guard that permanently bricked epoch 2
  Verified on Base Sepolia (staking 0xAe0E9e82cdc8E72F75B6E15c1989858Dd01Fb9a6):
  epoch 1 funded → epoch 2 funded → currentEpoch=2 ✓ (would have been impossible before)
