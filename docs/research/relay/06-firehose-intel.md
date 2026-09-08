# Relay firehose intel (sampled 40000 most recent requests, 2026-09-08T04:23:18.459Z → 2026-09-08T04:50:24.895Z UTC)

Source: `GET https://api.relay.link/requests/v2` (public, no auth). Raw sample: `probe/firehose-sample.jsonl.gz`. Script: `scripts/research/relay_firehose.py`.

## Headline numbers
| Metric | Value |
|---|---|
| Requests sampled | 40000 |
| Time span | 2026-09-08T04:23:18.459Z → 2026-09-08T04:50:24.895Z |
| Total notional (USD) | $21,188,233 |
| Median / p90 / p99 ticket | $35.56 / $804.19 / $9,033.16 |
| Same-chain swaps | 3364 (8.4%) |
| Median fill (deposit→fill, success only, n=36257) | 1 s (p90 2 s) |
| Integrator app fees collected in sample | $63,369.79 (0.299% of notional) |
| Distinct solvers | 2 |

## Status mix
| Status | Count | Share |
|---|---|---|
| success | 37233 | 93.1% |
| refund | 2706 | 6.8% |
| pending | 40 | 0.1% |
| failure | 21 | 0.1% |

## Failure reasons (non-success, non-pending)
| Reason | Count | Share |
|---|---|---|
| EXECUTION_REVERTED | 1441 | 52.8% |
| SOLVER_CAPACITY_EXCEEDED | 827 | 30.3% |
| SLIPPAGE | 223 | 8.2% |
| TRANSACTION_REVERTED | 184 | 6.7% |
| TRANSFER_FROM_FAILED | 30 | 1.1% |
| TTL_EXPIRED | 6 | 0.2% |
| TRANSFER_AMOUNT_EXCEEDS_BALANCE | 6 | 0.2% |
| ORDER_EXPIRED | 5 | 0.2% |
| SPONSOR_BALANCE_TOO_LOW | 1 | 0.0% |
| SOLVER_BALANCE_TOO_LOW | 1 | 0.0% |
| DOUBLE_SPEND | 1 | 0.0% |
| DEPOSIT_CHAIN_MISMATCH | 1 | 0.0% |
| ORDER_ALREADY_FILLED | 1 | 0.0% |

## Who sends the volume (referrer = integrator id)
By request count:
| Referrer | Count | Share |
|---|---|---|
| fomo | 30939 | 77.3% |
| elon123 | 3995 | 10.0% |
| (none) | 1886 | 4.7% |
| relay.link | 627 | 1.6% |
| phantom | 481 | 1.2% |
| lifi | 480 | 1.2% |
| funxyz|su4gnoxz14 | 225 | 0.6% |
| BasedBot | 219 | 0.5% |
| okx | 174 | 0.4% |
| rainbow | 174 | 0.4% |
| metamask | 171 | 0.4% |
| opensea | 119 | 0.3% |
| coinbase | 72 | 0.2% |
| rango | 72 | 0.2% |
| metamaskpay | 44 | 0.1% |
| debot | 41 | 0.1% |
| funxyz|l2vwlwvifj | 34 | 0.1% |
| bitget | 23 | 0.1% |
| funxyz|y1f4kbskv0 | 22 | 0.1% |
| relay.link/swap | 16 | 0.0% |

By USD notional:
| Referrer | USD | Share |
|---|---|---|
| fomo | $13,747,594 | 64.9% |
| elon123 | $2,348,581 | 11.1% |
| funxyz|su4gnoxz14 | $2,100,020 | 9.9% |
| (none) | $1,297,360 | 6.1% |
| relay.link | $658,851 | 3.1% |
| lifi | $255,299 | 1.2% |
| funxyz|y1f4kbskv0 | $187,738 | 0.9% |
| okx | $141,165 | 0.7% |
| BasedBot | $128,709 | 0.6% |
| phantom | $76,364 | 0.4% |
| metamaskpay | $45,838 | 0.2% |
| metamask | $38,934 | 0.2% |
| debot | $20,918 | 0.1% |
| funxyz|l2vwlwvifj | $19,657 | 0.1% |
| rainbow | $18,803 | 0.1% |
| opensea | $16,543 | 0.1% |
| bridge.synapseprotocol.com | $15,076 | 0.1% |
| rango | $11,517 | 0.1% |
| bacoor.io | $10,414 | 0.0% |
| relay.link/swap | $8,069 | 0.0% |

