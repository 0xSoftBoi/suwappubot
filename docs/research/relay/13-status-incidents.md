# Relay status page and incident history

Source: `https://status.relay.link/api/v2/incidents.json` (Statuspage API), pulled 2026-09-08. Raw JSON: `probe/status-incidents.json`. Status page headline at the time: "We're fully operational", "API 100% uptime" for Jun–Sep 2026, 63 chain components.

The API line shows 100% because incidents are filed against chain components, not the API component. Reading the incident log instead: **25 incidents in 20 days** (2026-08-19 to 2026-09-07), roughly 1.25 per day.

## By impact
| Impact | Count |
|---|---|
| minor | 21 |
| major | 1 (HyperEVM destination regression, 170 min, fills reverting and refunding) |
| critical | 1 (Tron fills disabled, 2026-08-19) |
| none | 2 (Solana delays, liquidity shortage) |

## By subsystem
| Subsystem | Incidents | Notes |
|---|---|---|
| Robinhood Chain | 6 | deposit delays (652 min), USDG unavailable (672 min), RPC errors (372 min), degraded ×2, RPC with BNB (152 min). This is the chain that carries ~30–58% of their flow (see 06-firehose-intel.md). |
| Solana | 5 | fill latency, RPC degradation, fills degraded, transaction delays (14 min) |
| HyperEVM | 4 | quote generation failure, destination reverts → refunds (major), degraded ×2 |
| Cronos | 4 | degraded ×3, one lasting ~73 hours |
| Tron | 2 | fills disabled (critical), destination degraded |
| Flow EVM | 1 | routes pulled for ~4.5 days after "a third-party protocol exploit affecting Flow EVM routes" |
| Sonic | 2 | short degradations |
| TON, Animechain, Bitcoin | 1 each | BTC quotes degraded 82 min |
| Liquidity (global) | 1 | "liquidity shortage causing increase in quote and execution failures", 27 min |

## Durations (from `created_at` to `resolved_at`)
| Incident | Started (UTC) | Duration |
|---|---|---|
| Flow EVM temporarily unavailable (third-party exploit) | 08-31 08:11 | ~107 h |
| Cronos degraded | 08-31 09:15 | ~73 h |
| Degraded USDG availability on Robinhood | 09-04 08:00 | 672 min |
| Robinhood Chain deposit delays | 09-01 12:11 | 652 min |
| Robinhood RPC errors | 09-04 12:59 | 372 min |
| HyperEVM destination regression (major) | 08-19 19:41 | 170 min |
| Robinhood + BNB RPC degradation | 08-31 20:14 | 152 min |
| Bitcoin quote degradation | 08-30 05:44 | 82 min |
| Liquidity degradation | 08-30 18:12 | 27 min |
| Animechain degraded | 09-03 15:48 | 24 min |
| TON degraded | 08-20 04:27 | 18 min |
| Solana transaction delays | 09-02 10:03 | 14 min |
| HyperEVM degraded, Sonic ×2, Cronos ×2, Robinhood degraded | various | 6–12 min each (auto-detected component flaps) |
| Six incidents filed 08-19 15:32 (Solana fills, Tron fills disabled, Solana latency, HyperEVM, Solana RPC, Tron destination) | 08-19 | backfilled; timestamps unusable |

Median incident: 12 minutes. The short ones read as automated component monitors ("X is currently experiencing degraded performance" → "X has recovered"), the long ones as human-run incidents with the standard closing line "Transactions affected during the incident have been completed or refunded."

## What this tells us
1. **Their reliability is bounded by other people's RPCs.** Robinhood Chain, Cronos, Sonic, HyperEVM, Solana: almost every incident is an upstream chain or RPC problem surfacing as failed quotes or delayed fills. A multi-provider router (ours) can route around a degraded provider; a single solver network cannot route around its own degraded chain.
2. **Liquidity is a real failure mode.** "Liquidity shortage causing increase in quote and execution failures" on 08-30 and the `SOLVER_BALANCE_TOO_LOW` error enum in the changelog point at solver capital limits, consistent with one solver filling 97.7% of orders.
3. **Refund is the standard remedy.** Both major incidents ended with refunds. Our executor treats a Relay `refund` status as `REFUNDED`, and the tx poller TODO in `swap_engine.py` should surface that to the user rather than showing a completed swap.
4. **A third-party exploit removed a chain for 4.5 days.** They pull routes fast. We should do the same in `bot/config/chains.py` gating when an upstream is compromised, and we should treat Relay's `/chains` `disabled` and `depositEnabled` flags as authoritative in `RelayAPI.is_supported_route` (already implemented).
5. **Marketing vs. status.** "100% API uptime" is technically true and materially misleading; the customer-facing failure rate lives in the chain components. For our own status page, publish per-provider health honestly; it is a trust differentiator against a competitor whose banner says green while Robinhood deposits stall for 11 hours.
