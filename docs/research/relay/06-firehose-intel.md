# Relay firehose intel (sampled 3000 most recent requests, 2026-09-07T17:47:14.497Z → 2026-09-07T17:49:40.011Z UTC)

Source: `GET https://api.relay.link/requests/v2` (public, no auth). Raw sample: `probe/firehose-sample.jsonl`. Script: `scripts/research/relay_firehose.py`.

## Headline numbers
| Metric | Value |
|---|---|
| Requests sampled | 3000 |
| Time span | 2026-09-07T17:47:14.497Z → 2026-09-07T17:49:40.011Z |
| Total notional (USD) | $741,722 |
| Median / p90 / p99 ticket | $25.00 / $389.83 / $2,999.70 |
| Same-chain swaps | 156 (5.2%) |
| Median fill (deposit→fill, success only, n=2740) | 0.0 s (p90 2 s) |
| Integrator app fees collected in sample | $1,553.91 (0.210% of notional) |
| Distinct solvers | 2 |

## Status mix
| Status | Count | Share |
|---|---|---|
| success | 2907 | 96.9% |
| refund | 61 | 2.0% |
| pending | 30 | 1.0% |
| failure | 2 | 0.1% |

## Failure reasons (non-success, non-pending)
| Reason | Count | Share |
|---|---|---|
| EXECUTION_REVERTED | 38 | 60.3% |
| SLIPPAGE | 15 | 23.8% |
| TRANSACTION_REVERTED | 9 | 14.3% |
| TTL_EXPIRED | 1 | 1.6% |

## Who sends the volume (referrer = integrator id)
By request count:
| Referrer | Count | Share |
|---|---|---|
| fomo | 1902 | 63.4% |
| elon123 | 395 | 13.2% |
| (none) | 237 | 7.9% |
| lifi | 80 | 2.7% |
| phantom | 74 | 2.5% |
| relay.link | 73 | 2.4% |
| funxyz|su4gnoxz14 | 36 | 1.2% |
| BasedBot | 35 | 1.2% |
| metamask | 31 | 1.0% |
| rainbow | 25 | 0.8% |
| okx | 18 | 0.6% |
| opensea | 18 | 0.6% |
| debot | 14 | 0.5% |
| metamaskpay | 8 | 0.3% |
| funxyz|l2vwlwvifj | 7 | 0.2% |
| rango | 7 | 0.2% |
| coinbase | 6 | 0.2% |
| bitget | 4 | 0.1% |
| Decent | 4 | 0.1% |
| funxyz|y1f4kbskv0 | 2 | 0.1% |

By USD notional:
| Referrer | USD | Share |
|---|---|---|
| fomo | $418,011 | 56.4% |
| relay.link | $136,697 | 18.4% |
| (none) | $62,944 | 8.5% |
| elon123 | $39,905 | 5.4% |
| lifi | $19,301 | 2.6% |
| funxyz|su4gnoxz14 | $17,261 | 2.3% |
| phantom | $9,624 | 1.3% |
| BasedBot | $7,964 | 1.1% |
| debot | $6,336 | 0.9% |
| okx | $4,398 | 0.6% |
| 7aff2244-c122-4433-8e24-6fea866ecf51 | $3,505 | 0.5% |
| funxyz|3emh86abwj | $3,272 | 0.4% |
| funxyz|y1f4kbskv0 | $3,087 | 0.4% |
| metamask | $2,835 | 0.4% |
| opensea | $2,657 | 0.4% |
| defined.fi | $1,302 | 0.2% |
| funxyz|l2vwlwvifj | $1,036 | 0.1% |
| bungee-protocol | $269 | 0.0% |
| Decent | $218 | 0.0% |
| bitget | $172 | 0.0% |

## App-fee bps integrators charge
| bps | Count | Share |
|---|---|---|
| 50.0 | 961 | 32.0% |
| 45.0 | 839 | 28.0% |
| 0 | 655 | 21.8% |
| 10.0 | 205 | 6.8% |
| 15.0 | 196 | 6.5% |
| 85.0 | 68 | 2.3% |
| 5.0 | 33 | 1.1% |
| 25.0 | 15 | 0.5% |
| 100.0 | 8 | 0.3% |
| 30.0 | 6 | 0.2% |
| 40.0 | 3 | 0.1% |
| 87.0 | 2 | 0.1% |

