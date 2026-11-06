# Metric — reverse-engineering findings (Ethereum mainnet)

Date 2026-11-06. Full Solidity is public (GitHub org Metricxyz: pool-contracts, oracle-contracts, periphery-contracts, mm-pusher-ts, sdk, Known_issues). Core contracts + the live pool are Blockscout-verified. Pool/factory/extensions solc 0.8.35; oracles 0.8.33. Cloned repos live untracked under `docs/research/metric/repos/` (do not commit).
Tags: VERIFIED = from source/on-chain data; INFERRED = reasoning.

## 1. CompressedOracleV1 `0xE844701934D9C6085B292e428F41b911cC0b3872` (VERIFIED)
- Hot write path is `fallback()`, no selector. Calldata = `0x00 ‖ word(32B) × N`. Leading byte skipped, not checked (CompressedOracle.sol:368-403).
- Slot word: `lane0..lane3 (48b each, bits 255..64) | timestamp uint56 ms (bits 63..8) | slotId (bits 7..0)`.
  - Lane = `p (32b U64x32) | s0 (8b) | s1 (8b)`. U64x32 = `exp5<<27 | mant27`, decodes to the E8 mid.
  - s0/s1 = indices into a 256-entry codebook of spreads in 0.01 bps (max 1%). `s0=s1=0xFF` = stall marker.
  - slotId byte cleared before store; storage key = `creator<<96 | slotId` via raw sstore.
- Feed id = `creator<<96 | chainid<<16 | slotIndex<<8 | lane`; 4 feeds/slot; no registry.
- Auth: registrationless. Sender writes to `namespaceRemapping[msg.sender]` or its own namespace. Hot keys delegated by `allowPushers(deadline, pushers, sigs)` (EIP-191 consent, monotonic deadline); `allowContractPushers`; `updateBySignature(creator, word, sig)` relayable by anyone.
- Guards: timestamp ≤ block time + drift and strictly newer per slot; a non-newer word is silently skipped (replay protection). `setPriceGuard(feedId,min,max)` consumed by the PriceProvider.
- Events: `FeedUpdated(bytes32 indexed feedId)` per live lane; `PriceRead(reader, feedId)`.
- mm-pusher-ts: plain `sendTransaction({to: oracle, data: concat(['0x00', ...words])})`; timestamp = `min(Date.now(), latestBlock.ts*1000+999)`; default interval 5 s, exp backoff to 30 s; dry-run via `eth_estimateGas`.
- Live push tx `0xa98b1b49…`: 257 B, 8 slots (up to 32 feeds), 101,094 gas, maxPriorityFee 0, every word timestamp = block ts in ms.

## 2. Pool math (VERIFIED: MetricOmmPool.sol, SwapMath.sol, FeeMath.sol, docs/SwapMath.md)
- `PriceProvider.getQuote()` → (bid, ask, ref) Q64.64; ref = oracle mid. Plain provider: `bid = mid*(1 - spread0*confidenceParam)*stepBid`, ask mirrored, E8 quantisation cover. Stale/zero/stall/price-guard breach → `bid=0` → pool reverts. `AnchoredPriceProvider`: `bid=min(refBid,custom)`, `ask=max(refAsk,custom)` against Pyth/Chainlink band.
- Pool checks: `bid<ask`, `bid>0`, `bid<=ref<=ask`, optional asymmetry bound.
- Base fees: buy = `ask/ref - 1`; sell = `ref/bid - 1`.
- Bins = intervals in distance-from-ref space (E6); bounds `ref*(1e6+dist)/1e6`. Per-bin fee = base + per-bin add-fee + notional; effective bounds fee-inclusive (`P/(1+f)` sells, `P*(1+f)` buys).
- Within a bin price is linear in position 0..2^104-1; avg price = mean of endpoints (token1→token0 uses mean of inverses). Exact-out closed form; exact-in solves a quadratic. `_swapAcrossBins` walks bins until filled / price limit / out of bins; partial fill at limit.
- Slot 0: `pauseLevel u8 @0 | curBinIdx i16 @8 | curPosInBin u104 @24 | curBinDistE6 i24 @128 | spreadFeeE6 u24 @152 | notionalFeeE8 u24 @176 | bidAskRefAsymmetryX8 u16 @200`.
- PoolParameters: token0/1, priceProvider, extensions[≤7]+orders+init data, priceProviderTimelock (max = immutable), admin, initial scaled amounts per 1e18 shares, minimalOperationalLiquidity, protocol/admin spread fees (E6) & notional fees (E8), fee destination, curBinDistFromProvidedPriceE6, packed bin arrays (5/word, neg & non-neg), salt, bidAskRefAsymmetryX8.
- Platform take = notional + spread-fee share; rest accrues to LPs inside bins.

