# Relay firehose intel, second sample (20,000 requests, 2026-09-13T14:23:16.925Z → 2026-09-13T14:46:07.746Z UTC)

Five days after the first sample (06-firehose-intel.md). Same method, same script. Raw: `probe/firehose-sample-2026-09-13.jsonl.gz`. One row carried a mispriced `amountUsd` of ~$79T and is zeroed.

## Headline numbers, day 2 vs day 1
| Metric | 2026-09-08 (40K) | 2026-09-13 (20K) |
|---|---|---|
| Requests per minute (median) | 1,405 | 849 |
| Notional per minute (median) | ~$763K | ~$222,073 |
| Extrapolated per day | ~2.06M req, ~$1.09B | ~1,222,560 req, ~$320M |
| Median / p90 / p99 ticket | $35.56 / $804 / $9,033 | $27.72 / $402 / $3,004 |
| Success / refund | 93.1% / 6.8% | 97.8% / 2.0% |
| Solana same-chain requests, refunded | 2,668, 99% | 361, 86% |
| fomo share of requests | 77.3% | 63.8% |
| Same-chain share | 8.4% | 5.4% |
| App fees collected in window | $63,370 (28 min) | $13,850 (24 min) |

## Status mix
| Status | Count | Share |
|---|---|---|
| success | 19553 | 97.8% |
| refund | 399 | 2.0% |
| pending | 25 | 0.1% |
| failure | 23 | 0.1% |

## Failure reasons
| Reason | Count | Share |
|---|---|---|
| ORDER_EXPIRED | 198 | 46.9% |
| SLIPPAGE | 107 | 25.4% |
| TRANSACTION_REVERTED | 49 | 11.6% |
| EXECUTION_REVERTED | 25 | 5.9% |
| ORDER_ALREADY_FILLED | 19 | 4.5% |
| SWAP_USES_TOO_MUCH_GAS | 14 | 3.3% |
| TTL_EXPIRED | 4 | 0.9% |
| DOUBLE_SPEND | 2 | 0.5% |
| DEPOSITED_AMOUNT_TOO_LOW_TO_FILL | 2 | 0.5% |
| UNKNOWN | 2 | 0.5% |

## Referrers
| Referrer | Count | Share |
|---|---|---|
| fomo | 12756 | 63.8% |
| elon123 | 2234 | 11.2% |
| (none) | 1553 | 7.8% |
| phantom | 676 | 3.4% |
| relay.link | 523 | 2.6% |
| lifi | 396 | 2.0% |
| funxyz|su4gnoxz14 | 367 | 1.8% |
| okx | 225 | 1.1% |
| BasedBot | 190 | 0.9% |
| metamask | 184 | 0.9% |
| opensea | 165 | 0.8% |
| rainbow | 142 | 0.7% |
| rango | 108 | 0.5% |
| metamaskpay | 52 | 0.3% |
| debot | 49 | 0.2% |

## Routes
| Route | Count | Share |
|---|---|---|
| solana → robinhood | 7496 | 37.5% |
| robinhood → solana | 6068 | 30.3% |
| bsc → solana | 801 | 4.0% |
| solana → bsc | 564 | 2.8% |
| solana → base | 532 | 2.7% |
| base → solana | 498 | 2.5% |
| solana → solana | 361 | 1.8% |
| base → robinhood | 327 | 1.6% |
| ethereum → robinhood | 309 | 1.5% |
| robinhood → robinhood | 219 | 1.1% |
| bsc → robinhood | 217 | 1.1% |
| ethereum → solana | 186 | 0.9% |
| base → base | 173 | 0.9% |
| polygon → polygon | 164 | 0.8% |
| solana → ethereum | 137 | 0.7% |

## Token pairs
| Pair | Count | Share |
|---|---|---|
| USDC → YOINK | 1050 | 5.2% |
| ETH → ETH | 999 | 5.0% |
| USDC → CHINAPAD | 979 | 4.9% |
| YOINK → USDC | 761 | 3.8% |
| CHINAPAD → USDC | 588 | 2.9% |
| USDC → USDC | 506 | 2.5% |
| USDC → AXI | 311 | 1.6% |
| ETH → SOL | 275 | 1.4% |
| YOINK → SOL | 267 | 1.3% |
| SOL → ETH | 262 | 1.3% |
| SOL → YOINK | 241 | 1.2% |
| USDG → USDC | 235 | 1.2% |
| YUGE → USDC | 234 | 1.2% |
| USDC → YUGE | 217 | 1.1% |
| AXI → USDC | 204 | 1.0% |

## App-fee bps
| bps | Count | Share |
|---|---|---|
| 50.0 | 4271 | 21.4% |
| 0 | 4202 | 21.0% |
| 45.0 | 3979 | 19.9% |
| 10.0 | 1220 | 6.1% |
| 15.0 | 1073 | 5.4% |
| 85.0 | 634 | 3.2% |
| 100.0 | 189 | 0.9% |
| 5.0 | 187 | 0.9% |

## What changed in five days
1. **The corridor rotated.** On 09-08 the top routes were Solana ↔ BSC (49%) on `4Stock`; on 09-13 they are Solana ↔ Robinhood Chain (68%) on `YOINK` and `CHINAPAD`. Same integrator, new memecoin of the week. Relay's volume follows whatever fomo's users are trading.
2. **Reliability recovered.** Refunds fell from 6.8% to 2.0% and the failure mix moved from `EXECUTION_REVERTED` / `SOLVER_CAPACITY_EXCEEDED` to `ORDER_EXPIRED` and `SLIPPAGE`: capacity is no longer the bottleneck, price movement on memecoins is.
3. **Same-chain Solana is still bad**: 86% of same-chain Solana requests refunded. Our engine keeps same-chain Solana on Jupiter.
4. **Throughput is stable** at ~1,400 requests/min; notional per minute fell with ticket size (median $28 vs $36), so the ~$1B/day figure from 09-08 looks like a high-water mark and ~$320M/day is a calmer read. DefiLlama's ~$79M/day counts only the bridge subset.
5. **fomo is still 64%.** Nothing about the concentration risk changed.
