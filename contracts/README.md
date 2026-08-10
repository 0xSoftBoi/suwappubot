# SUWP Contracts (Base)

## Contracts

### `SUWP.sol` — ERC-20 Protocol Token
- Standard ERC-20, 18 decimals
- `MINTER_ROLE` → protocol multisig wallet
- No hard supply cap; minted on-demand for points claims + staking emissions
- `batchMint()` for weekly gas-efficient distributions
- Pausable for emergencies

### `SuwppuStaking.sol` — Staking + Real Yield
- Stake SUWP, earn USDC (20% of protocol fees) + bonus SUWP
- No lockup — unstake any time
- Weekly `distributeEpoch()` call from protocol wallet
- Pull-based reward claiming (`claimRewards()`)

## Deployment (Base mainnet)

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Install OpenZeppelin
forge install OpenZeppelin/openzeppelin-contracts

# Deploy SUWP token
forge create contracts/SUWP.sol:SUWP \
  --constructor-args <ADMIN_MULTISIG_ADDRESS> \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --verify

# Deploy Staking contract
forge create contracts/SuwppuStaking.sol:SuwppuStaking \
  --constructor-args <SUWP_ADDRESS> 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 0xD04383398dD2426297da660F9CCA3d439AF9ce1b 0x4C073B3baB862572842bFB01F7B1FA40B61D1A06 0x6DA13Bde224A05a288748d857b9e7DDEffd1dE08 <OWNER_ADDRESS> \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --verify
```

## Superfluid Addresses (Base mainnet)
- Host: 0x4C073B3baB862572842bFB01F7B1FA40B61D1A06
- GDA:  0x6DA13Bde224A05a288748d857b9e7DDEffd1dE08
- USDCx (wrapped USDC): 0xD04383398dD2426297da660F9CCA3d439AF9ce1b

## SuwppuBonds — Protocol-Owned Liquidity

Users sell SUWP/USDC Uniswap v3 LP NFTs to the protocol treasury.
Protocol pays discounted SUWP (5% below TWAP) vesting over 7 days.
Protocol holds LP permanently → earns trading fees forever.

### Deploy sequence
```bash
# 1. Deploy SuwppuBonds
forge create contracts/SuwppuBonds.sol:SuwppuBonds \
  --constructor-args <SUWP_ADDRESS> 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
    0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f \
    <OWNER_MULTISIG> \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --verify

# 2. Grant MINTER_ROLE on SuwpOFT to SuwppuBonds address
# 3. After SUWP/USDC pool exists: call setSuwpUsdcPool(<pool_address>)
```

### Uniswap v3 on Base
- Position Manager: `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f`
- Factory: `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`

### Production note on pricing
The TWAP price function uses a simplified tick→price approximation.
In production, integrate Uniswap v3's TickMath library for exact pricing:
`forge install Uniswap/v3-core` then use `TickMath.getSqrtRatioAtTick(avgTick)`.

## SuwpOFT — Omnichain Token

Replace `SUWP.sol` with `SuwpOFT.sol` for cross-chain deployment.

### LayerZero V2 Endpoints
| Chain | Endpoint |
|-------|----------|
| Base mainnet | `0x1a44076050125825900e736c501f859c50fE728c` |
| Arbitrum One | `0x1a44076050125825900e736c501f859c50fE728c` |
| Polygon | `0x1a44076050125825900e736c501f859c50fE728c` |
| Base Sepolia (testnet) | `0x6EDCE65403992e310A62460808c4b910D972f10f` |
| Arbitrum Sepolia (testnet) | `0x6EDCE65403992e310A62460808c4b910D972f10f` |

### DVN Security Configuration (REQUIRED)
After deployment, configure ≥2 DVNs to prevent single-point bridge failures:
```
LZ DVN: 0x589dEDbD617e0CBcB916A9223F4d1300c294236b (Base mainnet)
Google Cloud DVN: 0xD56e4eAb23cb81f43168F9F45211Eb027b9aC7cc (Base mainnet)
```
Set enforced options via `setEnforcedOptions()` with both DVNs required.

### Deploy sequence
```bash
# 1. Deploy on Base (canonical — minting happens here)
LZ_ENDPOINT=0x1a44076050125825900e736c501f859c50fE728c \
ADMIN=<multisig> \
forge script contracts/deploy/DeploySuwpOFT.s.sol --rpc-url base --broadcast --verify