## App-fee bps integrators charge
| bps | Count | Share |
|---|---|---|
| 50.0 | 14216 | 35.5% |
| 45.0 | 13158 | 32.9% |
| 0 | 4828 | 12.1% |
| 15.0 | 2435 | 6.1% |
| 10.0 | 1610 | 4.0% |
| 85.0 | 455 | 1.1% |
| 5.0 | 369 | 0.9% |
| 100.0 | 123 | 0.3% |
| 25.0 | 98 | 0.2% |
| 30.0 | 86 | 0.2% |
| 52.0 | 41 | 0.1% |
| 51.0 | 32 | 0.1% |

## Origin chains
| Chain | Count | Share |
|---|---|---|
| solana | 22096 | 55.2% |
| bsc | 8028 | 20.1% |
| robinhood | 7241 | 18.1% |
| base | 1238 | 3.1% |
| ethereum | 677 | 1.7% |
| polygon | 232 | 0.6% |
| arbitrum | 127 | 0.3% |
| hyperliquid | 99 | 0.2% |
| hyperevm | 53 | 0.1% |
| monad | 35 | 0.1% |
| tron | 21 | 0.1% |
| ink | 20 | 0.1% |
| avalanche | 15 | 0.0% |
| abstract | 14 | 0.0% |
| optimism | 14 | 0.0% |

## Destination chains
| Chain | Count | Share |
|---|---|---|
| solana | 17377 | 43.4% |
| bsc | 12992 | 32.5% |
| robinhood | 7508 | 18.8% |
| base | 1047 | 2.6% |
| ethereum | 427 | 1.1% |
| polygon | 243 | 0.6% |
| arbitrum | 102 | 0.3% |
| hyperliquid | 96 | 0.2% |
| hyperevm | 45 | 0.1% |
| monad | 30 | 0.1% |
| ink | 23 | 0.1% |
| abstract | 19 | 0.0% |
| bitcoin | 17 | 0.0% |
| tron | 9 | 0.0% |
| lighter | 8 | 0.0% |

## Top routes by count
| Route | Count | Share |
|---|---|---|
| solana → bsc | 12200 | 30.5% |
| bsc → solana | 7540 | 18.9% |
| solana → robinhood | 6423 | 16.1% |
| robinhood → solana | 6234 | 15.6% |
| solana → solana | 2668 | 6.7% |
| base → solana | 593 | 1.5% |
| solana → base | 586 | 1.5% |
| robinhood → bsc | 480 | 1.2% |
| ethereum → robinhood | 299 | 0.7% |
| base → robinhood | 298 | 0.7% |
| bsc → robinhood | 189 | 0.5% |
| robinhood → robinhood | 187 | 0.5% |
| base → base | 179 | 0.4% |
| ethereum → solana | 175 | 0.4% |
| bsc → bsc | 161 | 0.4% |
| robinhood → ethereum | 147 | 0.4% |
| robinhood → base | 139 | 0.3% |
| solana → ethereum | 110 | 0.3% |
| polygon → polygon | 108 | 0.3% |
| hyperliquid → solana | 73 | 0.2% |

## Top routes by USD
| Route | USD | Share |
|---|---|---|
| solana → bsc | $6,003,265 | 28.3% |
| robinhood → solana | $3,467,617 | 16.4% |
| bsc → solana | $3,014,827 | 14.2% |
| solana → solana | $2,387,374 | 11.3% |
| solana → robinhood | $1,398,680 | 6.6% |
| polygon → polygon | $1,074,271 | 5.1% |
| ethereum → polygon | $936,472 | 4.4% |
| robinhood → bsc | $471,332 | 2.2% |
| ethereum → robinhood | $198,700 | 0.9% |
| base → solana | $183,258 | 0.9% |
| robinhood → robinhood | $180,624 | 0.9% |
| robinhood → base | $168,823 | 0.8% |
| solana → base | $165,933 | 0.8% |
| robinhood → ethereum | $133,676 | 0.6% |
| tron → bsc | $103,561 | 0.5% |

## Token pairs
| Pair | Count | Share |
|---|---|---|
| USDC → 4Stock | 9031 | 22.6% |
| 4Stock → USDC | 3486 | 8.7% |
| USDC → 7Stock | 1140 | 2.9% |
| USDC → FATPANDA | 1077 | 2.7% |
| ETH → ETH | 949 | 2.4% |
| FATPANDA → USDC | 869 | 2.2% |
| USDC → USDC | 704 | 1.8% |
| 7Stock → USDC | 586 | 1.5% |
| SOL → 4Stock | 582 | 1.5% |
| ETH → BNB | 457 | 1.1% |
| MEME → USDC | 408 | 1.0% |
| USDC → Basecat | 374 | 0.9% |
| USDC → MEME | 355 | 0.9% |
| USDC → Sue | 333 | 0.8% |
| USDC → BREW | 330 | 0.8% |
| USDC → ZINU | 304 | 0.8% |
| USDC → Stonks | 275 | 0.7% |
| USDG → USDC | 262 | 0.7% |
| 4Stock → SOL | 249 | 0.6% |
| CME → USDC | 233 | 0.6% |

