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
  --constructor-args <SUWP_ADDRESS> 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 <OWNER_ADDRESS> \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --verify
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
