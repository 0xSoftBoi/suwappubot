# Suwappu Positions — Robinhood testnet (46630) deployment

Deployed **2026-08-26** from `claude/nft-collections-market-redesign-gm1kpr`, signed by the
company **Turnkey** hot wallet `hot_EVM Hot Wallet` — no private key was ever exported,
copied into a shell, or written to disk. The job ran as the Railway service
`testnet-runner` (`scripts/testnet_turnkey_deploy_runner.py`), next to the Turnkey
credentials rather than moving them.

| Contract | Address |
|---|---|
| SuwappuPositions | [`0xb573097b77cF2D53352660C62378b9c87473a5ea`](https://explorer.testnet.chain.robinhood.com/address/0xb573097b77cF2D53352660C62378b9c87473a5ea) |
| RobinhoodChainlinkOracle | [`0x9A80798462C3A2725C3644CA4c92790aD51c13d7`](https://explorer.testnet.chain.robinhood.com/address/0x9A80798462C3A2725C3644CA4c92790aD51c13d7) |
| MockUSDG | [`0x0de5d84851301F1dbc609E0A21FafB80403dA702`](https://explorer.testnet.chain.robinhood.com/address/0x0de5d84851301F1dbc609E0A21FafB80403dA702) |

Deployer / owner / treasury: `0xf66d64b56Dd5ef0Deae13bBb9676cE0050F237a3`.

## Verified on-chain (eth_call, not from deploy logs)

| Property | Value |
|---|---|
| `MAX_SUPPLY` | 4444 |
| `RESERVE_MAX` | 45 |
| `holdDiscountFractionBps` | 4000 (40%) |
| `goldDiscountFractionBps` | 5500 (55%) |
| `treasury` | `0xf66d…37a3` |
| `royaltyInfo(1, 1e18)` | `0xf66d…37a3`, 0.02 ETH = **2%** |
| `registrySealed` | true (irreversible — ticker order is final) |
| Phase 3 (Public) | price 1900 cents, walletCap 5, allocation 1845 |
| Phase 4 (Gold) | price 11900 cents, walletCap 2, allocation 555 |

Royalty receiver equals treasury, confirming the money-path fix (`setTreasury` re-points the
ERC-2981 receiver) works against a live chain, not just in tests.

## Deliberately not configured

**Founder (1) and Allowlist (2)** need Merkle roots from `build_allowlist.py --from-db`,
which requires a production DB snapshot. Configure them before any real mint.

## Expected testnet behavior

Chain 46630 has **no Chainlink equity feeds** (the verified feeds are mainnet 4663
addresses), so every card renders `UNPRICED` and mints stamp `entryPrice = 0`. That is the
oracle-outage path working as designed, not a failure.

## Two bugs this deploy found that tests could not

1. `serializable_unsigned_transaction_from_dict(...)` returns an `rlp.Serializable` with no
   `.encode()`. The Turnkey deploy path had never run with a funded signer, so it crashed
   the first time it mattered. Fix: `rlp.encode(unsigned)` — the EIP-155 preimage, matching
   `wallet.py::_serialize_evm_transaction`, which was already doing it correctly.
2. `asyncio.run()` per transaction closes its event loop, but the Turnkey client caches an
   aiohttp session bound to the loop that created it — contract #1 deployed, #2 died with
   "Event loop is closed". Fix: one long-lived loop for every signature in the process.

## Re-running

The runner's `watchPatterns` are pinned to a manual-deploy-only sentinel so a branch push
cannot silently redeploy it. To run again, point `watchPatterns` at `/scripts/**` and push,
or redeploy the service from the Railway dashboard.
