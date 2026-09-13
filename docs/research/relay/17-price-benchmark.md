# Cross-chain price benchmark: Relay vs Across vs Li.Fi vs deBridge (2026-09-13 14:47 UTC)

## Read
- **Relay and Across are within 0.2 bps of each other on liquid stable corridors** ($1K: Across 1.07 vs Relay 1.18 on Base→Arbitrum; $50K: Relay 0.95 vs Across 1.00). Neither has a durable price edge there; the earlier claim in this study that Across sits at ~4 bps came from an outdated docstring in our own `across_api.py` and is wrong today.
- **Small tickets favour Across.** At $25 USDC Across costs 3.8 bps, Relay 10.2 bps (Relay's ~$0.02 floor is 8 bps of $25).
- **Size and ETH favour Relay.** 1 ETH Base→Arbitrum: Relay 1.04 bps vs Across 2.62; $50K USDC to Ethereum: Relay 0.81 vs Across 1.00.
- **Li.Fi's keyless API returns a 25 bps, 18-minute route** (polymer) on every stable corridor and 27 bps (layerswap/across) on ETH. That is Li.Fi's integrator fee plus underlying, and why an aggregator-of-aggregators loses to going direct.
- **deBridge refuses to quote for an unfunded address** ("solvers can't execute this trade because the liquidity at your address…"), so it is absent here; it is also absent from every Relay integrator list.
- Speed: Relay and Across both quote 1–6 s on these routes; Across quoted 20 s on the $50K Ethereum leg.

Implication for the engine: racing Relay and Across on every cross-chain quote (which the engine now does) captures the better of two near-identical prices, and the winner flips with size. Neither should be hard-preferred.

Same route, same size, same second, all public endpoints without API keys. `Cost` = (USD in − USD out) in bps, i.e. everything the user loses to fees, impact, and any origin gas the provider deducts from output; `+gas` adds the provider's own origin-gas estimate when it reports one (Relay, Li.Fi, deBridge). ETH priced from Relay's token-price endpoint at run time. Script: `scripts/research/bridge_price_bench.py`.


## USDC Base→Arbitrum, 25 ($25)

| Provider | Output | Cost (bps) | +gas (bps) | ETA (s) | Note |
|---|---|---|---|---|---|
| Relay | 24.974631 | 10.15 | 11.53 | 1 |  |
| Across | 24.990424 | 3.83 | 3.83 | 1 |  |
| Li.Fi | 24.937500 | 25.00 | 28.48 | 1080 | polymerStandard |
| deBridge | — | — | — | — | 400 deBridge solvers can't execute this trade because the liquidity at your address  |

## USDC Base→Arbitrum, 1000 ($1000)

| Provider | Output | Cost (bps) | +gas (bps) | ETA (s) | Note |
|---|---|---|---|---|---|
| Relay | 999.882004 | 1.18 | 1.23 | 1 |  |
| Across | 999.892924 | 1.07 | 1.07 | 1 |  |
| Li.Fi | 997.500000 | 25.00 | 25.09 | 1080 | polymerStandard |
| deBridge | — | — | — | — | 400 deBridge solvers can't execute this trade because the liquidity at your address  |

## USDC Base→Arbitrum, 50000 ($50000)

| Provider | Output | Cost (bps) | +gas (bps) | ETA (s) | Note |
|---|---|---|---|---|---|
| Relay | 49,995.227008 | 0.95 | 0.96 | 6 |  |
| Across | 49,994.992889 | 1.00 | 1.00 | 1 |  |
| Li.Fi | 49,875.000000 | 25.00 | 25.00 | 1080 | polymerStandard |
| deBridge | — | — | — | — | 400 deBridge solvers can't execute this trade because the liquidity at your address  |

## USDC Base→Ethereum, 1000 ($1000)

| Provider | Output | Cost (bps) | +gas (bps) | ETA (s) | Note |
|---|---|---|---|---|---|
| Relay | 999.863427 | 1.37 | 1.41 | 5 |  |
| Across | 999.884870 | 1.15 | 1.15 | 3 |  |
| Li.Fi | 997.500000 | 25.00 | 25.09 | 1080 | polymerStandard |
| deBridge | — | — | — | — | 400 deBridge solvers can't execute this trade because the liquidity at your address  |

## USDC Base→Ethereum, 50000 ($50000)

| Provider | Output | Cost (bps) | +gas (bps) | ETA (s) | Note |
|---|---|---|---|---|---|
| Relay | 49,995.943419 | 0.81 | 0.81 | 6 |  |
| Across | 49,994.984848 | 1.00 | 1.00 | 20 |  |
| Li.Fi | 49,875.000000 | 25.00 | 25.00 | 1080 | polymerStandard |
| deBridge | — | — | — | — | 400 deBridge solvers can't execute this trade because the liquidity at your address  |

## ETH Base→Arbitrum, 0.01 ($25)

| Provider | Output | Cost (bps) | +gas (bps) | ETA (s) | Note |
|---|---|---|---|---|---|
| Relay | 0.009990 | 9.54 | 10.37 | 1 |  |
| Across | 0.009993 | 7.23 | 7.23 | 1 |  |
| Li.Fi | 0.009973 | 26.51 | 29.48 | 4 | layerswap |
| deBridge | — | — | — | — | 400 deBridge solvers can't execute this trade because the liquidity at your address  |

## ETH Base→Arbitrum, 1.0 ($2492)

| Provider | Output | Cost (bps) | +gas (bps) | ETA (s) | Note |
|---|---|---|---|---|---|
| Relay | 0.999896 | 1.04 | 1.04 | 1 |  |
| Across | 0.999738 | 2.62 | 2.62 | 1 |  |
| Li.Fi | 0.997208 | 27.92 | 27.95 | 1 | across |
| deBridge | — | — | — | — | 400 deBridge solvers can't execute this trade because the liquidity at your address  |

## USDC Arbitrum→Optimism, 1000 ($1000)

| Provider | Output | Cost (bps) | +gas (bps) | ETA (s) | Note |
|---|---|---|---|---|---|
| Relay | 999.879997 | 1.20 | 1.24 | 1 |  |
| Across | 999.899745 | 1.00 | 1.00 | 1 |  |
| Li.Fi | 997.500000 | 25.00 | 25.29 | 1080 | polymerStandard |
| deBridge | — | — | — | — | 400 deBridge solvers can't execute this trade because the liquidity at your address  |

## Cheapest by route and size (by output, before origin gas)

| Route | Size | Winner | Runner-up | Gap (bps) |
|---|---|---|---|---|
| USDC Base→Arbitrum | 25 | Across (3.83) | Relay (10.15) | 6.32 |
| USDC Base→Arbitrum | 1000 | Across (1.07) | Relay (1.18) | 0.11 |
| USDC Base→Arbitrum | 50000 | Relay (0.95) | Across (1.00) | 0.05 |
| USDC Base→Ethereum | 1000 | Across (1.15) | Relay (1.37) | 0.21 |
| USDC Base→Ethereum | 50000 | Relay (0.81) | Across (1.00) | 0.19 |
| ETH Base→Arbitrum | 0.01 | Across (7.23) | Relay (9.54) | 2.31 |
| ETH Base→Arbitrum | 1.0 | Relay (1.04) | Across (2.62) | 1.58 |
| USDC Arbitrum→Optimism | 1000 | Across (1.00) | Relay (1.20) | 0.20 |
