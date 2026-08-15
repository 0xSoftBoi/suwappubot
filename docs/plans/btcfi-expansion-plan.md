# BTCFi Expansion — Implementation Plan

> Researched 2026-06-12. All addresses verified on-chain (Blockscout/explorers) or via live API
> calls unless marked otherwise. Companion: docs/plans/starknet-btc-neobank-plan.md (shipped),
> memory btcfi-landscape-2026-06. Honest-yield principle carries over: display live rates only.

## Scope

Five workstreams, ordered by value/effort. P1+P2 are the core (risk cleanup + the borrow product
that completes the neobank). P3/P4 are cheap chain adds. P5 is gated on its own verification.

---

## P1 — Wrapped-BTC defaults cleanup (~0.5 day)

Stop defaulting to WBTC (BitGo/BiT Global–Justin Sun custody; removed by Sky, delisted by Coinbase).

**Verified canonical addresses (+decimals — three are 18dp traps):**
```python
CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"  # SAME addr on eth/base/arbitrum; 8dp
CBBTC_SOLANA = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij"  # 8dp
TBTC_ETH = "0x18084fbA666a33d37592fA2633fD49a74DD93a88"  # 18dp
TBTC_ARB_OP = "0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40"  # same addr arb+op (deterministic); 18dp
TBTC_POLYGON = "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b"  # 18dp
BTCB_BSC = "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c"  # 18dp NOT 8
```
Defaults per chain: base/ethereum/solana → cbBTC; arbitrum/optimism/polygon → tBTC; bsc → BTCB.
Keep WBTC tradable, just never the default "BTC" resolution.

**Files:** `bot/config/tokens.py` (add cbBTC/tBTC entries + flip the BTC-symbol resolution
order), anywhere "WBTC" is the implicit BTC default (grep), webapp/api-ts token lists pick up
from config. Tests: symbol→address resolution per chain + decimals.

---

## P2 — Morpho Blue on Base: /borrow against BTC + USDC earn (~2–3 days)

The engine behind Coinbase's own BTC loans. All core items verified on-chain 2026-06-12.

**Contracts (Base, 8453):**
```python
MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"   # verified, name "Morpho"
USDC_BASE   = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"   # 6dp
CBBTC       = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"   # 8dp
MARKET_ID   = "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836"
# MarketParams (immutable, hardcode + assert id == keccak(abi.encode(params)) at startup):
ORACLE = "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9"  # MorphoChainlinkOracleV2; price() 1e36-scaled
IRM    = "0x46415998764C29aB2a25CbeA6254146D50D22687"  # AdaptiveCurveIRM
LLTV   = 860000000000000000  # 86%
# Earn vaults (MetaMorpho ERC-4626): USDC-denominated ONLY — cbBTC supply earns 0.03-0.44%, skip
STEAKHOUSE_USDC = "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183"  # $267M, verified on-chain
GAUNTLET_USDC_PRIME = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61"  # $407M netApy ~4.95% (API-sourced — verify on-chain pre-build)
```
Market live stats at research time: $1.2B borrow, ~5.6% borrow APY, ~90% utilization.

**Calls (small surface — no Python SDK exists; direct web3.py; SKIP Bundler3, sequential txs):**
- Borrow flow: cbBTC `approve(MORPHO, amount)` → `supplyCollateral(params, amount, user, b"")`
  → `borrow(params, assets, 0, user, user)`. onBehalf == msg.sender → no authorization needed.
- Repay: USDC approve → full repay uses `repay(params, 0, position.borrowShares, user, b"")`
  (shares-exact kills interest dust); partial uses assets.
- Exit: `withdrawCollateral(params, amount, user, user)`.
- Reads: `position(id,user)` → (supplyShares, borrowShares u128, collateral u128);
  `market(id)` → totals; debt = shares.mulDivUp(totalBorrowAssets+1, totalBorrowShares+1e6).
- Earn: ERC-4626 approve+`deposit(assets, receiver)` / `redeem(shares, receiver, owner)` —
  identical shape to our Aave/Vesu savings services.

**Health math (dimensionally verified):** oracle price scale 1e(36+6−8)=1e34;
`max_borrow = collateral.mulDivDown(price, 1e36).wMulDown(lltv)`; HF = max_borrow/debt.
Policy: default borrow 50% LTV, hard cap 64.5% (0.75×LLTV), warn HF<1.2, urgent HF<1.05.

**New components:**
- `bot/services/morpho_api.py` — market/position reads, borrow/repay/collateral txs, GraphQL
  client `https://blue-api.morpho.org/graphql` (no auth; NOTE schema drift: field is `marketId`,
  `marketByUniqueKey` is gone — use the tested queries in research) for APYs + `listed:true` vaults.
- `bot/services/health_monitor_btc.py` or extend existing alert_service — poll borrower
  positions (position+market+oracle.price in one multicall, 1–5 min cadence), HF alert tiers.
- Handlers: `/borrow` flow (pick wallet → deposit cbBTC → choose LTV slider ≤64.5% → borrowed
  USDC lands in wallet) + repay/add-collateral/close + position view with live HF.
  Earn side: add Morpho USDC vault as a venue in the existing /save (Base section).
- Rewards: SKIP claiming (URD deprecated, Merkl complexity); surface netApy only.

**Risks/invariants:** liquidation is user-facing — every borrow confirm screen shows liquidation
price; never auto-borrow; exact-amount approvals; assert market id at startup; fee switch off.

---

## P3 — Rootstock chain add (~1 day)