## Solver concentration
| Solver | Count | Share |
|---|---|---|
| 0xf70da97812cb96acdf810712aa562db8dfa3dbef | 39528 | 98.8% |
| None | 472 | 1.2% |

## Analysis of the 40,000-request sample (28 minutes of flow, 04:23–04:50 UTC)

### Throughput
| Metric | Value |
|---|---|
| Requests per minute (median) | 1,405 |
| Notional per minute (median) | ~$763K |
| Extrapolated per day | ~2.06M requests, ~$1.09B notional |
| DefiLlama bridge volume, same day (search snippet) | $79.28M / 24h |

The two numbers do not reconcile. Explanations, in order of likelihood: DefiLlama's bridge adapter counts only EVM depository deposits on the chains it indexes and misses Solana, Robinhood Chain, and same-chain swaps (which are ~76% of this sample); the sample window may sit in a high-activity period; and `/requests/v2` includes requests that refund. Treat $1B/day as Relay's API-level activity and $79M/day as the externally verified cross-chain bridge subset. Both are large.

### Who and what
- **fomo** is 77.3% of requests and 64.9% of notional. Median ticket $34 (non-fomo $41). elon123 is 10%. Everyone else, including Phantom, MetaMask, OKX, Rainbow, OpenSea, Coinbase, Li.Fi and Rango, shares the remaining ~12%.
- **Tokenized stocks on BSC.** The top token pair is USDC → `4Stock` (22.6% of all requests), then `4Stock → USDC`, `7Stock`, and memecoins (`FATPANDA`). `4Stock` is an unverified BSC token (`0xca569db952e5473f18c26e994512786226f6ffff`, also `0xd270…ffff`, plus a `四股 4STOCKS` copy), not an xStocks/Backed instrument. Relay's largest flow today is Solana users buying unverified BSC tokens through fomo.
- Largest single tickets: $250K and $224K USDC ↔ USDC.e via `funxyz`, all successful. Their capacity is fine for six figures on stable routes.
- Routes: Solana → BSC 30.5%, BSC → Solana 18.9%, Solana → Robinhood 16.1%, Robinhood → Solana 15.6%. Base, Ethereum, Arbitrum, Optimism together are under 6%. Relay's EVM L2 origin story is now a Solana ↔ BSC ↔ Robinhood memecoin and stock-token corridor.

### Reliability in this window
- Overall: 93.1% success, **6.8% refund**, 0.1% failure. Against the 3,000-request sample the day before (96.9% / 2.0%), refunds tripled.
- **Solana same-chain swaps were effectively down**: 2,668 requests, 2,641 refunded (99%). Reasons: `EXECUTION_REVERTED` 1,438, `SOLVER_CAPACITY_EXCEEDED` 816, `SLIPPAGE` 185, `TRANSACTION_REVERTED` 163. 2,332 of these came from fomo. The status page shows no incident for it. Cross-chain routes in the same window had 0.0% refunds.
- `SOLVER_CAPACITY_EXCEEDED` (827 total) is almost entirely Solana → Solana with a median ticket of $30 (p90 $757). Capacity here is per-route throughput, not dollar size: the single solver could not keep up with same-chain Solana volume.
- Refund rate by integrator: fomo 7.5%, elon123 6.8%, Li.Fi 5.4%, Phantom 3.5%, relay.link app 1.3%, funxyz 0.4%, BasedBot 0.0%. Integrators pushing meme and same-chain Solana flow eat the failures.

### App fees
- 78% of requests carry an app fee; modal values are 50 bps (35.5%) and 45 bps (32.9%); 10–15 bps is the next cluster (10%). Integrators collected $63.4K in 28 minutes, 0.30% of notional. That is roughly $3.3M/day of integrator revenue riding on Relay at this run rate, of which Relay's own take is the ~1 bp relayer service fee plus the $0.02 floor.

### What this changes in our read of Relay
1. Their volume is real and much larger than DefiLlama shows, but it is one app, one corridor, and one solver.
2. Same-chain Solana on Relay is not reliable at this throughput. We route same-chain Solana through Jupiter directly and should keep it that way; Relay is only raced cross-chain in our engine (`_is_relay_route`).
3. Refund-heavy flow is the integrator's support burden. If we push meme flow through Relay, expect ~7% refunds and design the bot message for it ("refunded to your wallet on the origin chain, minus gas").
4. 45–50 bps is the going app fee for bots on Relay. Our `RELAY_APP_FEE_BPS` can sit there without being an outlier.