## 3. Events (VERIFIED)
`Swap(sender, recipient, PackedSwapDetails, Packed2Int128 amountDeltas, Packed2Uint128 platformFees)` (topic0 0x9734…ac1e), per-bin `BinSwapped(binIdx, binDeltas, fees)`, `LiquidityAdded/Removed`, admin events (fee, pause, provider, asymmetry), `PoolCreated`.

## 4. Extensions (VERIFIED)
- **PriceVelocityGuard** (`beforeSwap`): compares ref with last-observed price, anchor rolls each block; reverts if `(Δ/anchor)² > maxChangePerBlockE18² × (1+blockDiff)`. Admin: `setMaxChangePerBlock`, `setAnchorMidPrice`.
- **OracleValueStopLoss** (`afterSwap`): per-bin value/share marked at bid/ask (`metric0 = t0 + t1/bid`, `metric1 = t0*ask + t1`) vs decaying high-watermark (lazy per-second decay). Init `(drawdownE6, decayPerSecondE18, timelock)`; metric0 breach blocks zeroForOne, metric1 blocks reverse; param changes timelocked. Documented gaps: first trade into a bin unprotected; reminted bin keeps old watermark.

## 5. Live pool measurement
Pool USDC/USDT `0xaef2ad7aBB651945e6D24276715f25BDED0ad41e` — top Ethereum pool: ~$83M / 1,361 swap txs per 24h, ~$2.66M TVL, admin "Carcosa". Provider `0x75b04979…` (unverified; `confidenceParam=5000`, `marginStep=0`). Feed creator `0x8dfdc825…`, slot 10 lane 0; pusher = delegated key `0x629e…`, priority fee 0. Mid 1.00111, spreads 0.06 bps/side.
- Cadence over 299 blocks (26354030–26354329): 99 blocks with an update, ≤1 tx/block; mean gap 3.0 blocks (median 2, min 1, max 16); update tx index mid-block (median 63, range 1–221). VERIFIED.
- Ordering: 53 swap txs — 100% in a block that also had an update, all after it; first 15 sorted were exactly update index + 1. VERIFIED. "Conditional-update builder regime" explanation is INFERRED (updates without swaps on this pool probably triggered by trades on other pools sharing the slot).

## 6. Design takeaways for Suwappu
1. Oracle = raw-sstore packed slot, no registry; 4 lanes/slot, float-packed mid + codebook spreads → ~8k gas/feed, batchable.
2. Pool reads (bid, ask, ref) and prices bins as distance offsets from ref; stale ⇒ revert.
3. Value-based stop-loss + per-block velocity guard as in-pool extensions.
4. Adverse-selection protection is **off-chain builder ordering**, not a contract property — needs Titan/Metric relationship.
5. Hot-key delegation by EIP-191 consent with monotonic deadline is a good key-hygiene pattern (cold key authorises hot pusher).

## Not done
Bytecode-hash comparison vs repo's published runtime hash; live pool bin ladder values; provider `0x75b0…` (unverified) not decompiled. Docs `/files/*` ABI URLs return HTML — real ABIs are in repos (mm-pusher-ts/demo/artifacts, sdk/src).
