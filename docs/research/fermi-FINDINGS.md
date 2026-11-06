# FermiSwap engine — reverse-engineering findings (Ethereum mainnet)

Date 2026-11-06. Engine `0x90f73feA1Ee2dC514D4dbac0bFf7fF04B933767f` (unverified). Wrapper `FermiSwapper` 0xb1076fe3…452e, vault 0x585d44727129B9C69791B10238Ca605932938B4F. Raw artifacts (bytecode, disasm, selectors, traces, prestate dumps, cadence reports) are untracked in `docs/research/fermi-engine/` (delete `pylib/` there; do not commit).
Tags: VERIFIED = selector/trace/on-chain data; INFERRED = labels or fits. Decompilers failed (panoramix = stub, heimdall wouldn't build), so formulas are **empirical**, not read from code.

## Headline
**The engine holds no price.** Price comes from an external push-oracle registry `prioRegistry` `0xDa7AfeeD01fe625CF15d187a19f94B45f00b8C5F`. A whitelisted updater EOA must push the price **in the same block, immediately before the swap**. `maxParameterAge()==0` and `ts=block.timestamp`, so a quote at chain head with no same-block update reverts (`0x666a2814`).

## 1. Functions (selectors VERIFIED; names inferred)
- `c9e270d0(tokenIn,tokenOut,amountIn,caller)` view quote → `(amountIn, amountOut)`. `d6b0bdd5` same args = swap; requires `CALLER == swapper` (slot 3; revert "NS").
- Owner-only (immutable owner EOA `0xFF67d721…c47f`, no ownership transfer, not a proxy): `18afc274` pair-config update (66 calls seen), `294a8f17` add pair, `d6c3c9df` set pair active, `6d106317(token,uint)` per-token vault inventory cap, `451a5e65` addUpdater (forwards to registry), `4b630121` set maxParameterAge, `setSwapper/setVaultAddress/setTraderVault/unregisterPair`, `executeGeneral(Multi)`, `transferToken/Eth`, `withdrawAll*`.
- Views: `getPairs, isActive, unlocked, swapper, traderVault, prioRegistry, maxParameterAge`.

## 2. Swap flow (VERIFIED, tx 0x7dc3f085…19a0, block 25880907)
Titan ACE router → wrapper → engine. Engine calls `registry.getState(keccak(abi.encode(tokenA,tokenB)), ts-maxAge, ts)` → `(ts, uint256[] values)`, `values[0]` = price at 1e8. Engine then reads `balanceOf(vault)` for both tokens (inventory skew input). Wrapper pulls tokenOut straight from vault and forwards tokenIn to it. No Chainlink/AMM read.

## 3. Pricing model (empirical, black-box via eth_call with mocked registry + overridden vault balances)
- Edge vs oracle: ~0.5–0.9 bps tiny; ~1.2 bps @10 WETH; ~2.7 bps @100 WETH ($250k); ~5 bps @200 WETH ($500k). Convex, piecewise-linear in size.
- Inventory skew asymmetric: with s = normalized (vault WETH − USDT value), edge +~1.0 bps per unit when s>0, −~0.2 bps per unit when s<0; tiny trade ~0.70 bps both ways at s=0.
- Per-pair config (decoded from `18afc274` calldata): head `[0.2e18, 5000, 3e12, 3e12]`; 8 size tiers `{x0,x1,0,0,y0,y1}` breakpoints ≈ $5k/50k/100k/300k/500k/1M/2M/3M notional (ref $3M), y 0.1→15 (bps in WAD); 4 skew tiers over x∈[−1,1]. Field meanings INFERRED.
- Limits: per-token vault cap (WETH 1800), payout ≤ vault balance (view clamps rather than reverts), max trade ~$3M, per-pair `isActive`. Reverts: `ZP` no price, `IL` inventory cap/insufficient vault, `NS/NM` access.
- Slot `0xcc22…0b06` packs `(amountIn, blockNumber)` — per-block volume accumulator (role INFERRED, reader unconfirmed).

## 4. Updaters and cadence (VERIFIED)
- Update = `registry.updateState(owner=engine, feedId, ts=block.timestamp, [price])`, selector `a9114b0f`, ~31k gas.
- 8 updater EOAs registered 2026-07-21 (blocks 25581571–579): 0x69939a6c… (WETH/USDT), 0xa048e0c0… (WETH/USDC), 0xfcb4150a… (USDC/USDT), + 5 BTC feeds.
- 35 swaps / 34 blocks (25878658–25880907): 35/35 had a same-block engine-feed update earlier; 31/35 exactly at swap index −1. All updates and swaps 0-wei priority fee ⇒ ordering is builder bundle placement (Titan 17, Quasar 10, BuilderNet 8). Swap block positions 3–259.
- Updates are on-demand, not heartbeat (7 of 29 blocks in one window). Config retunes 2026-07-21→08-23, median 24 s apart in bursts.

## 5. Admin/risk and status
- Profit = spread retained in inventory; no explicit fee transfer in the Fermi leg.
- One immutable owner EOA with `executeGeneral` + sweeps, no timelock. Compromised updater could push any price; no sanity bound observed in trace (INFERRED not read from code).
- **Activity stopped:** last swap block 25880907 (~2026-09-01), last config 25818378 (2026-08-23). Vault still ~879 WETH, 1.81M USDC, 1.39M USDT, 1.89 cbBTC (~$5M).

## Not done
Exact `d6b0bdd5` arithmetic; meaning of config fields f0/f1 and tier zero-words; vault code/ACL; cadence after 2026-09-01.