$98M TVL, mature since 2018. LiFi covers it (VERIFIED live: chain 30 "Rootstock" RBTC in
li.quest/v1/chains; routes via OpenOcean/Sushi/Eisen — `fromChain=30` just works). 1inch does NOT.

**Config:** chain "rootstock" id 30, RPC `https://public-node.rsk.co` (verified eth_chainId 0x1e),
explorer `https://rootstock.blockscout.com` (Blockscout API v2), native RBTC 18dp.
Tokens: WRBTC `0x542FDA317318eBf1d3DeAF76E0B632741a7e677d` 18dp;
rUSDT `0xEf213441a85DF4d7acBdAe0Cf78004E1e486BB96` **18dp NOT 6**;
USDC.e `0x74C9F2B00581F1b11Aa7Ff05aa9f608B7389de67` 6dp;
DOC `0xE700691Da7B9851F2F35f8b8182C69C53ccad9DB` 18dp.

**Gotchas (the real work):**
1. **No EIP-1559** — web3.py v6+ tries eth_feeHistory and fails. Set legacy gas price strategy;
   network minimum 60_000_000 wei (0.06 gwei). Audit our EVM send path for 1559 assumptions.
2. **EIP-1191 checksums** (chainId-salted) — web3.py emits EIP-55. Compare lowercased only;
   never validate RSK addresses by EIP-55 checksum.
3. Aggregator dicts: add LiFi id 30 only; explicitly absent from 1inch/0x/Kyber/OKX.
Swap routing = existing LiFi path; Sovryn direct router only if LiFi proves flaky (address must
be re-verified from DistributedCollective/Sovryn-smart-contracts deployment JSON — unresolved).

---

## P4 — Citrea chain add + Lightning→Citrea (~1–2 days)

ZK rollup, live Jan 2026, $4.3M TVL (thin — position as early/narrative). The unique product:
**Atomiq LN→cBTC route VERIFIED LIVE** (getSwapLimits LIGHTNING-BTC→CITREA-CBTC: 100–2,000,000
sats; CBTC 18dp native). Our /btc flow gains a "to Citrea" destination with ~30 lines (new dst
chain enum in btc_bridge + wallet on chain 4114).

**Config:** chain "citrea" id 4114, RPC `https://rpc.mainnet.citrea.xyz` (verified 0x1012),
explorer `https://explorer.mainnet.citrea.xyz` (Blockscout). Native cBTC 18dp.
Tokens: WcBTC `0x3100000000000000000000000000000000000006` **18dp NOT 8**;
ctUSD `0x8D82c4E3c936C7B5724A382a9c5a4E6Eb7aB6d5D` 6dp; USDC.e `0xE045e6c36cF77FAA2CfB54466D71A3aEF7bbE839` 6dp;
WBTC.e `0xDF240DC08B0FdaD1d93b74d5048871232f6BEA3d` 8dp.

**Swaps:** JuiceSwap UniV3 fork (docs.juiceswap.com/smart-contracts):
Factory `0xd809b1285aDd8eeaF1B1566Bf31B2B4C4Bba8e82`, SwapRouter `0x565eD3D57fe40f78A46f348C220121AE093c3cF8`
(plain SwapRouter, NOT SwapRouter02 — deadline inside params, adjust our goatswap_api pattern),
QuoterV2 `0x428f20dd8926Eabe19653815Ed0BE7D6c36f8425`, V2 Router `0x6BDea31C89E0A202cE84b5752BB2e827B39984ae`.
Reuse goatswap_api.py generalized into a small `univ3_fork_api` (GOAT + Citrea configs).

**Gotchas:** EIP-1559 OK (Type-2 zkEVM, Pectra) but **L1 fee surcharge not in eth_estimateGas**
— add 10–20% fee headroom; no EIP-4844; 2s blocks. Morpho Blue is deployed at the canonical
`0xBBBB...FFCb` on Citrea too (docs-sourced — verify before any lending feature there; v1 = swaps only).

---

## P5 — SolvBTC.ENA "high-yield BTC" tier (gated — verify first)

~7–10% net via Ethena basis (cyclical; 20% perf fee; can invert). NOT yet implementation-ready:
SolvBTC/SolvBTC.ENA contract addresses + mint/redeem flow per chain were not verified this pass.
Pre-build checklist: verify contracts on ETH/Base/BNB from Solv docs+explorers, confirm
permissionless mint (no KYC gate at contract level), redemption liquidity/delays, then model on
our ERC-4626-ish venue pattern with EXPLICIT UX labeling: "delta-neutral basis strategy, yield
varies and can pause — not spot BTC staking." Skip if mint is gated or redemption is gated.

---

## Cross-cutting

- **Order:** P1 → P2 → P3 → P4 → P5. P1+P3 could batch into one PR; P2 standalone (money path,
  full adversarial review); P4 standalone.
- Worktree builds; explicit-file staging (no `git add -A`); reviewer pass on P2 and the
  bridge-touching part of P4; tests per suite + live functional verification before "live" claims.
- Effort: ~5–7 engineer-days total.
- New envs: none required (public RPCs default); optional ROOTSTOCK_RPC_URL/CITREA_RPC_URL overrides.

## Open items
- [ ] Sovryn router address from deployment JSON (only if LiFi-on-RSK underperforms)
- [ ] Gauntlet USDC Prime vault on-chain verification (API-sourced)
- [ ] Solv contracts verification (gates P5)
- [ ] Morpho-on-Citrea address verification (gates any Citrea lending, not in v1)
- [ ] Atomiq dst wiring: ensure Botanix is never exposed as a destination (chain shutting down 2026-07-09)
