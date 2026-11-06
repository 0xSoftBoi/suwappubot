# Suwappu propAMM — reverse-engineering notes + build guide

Date: 2026-11-06. Sources: docs.metric.xyz, docs.titanbuilder.xyz (via llms.txt), Blockscout (mainnet), gattaca-com/propamm README, DefiLlama (search summary only).
Confidence tags: **[V]** verified in docs/on-chain, **[I]** inference, **[?]** not found.

## 1. What a propAMM is (as it exists on Ethereum today)

Not a curve. A maker holds inventory in a vault, publishes a fresh price every block (~50 ms cadence off-chain), and the **block builder guarantees that the latest price update is sequenced immediately before any taker trade against that pool**. If nobody trades, the update never lands and the maker pays no gas. Toxic-flow defence = a builder-enforced freshness buffer (takers who arrived within `b` of the update cannot be sequenced against it) + per-pool guard extensions.

Three layers: **(a) swap contract + vault**, **(b) price source the maker writes**, **(c) builder/sequencer integration that orders the write before the taker**. (c) is the moat — it's a business relationship, not code.

## 2. FermiSwap (the "Femiswap" target) — what we could actually see

- Ethereum only. DefiLlama: ~$6.2m TVL, ~$702m 30d volume, WETH/USDT/USDC/cbBTC/WBTC **[V, single snapshot]**.
- `FermiSwapper` wrapper `0xb1076fe3ab5e28005c7c323bac5ac06a680d452e` — verified, Solidity 0.8.28, no proxy **[V]**.
  - `fermiSwapWithAllowances(tokenIn, tokenOut, int256 amountSpecified, uint256 amountCheck, address recipient)` and `fermiSwapWithCallback(..., bytes)`; +amount = exact-in, −amount = exact-out; slippage revert "ACF"; callback underpay revert "WTA"; both `nonReentrant`.
  - Pays `tokenOut` from `traderVault`, then pulls `tokenIn` into the vault. Views: `quoteAmounts`, `isActive`, `getPairs`, `fermi`, `traderVault`.
  - All pricing delegated to an external engine via `fermi.swap(tokenIn, tokenOut, amountSpecified, msg.sender)`.
- Engine (`fermi()`) = `0x90f73feA1Ee2dC514D4dbac0bFf7fF04B933767f` — **unverified on Blockscout; source not readable [V]**. Vault (`traderVault()`) = `0x585d44727129B9C69791B10238Ca605932938B4F`. Manager (immutable, fully trusted, has `executeGeneral` arbitrary call) = `0x7117CA30aF85706B964100Dd8FBbe78F2FB6D3d8`. Engine was swapped via `setFermi` on 2026-07-21.
- Routed through Titan's pAMM stream; KyberSwap integrated it first (June). Swaps seen at block positions 3–19 and 232 in a small sample — i.e. the update is placed before the taker, not that the taker is top-of-block **[V, ~8 txs]**.
- **Update 2026-11-06 — engine traced (see `docs/research/fermi-FINDINGS.md`, Metric: `docs/research/metric-FINDINGS.md`).** The engine holds no price: it reads an external push-oracle registry `0xDa7A…8C5F` (`values[0]` at 1e8), pushed by 8 whitelisted updater EOAs in the same block immediately before the swap (31/35 swaps at index−1; zero priority fee; builder bundle placement). Edge is a convex piecewise-linear function of size (~0.7 bps tiny → ~5 bps @ $500k) plus an asymmetric inventory-skew term read from vault balances, with per-token vault caps and a ~$3M max trade. **It stopped trading ~2026-09-01** (vault still ~$5M) — a caution that edge decays/competition (Metric, Kipseli, Bebop) matters. Arithmetic is empirical (decompiler failed), not read from code.
- Metric differs: oracle is public Solidity (`CompressedOracleV1` raw-sstore packed lanes, hot-key delegation by signed consent) and the pool is a bin ladder priced as offsets from ref; its top pool (USDC/USDT) did ~$83M/24h with the same "update immediately before swap" ordering.

