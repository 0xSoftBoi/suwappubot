# Relay — business, funding, traction, competition (researched 2026-09-07)

Method: WebSearch plus third-party fetches. DefiLlama endpoints were blocked by the sandbox proxy (403/402), so volume claims are Relay's own numbers unless stated. Facts marked LIVE come from our own API probes (`04-live-api-probe.md`, `06-firehose-intel.md`), not from public sources.

## Company and team
- Built by **Reservoir Tools, Inc.** (founded 2021), originally NFT and token trading infrastructure for apps (Coinbase, OpenSea, Magic Eden, MetaMask, Zora). Source: The Block, Feb 2025, https://www.theblock.co/post/338994/token-trading-reservoir-funding
- Founder and CEO: **Peter Watts** (@ptrwtts). A co-founder/COO name appears in one secondary source only: UNVERIFIED.
- Headcount ~25 at Series A (Feb 2025), plan to reach 40 by end of 2025. Mostly US-based.
- Relay "began as a side project to power Zora's cross-chain NFT minting" before becoming the main product line. https://relay.link/blog/introducing-relay-v2

## Funding
| Round | Date | Amount | Lead | Others |
|---|---|---|---|---|
| Pre-seed | 2021 | $2M | Variant | |
| Seed | late 2022 | $10M | Archetype | |
| Series A | Feb 2025 | $14M | Union Square Ventures (Nick Grossman joins board) | Coinbase Ventures, Variant, Archetype, 1kx |
| Series B | 6 Feb 2026 | $17M | Archetype + USV | funds the Relay Chain settlement layer |

Total ≈ $43M. Series A terms included token warrants. Sources: The Block; FinSMEs https://www.finsmes.com/2025/02/reservoir-raises-14m-in-series-a-funding.html; KuCoin News https://www.kucoin.com/news/flash/relay-completes-17m-b-round-funding-launches-relay-chain-for-cross-chain-settlement; Ventureburn https://ventureburn.com/relay-secures-17m-series-b-to-launch-relay-chain/

## Traction
- Self-reported: **$20B+ cumulative volume, 100M+ transactions, 85+ chains, 100+ integrations**, "#1 source of transactions on Base". Median settlement quoted as 2.7 s in one source and 6 s in another. Not independently confirmed; treat as marketing numbers.
- LIVE: `/chains` returns 61 enabled chains today (52 EVM, 9 non-EVM), not 85. The 85 figure likely counts testnets or historical chains.
- LIVE: 3,000 requests in ~2.5 minutes ≈ **1,200 requests/minute ≈ 1.7M/day** at that moment. Notional in the sample was $742K, so roughly **$400M/day** if sustained. That is consistent with a $20B cumulative claim over ~18 months of Relay 2.0.
- LIVE: median ticket $25, p90 $390, p99 $3,000. This is retail flow.
- LIVE: 96.9% success, 2.0% refunded, 0.1% failed; top fail reason `EXECUTION_REVERTED`.
- Do not confuse with the unrelated "RelayChain" BaaS project on DefiLlama (`defillama.com/protocol/relaychain`).
- Relay Chain (Feb 2026): solvers accrue a running Hub balance and batch-settle claims instead of per-order settlement, cutting capital-recovery cost per fill.

## Customers and integrators
- Publicly named: Coinbase, OpenSea, Magic Eden, MetaMask, Zora, Phantom, Axiom, Fun.xyz, fomo.
- LIVE referrer share of requests (3,000 sample): fomo 63.4%, elon123 13.2%, none 7.9%, lifi 2.7%, phantom 2.5%, relay.link app 2.4%, funxyz 1.2%+, BasedBot 1.2%, metamask 1.0%, rainbow 0.8%, okx 0.6%, opensea 0.6%, debot 0.5%, coinbase 0.2%, bitget, rango, Decent, bungee-protocol, defined.fi.
- LIVE by notional: fomo 56%, relay.link app 18%, none 8.5%, elon123 5.4%, lifi 2.6%.
- Read: Relay's front-end is not the product; the wallet and bot integrators are. One Solana-centric app (fomo) is the majority of flow.

## Token, points, vaults
- **No RELAY token** as of Sep 2026. Airdrop-farming sites speculate; the project has not confirmed. https://airdrops.io/relay/ · https://whales.market/blog/how-to-get-relay-airdrop/
- Token warrants exist in investor terms, so a TGE is plausible.
- Relay Vaults (ERC-4626 LP pools funding solver rebalancing) are live on Ethereum and Arbitrum; scale UNVERIFIED.

## Business model and pricing
- Relay charges the user a **relayer fee** (solver service + destination gas) embedded in the quote. LIVE measured: ~0.10% on a $25 swap, ~0.0095% on $50K and $1M stable transfers, about a $0.02 floor. Cross-VM to Solana ~0.15%.
- Integrators add **app fees** in bps on input, accrued in USDC on Base, claimable free on Base. LIVE: 78% of requests carried an app fee; modal integrator fees are 50 bps (32%) and 45 bps (28%), then 10–15 bps (13%), a few at 85–100 bps. Integrators collected $1,554 on $742K in the sample (0.21% blended).
- API keys are free and self-serve; elevated limits on request. No public enterprise price list.
- Fee sponsorship and gasless execution are prepaid from an integrator balance: Relay becomes a payments processor for the app.