## Origin chains
| Chain | Count | Share |
|---|---|---|
| solana | 1271 | 42.4% |
| robinhood | 995 | 33.2% |
| bsc | 348 | 11.6% |
| base | 133 | 4.4% |
| ethereum | 131 | 4.4% |
| polygon | 44 | 1.5% |
| arbitrum | 15 | 0.5% |
| hyperliquid | 15 | 0.5% |
| ink | 7 | 0.2% |
| hyperevm | 7 | 0.2% |
| optimism | 6 | 0.2% |
| zora | 5 | 0.2% |
| monad | 4 | 0.1% |
| linea | 3 | 0.1% |
| tron | 3 | 0.1% |

## Destination chains
| Chain | Count | Share |
|---|---|---|
| solana | 1361 | 45.4% |
| robinhood | 1035 | 34.5% |
| bsc | 342 | 11.4% |
| base | 99 | 3.3% |
| ethereum | 66 | 2.2% |
| polygon | 33 | 1.1% |
| hyperliquid | 15 | 0.5% |
| ink | 9 | 0.3% |
| monad | 9 | 0.3% |
| arbitrum | 8 | 0.3% |
| hyperevm | 5 | 0.2% |
| ronin | 4 | 0.1% |
| tron | 4 | 0.1% |
| bitcoin | 3 | 0.1% |
| abstract | 3 | 0.1% |

## Top routes by count
| Route | Count | Share |
|---|---|---|
| robinhood → solana | 891 | 29.7% |
| solana → robinhood | 839 | 28.0% |
| bsc → solana | 293 | 9.8% |
| solana → bsc | 285 | 9.5% |
| ethereum → robinhood | 74 | 2.5% |
| base → solana | 64 | 2.1% |
| solana → solana | 58 | 1.9% |
| solana → base | 53 | 1.8% |
| robinhood → robinhood | 40 | 1.3% |
| base → robinhood | 38 | 1.3% |
| ethereum → solana | 28 | 0.9% |
| robinhood → bsc | 27 | 0.9% |
| bsc → robinhood | 22 | 0.7% |
| polygon → polygon | 19 | 0.6% |
| solana → ethereum | 18 | 0.6% |
| bsc → bsc | 17 | 0.6% |
| robinhood → base | 15 | 0.5% |
| robinhood → ethereum | 14 | 0.5% |
| base → base | 13 | 0.4% |
| hyperliquid → solana | 12 | 0.4% |

## Top routes by USD
| Route | USD | Share |
|---|---|---|
| robinhood → solana | $212,048 | 28.6% |
| solana → robinhood | $123,242 | 16.6% |
| robinhood → ethereum | $67,820 | 9.1% |
| robinhood → base | $58,071 | 7.8% |
| bsc → solana | $58,011 | 7.8% |
| ethereum → solana | $39,441 | 5.3% |
| solana → bsc | $36,612 | 4.9% |
| base → robinhood | $16,041 | 2.2% |
| solana → base | $14,928 | 2.0% |
| ethereum → robinhood | $14,201 | 1.9% |
| polygon → polygon | $9,751 | 1.3% |
| polygon → bitcoin | $8,999 | 1.2% |
| solana → solana | $7,939 | 1.1% |
| base → solana | $7,888 | 1.1% |
| bsc → robinhood | $7,687 | 1.0% |

## Token pairs
| Pair | Count | Share |
|---|---|---|
| ETH → ETH | 164 | 5.5% |
| USDC → BIDEN | 135 | 4.5% |
| PACKS → USDC | 126 | 4.2% |
| USDC → zDOG | 86 | 2.9% |
| USDC → USDC | 77 | 2.6% |
| zDOG → USDC | 67 | 2.2% |
| BIDEN → USDC | 54 | 1.8% |
| ETH → SOL | 54 | 1.8% |
| SOL → ETH | 48 | 1.6% |
| USDC → PACKS | 46 | 1.5% |
| LAPTOP → USDC | 43 | 1.4% |
| USDC → MAXI | 35 | 1.2% |
| PACKS → SOL | 35 | 1.2% |
| USDC → ZEBRIGRADE | 30 | 1.0% |
| USDC → Ponsan | 29 | 1.0% |
| USDC → Theranos | 28 | 0.9% |
| ZARDIGRADE → USDC | 25 | 0.8% |
| USDC → 旺柴 | 23 | 0.8% |
| USDG → USDC | 23 | 0.8% |
| USDC → ETH | 23 | 0.8% |

## Solver concentration
| Solver | Count | Share |
|---|---|---|
| 0xf70da97812cb96acdf810712aa562db8dfa3dbef | 2931 | 97.7% |
| None | 69 | 2.3% |
