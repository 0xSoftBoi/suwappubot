# Relay (relay.link) competitive study — executive summary

Date: 2026-09-07. Everything here was either measured live against `api.relay.link` from this repo, read from docs.relay.link, or found in public third-party sources. Marketing numbers are labelled as Relay's own. Detail lives in the numbered files in this folder.

## What Relay is
A solver-filled, intent-based cross-chain execution layer built by Reservoir (Series B, $17M, Feb 2026, Archetype + USV, ~$43M total). An app posts a quote; the user deposits into a Relay depository contract on the origin chain; a solver pays out on the destination chain within seconds; Relay's own settlement chain reimburses the solver after an oracle attests the fill. It sells to wallets, marketplaces, and trading bots, not to end users. Public claims: $20B+ volume, 100M+ transactions, 85+ chains, "#1 transaction source on Base".

## What we measured
| Fact | Value | Source |
|---|---|---|
| Live chains | 61 (52 EVM + Solana, Bitcoin, TON, Tron, XRP, HyperLiquid, Lighter, Eclipse) | `GET /chains` |
| Fee, stable-to-stable, $50K–$1M | 0.0095% (about 1 bp) | live quotes |
| Fee, $25 ETH bridge | 0.10% (about $0.02 floor) | live quotes |
| Fill time | 1–6 s quoted; median 0 s deposit-to-fill, p90 2 s observed | live quotes, firehose |
| Throughput at sample time | ~1,200 requests/min, ~$300K notional/min | `GET /requests/v2` |
| Median ticket | $25 (p90 $390, p99 $3,000) | firehose |
| Success rate | 96.9% success, 2.0% refund, 0.1% fail | firehose |
| Solvers | 2 addresses; one fills 97.7% | firehose |
| Integrator concentration | "fomo" 63% of requests, 56% of notional | firehose |
| Route concentration | Robinhood Chain ↔ Solana 58% of requests | firehose |
| Integrator app fees | 78% of requests carry one; modal 45–50 bps | firehose |
| API auth | none needed for quotes; `referrer` needs a key; keyless `/quote` 50 rpm | probes, docs |

## Where they beat us
1. Price. About 1 bp at size against Across's ~4 bp, our current cheapest bridge.
2. Reach. Every chain we support plus Solana, Bitcoin, TON, Tron, XRP, HyperLiquid.
3. Integrator levers we lack: gasless execution, fee sponsorship, deposit addresses, cross-chain calls, builder codes, webhooks with HMAC signing.
4. Distribution. Embedded in Phantom, MetaMask, OpenSea, Rainbow, OKX, Bitget, Li.Fi, Bungee, Rango.

## Where they are exposed
1. Single-solver dependency. Their "network" is one address today.
2. Single-integrator dependency. One Solana app is most of their flow, and it is memecoin flow on Robinhood Chain.
3. No direct user relationship, tiny community (Discord ~1K), no token or points.
4. Agent story is a 4-star undocumented MCP repo; no x402.
5. Public firehose leaks every user's routes until they close it on 24 Nov 2026.

## What we did about it (this branch)
- **Built Relay into the swap engine** as provider `relay` (`bot/services/relay_api.py`, wired in `swap_engine.py` and `router.py`, settings `RELAY_API_KEY`, `RELAY_APP_FEE_RECIPIENT`, `RELAY_APP_FEE_BPS`, `RELAY_ENABLED`). It races Across, Li.Fi, Socket and the rest on every cross-chain quote, executes approve→deposit on EVM origins, and can attach our own app fee in USDC. Guards: re-quote may not deliver below the accepted minimum; steps must target the origin chain; keyless rate limit respected. 33 tests pass; live quotes verified through our client. Execution is code-complete, not yet exercised with a funded wallet.
- **Captured their market** in `scripts/research/relay_firehose.py` (route mix, integrator share, fee bps distribution, solver concentration). Run weekly until the endpoint retires in November.
- **Screenshotted** docs and status pages (marketing site is behind a Vercel bot challenge).

## Recommended moves (ordered)
1. Ship the Relay provider behind `RELAY_ENABLED` and set `RELAY_APP_FEE_BPS` to 25–50, in line with what their integrators charge; the fee accrues in USDC on Base and is claimable free.
2. Make TON ↔ everything a headline route. Relay added TON in June and it is invisible in their flow; we live inside Telegram.
3. Market "agent-native cross-chain" now: our agent routes, A2A, x402 billing. Relay has none of it in market.
4. Show guaranteed output, fee, and ETA in the `/s` flow, the three numbers their UX is praised for.
5. Turn honeypot blocking into an explicit promise on Robinhood Chain and Solana memes; Relay only warns.
6. Scope gasless execution and deposit-address funding for new users who land with zero gas.
7. Publish a comparison page on the showcase site the way Relay publishes "best crypto bridge 2026".

## Files
| File | What |
|---|---|
| `01-technical.md` | Lifecycle, settlement protocol, solvers, vaults, gasless, sponsorship, deposit addresses, HL, Solana, webhooks, SDK, contracts, builder codes, API surface, gaps |
| `02-business.md` | Company, funding, traction, customers, token, model, competitor table, news, risks, opportunities |
| `03-marketing-sales.md` | Positioning, ICPs, developer GTM, sales motion, content, brand, community, lessons |
| `04-live-api-probe.md` | Hands-on API findings, auth gating, fee curve, response shapes |
| `05-integration-spec.md` | The build spec we implemented |
| `06-firehose-intel.md` | 3,000-request market sample with tables |
| `07-changelog-timeline.md` | 18 months of their shipping cadence |
| `probe/` | Raw JSON fixtures used by tests |
| `screenshots/` | Docs and status captures with extracted text |