## Competitive landscape
| | Relay | Across | LI.FI / Jumper | deBridge | Squid | Bungee (Socket) |
|---|---|---|---|---|---|---|
| Model | Solver-filled intents, hub settlement on Relay Chain | Relayer-fronted intents, canonical settlement | Meta-aggregator of bridges, DEXs, solvers | Solver-filled intents (DLN) | Axelar/IBC routing | Aggregator, modular |
| Fee (measured or published) | ~1 bp at size, $0.02 floor (LIVE) | ~4 bp (our `across_api.py`) | 0.25% service + underlying | ~4–8 bp | pass-through | ~0.3% |
| Speed | 1–6 s (LIVE) | ~1–2 min | route-dependent | seconds | minutes | route-dependent |
| Chains | 61 live incl. Solana, BTC, TON, Tron, XRP, HL | ~15 EVM | dynamic | ~25 incl. Solana | 100+ (BTC/Solana limited) | broad EVM |
| Non-EVM | strongest | none | via partners | Solana | limited | limited |
| Token | none | ACX | none | DBR | none | none |
| App-fee rev share | yes, bps on input | integrator fees | yes | yes | yes | yes |

Sources: eco.com bridge comparison 2026 https://eco.com/support/en/articles/12314682-best-crypto-bridges-2026-compared; itechguides aggregator comparison https://www.itechguides.com/good-cross-chain-bridge-aggregators-li-fi-rango-relay-and-more/; our own probes. deBridge/Mayan/THORChain figures are from memory of their public docs and UNVERIFIED this session.

## Recent news timeline
| Date | Event |
|---|---|
| 2025-02 | $14M Series A (USV) |
| 2025-03 | Tron, Sui support |
| 2025-08 | Rebrand to "Relay"; WebSockets |
| 2025-12 | HyperLiquid direct deposits; SDK on quote v2 |
| 2026-02-06 | $17M Series B; Relay Chain launch |
| 2026-06 | TON support; Sui removed |
| 2026-07-10 | Relay warns users about honeypot tokens on Robinhood Chain (Phemex, https://phemex.com/news/article/relay-protocol-alerts-investors-to-honeypot-scams-on-robinhood-chain-92501) |
| 2026-07-21 | Breaking SDK change: requests v3 behind API-key proxy |
| 2026-11-24 | Public `/requests/v2` retires |

No exploit, outage of note, or regulatory action against Relay found in this pass. Status page shows 100% API uptime for Jun–Sep 2026.

## Risks and weaknesses (Relay's)
- **Solver concentration.** One address filled 97.7% of sampled orders. A solver outage or liquidity crunch (`SOLVER_BALANCE_TOO_LOW` is a real enum) stalls the network.
- **Integrator concentration.** One app is 56–63% of flow. If fomo switches to LI.FI or builds its own, Relay's volume halves.
- **Route concentration.** 58% of routes are Robinhood Chain ↔ Solana, mostly memecoins (BIDEN, zDOG, PACKS, LAPTOP in the token-pair table). Meme cycles end.
- **Reputation adjacency.** Robinhood Chain honeypots already forced a public warning.
- **Privacy.** The public firehose exposes every user's address, amounts, and routes. They are fixing this by putting v3 behind keys, which also removes their own transparency.
- **No token, warrants outstanding.** TGE pressure could distract or misalign incentives.
- **Thin economic moat.** Across is comparably fast and cheap on EVM L2s; LI.FI aggregates Relay itself. Relay's edge is distribution and non-EVM reach, not price.

## Opportunities for Suwappu
1. **Be an integrator, not only a competitor.** Their fee curve is the cheapest we have measured. Racing Relay in our engine (see `05-integration-spec.md`) improves our quotes today and pays us app fees in USDC.
2. **Own the user.** Relay's customers are wallets and bots that own the user relationship. Suwappu is one of those; we sit on top, we do not need to win the settlement layer.
3. **Points before their TGE.** We have seasons/points infra; Relay has none live. Loud, real rewards now capture the retail flow they only see through integrators.
4. **Agent-native first.** No surveyed competitor offers x402-billed, agent-callable cross-chain execution. Relay's MCP repo has 4 stars. Ship and market ours.
5. **TON.** Relay added TON in June 2026 and it barely registers in their flow. A Telegram bot that makes TON ↔ everything effortless has a distribution edge they cannot buy.
6. **Honeypot protection as a feature.** We already do token security checks; Relay only warns. Make the "we block honeypots before you buy" story explicit on Robinhood Chain and Solana memes.
7. **Small-ticket economics.** Median $25 tickets mean floors matter more than bps. Relay's $0.02 floor is the number to beat or match in our fee display.
8. **Capture the firehose while it lasts.** Run `scripts/research/relay_firehose.py` weekly until Nov 2026 for a free market-share dashboard, then stop depending on it.
