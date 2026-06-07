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