# 2. Deploy on Arbitrum
LZ_ENDPOINT=0x1a44076050125825900e736c501f859c50fE728c \
ADMIN=<multisig> \
forge script contracts/deploy/DeploySuwpOFT.s.sol --rpc-url arbitrum --broadcast --verify

# 3. Wire peers (setPeer on each contract pointing to the other chains)
# Use LayerZero's wire-all script or OFT Scan dashboard
```

## Running Tests
```bash
forge test --match-contract SuwppuStakingTest -vv
```

## Weekly Distribution Flow

1. Fee sweeper collects 20% of weekly fees as USDC
2. Protocol sends USDC to `SuwppuStaking` contract
3. Protocol mints 10,000 SUWP to `SuwppuStaking` contract
4. Protocol calls `distributeEpoch(stakerAddresses[], usdcAmount, suwpBonus)`
5. Stakers call `claimRewards()` at their convenience

## Points → SUWP Flow

1. User runs `/claim` in Telegram bot
2. Bot burns points from `user_points` DB row
3. Bot creates `token_claims` DB record (status: pending)
4. Weekly batch: protocol calls `batchMint(wallets[], amounts[], "points_claim")`
5. Bot updates DB records to completed + tx_hash

## Environment Variables Needed

```
SUWP_CONTRACT_ADDRESS=0x...       # After deployment
STAKING_CONTRACT_ADDRESS=0x...    # After deployment
PROTOCOL_WALLET_PRIVATE_KEY=...   # Signs distribution txs (use KMS in prod)
```

## Core Primitives (`primitives/`)

Immutable, oracle-free, governance-free "deploy-once-run-forever" building blocks
in the spirit of Uniswap v1 / Ajna. No owner, no pause, no upgrade path.

### `SuwappuTimeCurve.sol` — Time-Locked Continuous Bonding Curve
The contract is itself the curve token (mint on buy, burn on sell) against one
ERC-20 reserve. Price is a pure function of time and supply:
`p(s,t) = e^(rate·t) · (basePrice + slope·s)`. Continuous two-way liquidity, no
auctions, no feeds. Optional immutable `sinkRate` burns a fraction of every sell
without refund, permanently shrinking supply and building a reserve surplus.
Decay/flat schedules are provably solvent; growth schedules are protected by a
hard `refund ≤ reserve` guard and should pair with a non-zero sink.

### `SuwappuAmortizingVault.sol` — Self-Repaying Collateralized Position
Deposit ERC-4626 shares as collateral, borrow the vault's *underlying* asset
from a pooled lender side. Debt and collateral share the same denomination, so
LTV needs **no oracle** (`convertToAssets`). Permissionless `amortize()` redeems
exactly the yield the collateral earned and applies it to the position's debt;
at zero debt the collateral unlocks. Liquidation only if undercollateralized
before self-repayment finishes, always after amortizing first.

### `SuwappuMutualCredit.sol` — Mutual Credit Clearing Network
Bilateral credit lines (propose → accept, terms fixed at opening) in any ERC-20
unit of account. `pay()` moves value as credit within the limit each party
extended; `netCycle()` lets anyone submit a debt cycle A→B→…→A and net every leg
by the cycle minimum; `settle()` clears residuals with real tokens. Creditors can
`demandSettlement()`, and after the line's grace period `markDefault()` freezes
the line and records the default on-chain for reputation layers to build on.

### Tests
`test/PrimitivesTest.t.sol` — 24 tests: solvency after decay/growth, sink
accounting, fuzzed round-trip non-profitability, LTV/liquidation paths,
self-repayment to unlock, lender interest, cycle netting, defaults.

```bash
forge test --match-path "test/PrimitivesTest.t.sol"
```
