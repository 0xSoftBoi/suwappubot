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