## 3. Metric — the best documented reference design

Oracle-priced bin AMM, split into pool / provider / oracle. Same addresses on Ethereum (1), BSC (56), Robinhood Chain (4663) **[V]**.

- **Pool** (`MetricOmmPoolFactory` `0x2a53…8f32`): bins around a reference price; `swap(recipient, zeroForOne, int128 amountSpecified, uint128 priceLimitX64, callbackData, extensionData)` → pays out first, callback `metricOmmSwapCallback`, then balance-checks (Uniswap-v3 style). Partial fills at price limit.
- **Price Provider** — the key interface:
  ```solidity
  interface IPriceProvider {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getQuote() external returns (uint128 bidPrice, uint128 askPrice, uint128 referencePrice); // Q64.64
  }
  ```
  Constraints: `0 < bid < ref < ask`; asymmetry bound `1/M ≤ (ref/bid−1)/(ask/ref−1) ≤ M`; stale/missing input **must revert** (pool wraps as `PriceProviderFailed`).
- **Maker oracle:** `CompressedOracleV1` `0xE844…3872` — 4 feeds per 32-byte slot, ~8k gas/feed, batchable, only feed creator/authorized updater writes, monotonic timestamps (old update can't overwrite new). Write ABI **[?]** — read `github.com/Metricxyz/mm-pusher-ts`.
- **Guards (extensions, can only reject):** `OracleValueStopLossExtension` (drawdown vs decaying peak), `PriceVelocityGuardExtension`, `SwapAllowlistExtension`, `DepositAllowlistExtension`. Anchored provider clamps bid/ask against Chainlink/Pyth. Green tier: immutable provider, bin ≤1%, drawdown/decay ≤15%, feeds ≤15 s stale.
- **Fees baked into the quote:** half-spread + per-bin/direction fee + optional notional fee (≤1%, Metric-set). Metric's default share 7.5%.
- **Quote submission:** maker signs the oracle-update tx → `POST api.metric.xyz/public/v1/evm/{1|56}/pamm-quote` (`tx`, `blockNumber`, `replacementUuid`, `replacementSeqNumber`, `quoteAddress`, `poolAddresses`, `assetPairs`) → forwarded to Titan, Quasar, BuilderNet, etc.; included only in a block with a trade against the pool, ordered before it; priority tips do nothing.
- **Caveat on routers:** `MetricOmmSimpleRouter` doesn't check tokens match the pool and exposes `sweepToken` to anyone — don't copy that. Price reads are restricted to registered pools during a swap, so integrators simulate via `swap` + revert-with-deltas.
- 5 audits (Zellic ×2, Sherlock ×3); multiplier oracle unaudited.

## 4. Titan ACE — the sequencing layer

- Maker path: `wss://{eu|us|ap}.rpc.titanbuilder.xyz/ws/sendquoteupdate`, API key in `Authorization` on handshake, **gated — must be requested** **[V]**. Protobuf `PWebsocketQuoteUpdateV1Args`: `tx` (RLP signed, empty = cancel), `block_number`, `replacement_uuid` (16 B), `replacement_seq_number` (strictly increasing), `disable_cross_region_sharing`, `asset_pairs` (40 B = token0‖token1), `quote_address`, `pool_addresses`. Response: uuid, seq, recv timestamp ns, error, bundle_hash.
- Freshness buffer `b` per session (set at onboarding); requote ≈ every 50 ms; quotes idle >400 ms evicted; modes: every-block or conditional (only lands if a taker shows).
- Pricing: no priority fee; per-pair volume fee on fills (schedule unpublished, discounted in test).
- **Pool must implement `IPropAMM.sol`** (repo `propamm-router-contracts`); PropAMM Router `0x4ddf368080cd7946db5b459ad591c350158175e1`. 12 live makers listed (Fermi, Kipseli, Bebop, Metric, Tempest…).
- Taker side: normal `eth_sendBundle` candidates re-simulated per quote update; data streams `pamm_quote_stream_v2`, `pamm_price_levels_v2`; JSON-RPC `titan_getPammQuote*`.
- Generic `eth_sendBundle` / `eth_sendPrivateTransaction` have **no** top-of-block guarantee. Chains: Ethereum + Hoodi only documented. Ordering guarantee is Titan-block-only — landing share = Titan's proposer share **[not verified]**.
- Not captured (fetch tool summarised): `.proto` files, Rust example, actual `b`, fee numbers.

## 5. Recommended Suwappu design

**Adopt Metric's split, FermiSwap's custody shape.** Concretely:

1. `SuwappuPropPool` — monolithic swap contract implementing `IPropAMM`, exact-in/out with `amountCheck` + callback variant (FermiSwapper ergonomics), `nonReentrant`, pay-out-first with balance check.
2. `SuwappuPriceProvider` — implements Metric's `getQuote()` shape (bid/ref/ask Q64.64, asymmetry bound, **revert on stale**). Reads a packed oracle slot written by the maker.
3. `SuwappuOracle` — packed feeds, monotonic timestamp, `updater` allowlist (maker hot key), ≤ ~8k gas/feed.
4. Guards as pre-swap checks inside the pool (not a trusted admin): max trade size vs inventory, drawdown stop-loss with decay, price-velocity guard, optional Chainlink/Pyth anchor clamp, per-block notional cap.
5. Inventory in a vault with **no arbitrary-call admin**. Fermi's `executeGeneral` manager is the trust anti-pattern: use a timelocked multisig, withdraw-only roles, pause-only guardian.
6. Off-chain maker (TS service in `api-ts` or a standalone worker): fair-value feed (CEX/Pyth) → skew by inventory → sign oracle-update tx → protobuf WS client to Titan with fixed UUID + monotonic seq, 50 ms loop, cancel path. Quote-signing key in KMS/HSM, not an env var.
7. Distribution: Kyber/1inch/Odos integrations; Titan taker stream makes us discoverable once registered.

**Phasing**
- P0 (business, blocks everything): request Titan maker API key + `.proto` + `b` + fee schedule; ask Metric whether we can list a pool on theirs instead (fastest path to live flow, but Metric-curated).
- P1: contracts + Foundry fork tests on mainnet fork; `IPropAMM` conformance; Hoodi deploy.
- P2: maker bot on Hoodi with synthetic taker; measure markout/adverse selection using our existing execution-intel scoring.
- P3: mainnet with tiny inventory cap; staged limits.

## 6. Risks / open questions

- **MONEY-PATH**: swap exec, vault custody, hot signing key → `money-path-reviewer` (Opus) + `security-auditor` + external audit before any real inventory. No loss cap for LPs in Metric's model; we must set ours.
- Ordering guarantee is builder-specific; outside Titan/participating builders a rival bundle can front-run an update. Need Titan proposer-share data.
- Adverse selection is the whole business: a stale quote that lands is a free option to takers. Stale-revert + velocity guard + conditional-inclusion mode are the defences.
- Oracle write ABI, Metric events, FermiSwap engine source: **unverified** (see §2/§3 follow-ups).
- Fits CLAUDE.md "preserve product vision": this is a new Solidity + market-making stack, not a bot/api change; needs an explicit scope/capital decision before building.

## 7. Follow-ups worth doing next
1. Fetch Metric ABI JSONs + `Metricxyz/mm-pusher-ts` (oracle write ABI, `PoolParameters`).
2. Decompile FermiSwap engine `0x90f7…767f`; list its non-swap txs to identify updater + cadence.
3. Pull `gattaca-com/propamm` and `propamm-router-contracts` for `IPropAMM.sol`.
4. Check Flashbots Priority Update Registry (permissionless alternative to Titan gating).
