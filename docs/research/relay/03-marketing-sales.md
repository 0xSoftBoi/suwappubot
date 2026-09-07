# Relay — marketing, sales, GTM (researched 2026-09-07)

Method: WebSearch plus third-party fetches. relay.link itself returns HTTP 429 to headless fetchers, so homepage copy comes from search snippets, syndications, and their docs site. Items marked UNVERIFIED could not be confirmed from a primary source.

## One-line read
Relay runs a **B2B, white-label infrastructure GTM**, not a consumer brand play. It wins by embedding invisibly inside OpenSea, Phantom, MetaMask, Axiom and "100+ integrations", backed by real scale (100M+ transactions, $20B+ volume, 85+ chains, self-reported #1 transaction source on Base) and a $17M Series B (Archetype + USV, Feb 2026) that funded its own settlement chain, Relay Chain.

## Positioning and taglines (verbatim where found)
- "Instant, low-cost bridging and swapping" — bridge product tagline (solanacompass.com/projects/relay)
- "Crosschain Payments Infrastructure | Bridge 85+ Chains" — relay.link homepage title
- "Make transacting across chains as fast, cheap, and simple as online payments" — Relay 2.0 mission (relay.link/blog/introducing-relay-v2)
- "Onchain Money, Connected" — relay.link/blog masthead
- "Settlement layer for onchain payments, helping users spend any asset to transact on any chain instantly" — CoinGecko case study (coingecko.com/learn/relay-case-study)
- "The fastest and cheapest way to bridge & transact across chains" — docs.relay.link home

The category move: from "bridge" to "payments infrastructure / settlement layer". That lets them escape the commodity bridge-aggregator comparison and pitch a different budget line.

## Target segments and ICPs
| Segment | Named examples | What Relay sells them |
|---|---|---|
| Wallets | Phantom, MetaMask (also Rainbow, OKX, Bitget per live referrers) | "Collapses complex swaps into seamless flows"; any-asset-in, any-chain-out |
| NFT marketplaces | OpenSea | Cross-chain mints and purchases |
| Trading apps / bots | Axiom, Fun.xyz, fomo, BasedBot, debot (live referrers) | Cross-VM (Solana ↔ EVM) execution with integrator app fees |
| Aggregators | Li.Fi, Bungee, Rango (live referrers) | Wholesale route supply |
| Developers generally | anyone | API + SDK + UI kit, self-serve dashboard |

No explicit "for AI agents" segment in marketing copy. UNVERIFIED: enterprise pricing tiers or sales collateral; nothing public.

## Developer GTM
- SDK `@reservoir0x/relay-sdk` and `@relayprotocol/relay-kit-ui` on npm. npm pages returned 403 to our fetcher, so weekly downloads are UNVERIFIED.
- GitHub org github.com/relayprotocol: relay-kit (67 stars), relay-depository (8), relay-periphery (6), relay-mcp (4, no description), relay-docs (3), relay-protocol-oracle (1), relay-settlement, relay-vaults (ERC-4626 yield vaults). Active multi-repo protocol engineering, low star counts: developers integrate via docs, not via GitHub community.
- Docs framing: quickstart "under 5 minutes", three endpoints (Quote / Execute / Status). Self-serve API keys at dashboard.relay.link with request analytics, saved views, per-key webhooks.
- No hackathon or grants program surfaced in search.

## Sales motion
- API-first self-serve plus engineering-led BD. CoinGecko's case study describes distribution "through major wallets and platforms rather than direct consumer acquisition".
- No "Contact sales" enterprise funnel surfaced. Case studies are third-party authored (CoinGecko, Celestia's "Relay Chain: A Case Study in Product-Centric Chain Architecture") and function as proof-of-scale content, not logo walls.
- Monetization is integrator-side: app fees in bps, fee sponsorship, builder codes. The integrator is the customer; the end user is the integrator's.

## Content themes (dated)
| Date | Piece | Theme |
|---|---|---|
| 2026-02-06 | "Relay Raises Series B and Launches the Relay Chain" ($17M, Archetype + USV) | Funding + own chain |
| 2025/26 | "Relay 2.0 — Introducing A New Era of Multichain Payments" | Reposition to payments |
| 2026 | "Best Crypto Bridge in 2026: Top Alternatives Compared" | Comparison SEO against rivals |
| 2026 | Celestia blog case study on Relay Chain | Third-party technical credibility |
| 2026 | CoinGecko "How Relay Powers $20B+ in Crosschain Swaps across 85+ Networks" | Scale proof |

## Brand and design language
- Independent review (cryptorabbithole.substack.com, "Marketing Review 101: Relay Protocol") praises a one-button UX: pick token, pick chain, see fee and ETA, hit one button, with guaranteed-rate quotes instead of slippage-prone estimates.
- Relay 2.0 shipped a "sharper identity" refresh alongside the payments repositioning. UNVERIFIED details: homepage blocked (429); see `screenshots/` for the docs site look (dark, monospace-accented, Mintlify).

## Social and community
- X @RelayProtocol: ~63.7K followers.
- Discord: ~1,020 members. Tiny relative to volume, by design: the brand is invisible to end users.

## Logos and social proof
- OpenSea, Phantom, MetaMask, Axiom, Fun.xyz, fomo cited as live integrations; "100+ active integrations".
- "#1 source of transactions on Base" is self-reported. DefiLlama ranks RelayChain around #110 by bridge TVL, which measures a different thing (locked value vs. transaction count). Do not conflate the two when citing them.

## AI-agent angle
- `relay-mcp` exists in the official org (4 stars, undocumented). Not in any marketing copy. No x402 integration found.
- A community server, `warengonzaga/relay-protocol-mcp-server`, wraps their REST API for agents. Demand exists where Relay hasn't marketed.

## What works
- Category reposition (bridge → payments infrastructure).
- White-label distribution through top wallets: huge usage at near-zero CAC.
- Guaranteed-output UX is a real, reviewed differentiator.

## What's weak
- Thin owned community and no direct user relationship; the integrator owns the user.
- Agent story is nascent and unmarketed.
- Concentration: 63% of live requests from one integrator ("fomo") and ~58% of routes on Robinhood Chain ↔ Solana (see 06-firehose-intel.md). One partner churning would dent them.

## Lessons for Suwappu
1. Relay's win is invisibility-as-infrastructure. Suwappu's bet is the opposite: a visible, Telegram-native brand that owns the user. Lean into that rather than imitate the white-label model.
2. Copy the UX principle, not the brand: show guaranteed output, fee, and ETA before signing in the `/s` flow. Relay's quote gives `minimumAmount`, `timeEstimate`, and a fee breakdown; surface the same three numbers.
3. Ship a comparison page on the showcase site ("best Telegram trading bot 2026") the way Relay ships "best crypto bridge". It is cheap SEO and frames the category.
4. Claim "agent-native cross-chain" first and loudly. Relay's MCP repo has 4 stars and zero docs; our agent routes and A2A protocol are further along. Market them now.
5. BD beats paid acquisition at this stage: the referrer list (wallets, aggregators, bots) is exactly the partner list that a Suwappu SDK should target.
6. Publish a volume number once it is material; "$X settled" is Relay's primary social proof.
7. Do not chase Discord size; Telegram-native metrics (active bot users, group installs) are the honest comparable.
8. Watch github.com/relayprotocol/relay-mcp. If it ships with docs, the differentiation window on agents narrows.

## Follow-ups not done
- npm download counts (403 from this environment).
- Homepage screenshots (Vercel challenge). Wayback has no relay.link snapshot as of 2026-09; docs.relay.link snapshot exists (2026-07-25).
- Read relay-mcp source for actual tool capabilities.
