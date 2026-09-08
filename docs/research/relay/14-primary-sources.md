# Relay: primary-source quotes and corrections (2026-09-08)

relay.link returns 403/429 to every non-browser fetch, so quotes below come from third-party or syndicated primary sources. Each quote carries its URL. Items that could not be confirmed are marked UNVERIFIED.

## Funding and company
- The Block, Feb 2025, https://www.theblock.co/post/338994/token-trading-reservoir-funding: Series A $14M led by Union Square Ventures with Coinbase Ventures, Variant, Archetype, 1kx; total raised $26M at that point (pre-seed $2M 2021 Variant; seed $10M late 2022 Archetype); equity with token warrants; Nick Grossman (USV) joins the board; 25 employees, target 40 by end of 2025; clients Coinbase, OpenSea, Magic Eden, MetaMask, Zora.
  - Peter Watts: "We're moving towards a world with millions of tokens issued across thousands of chains. Reservoir's mission is to enable seamless movement between all of these assets, to unlock powerful new use cases across finance and culture."
- Series B, 6 Feb 2026, $17M led by Archetype and USV, to fund Relay Chain: KuCoin https://www.kucoin.com/news/flash/relay-completes-17m-b-round-funding-launches-relay-chain-for-cross-chain-settlement · Bitget https://www.bitget.com/news/detail/12560605185342 · Odaily https://www.odaily.news/en/newsflash/467597 ("infrastructure specifically built for instant cross-chain settlement"). Total raised ≈ $43M. No valuation disclosed anywhere. No Peter Watts quote found in syndicated coverage.
- Team: Peter Watts (co-founder, CEO, @ptrwtts); **Jason Maier, co-founder and COO** (LinkedIn https://www.linkedin.com/in/jason-maier-93081230/); **Julien Genestoux, VP of Engineering** (quoted in the CoinGecko case study). No separately titled CTO found. Hiring via Ashby: https://jobs.ashbyhq.com/relayprotocol, e.g. "Senior Backend Engineer" for "infrastructure for onchain payments... the future of crypto commerce".

## Scale claims
- CoinGecko case study https://www.coingecko.com/learn/relay-case-study: "$20B+" volume, "100M+" transactions, "85+" chains, "#1 source of transactions on Base"; Relay described as a "settlement layer for onchain payments" that "connects consumer applications, liquidity, and transaction execution across blockchain networks."
  - Julien Genestoux: "CoinGecko is how Relay speaks USD. Their coverage and reliability are why we ship cross-chain swaps across 85+ chains and hundreds of assets without worrying about the price layer." (So their USD pricing layer is CoinGecko; ours is `bot/services/price_service.py`.)
- DefiLlama bridge page (search snippet, page itself blocked): **24h volume $79.28M, −11.6% day over day**. Our own firehose extrapolation from 3,000 requests was ~$400M/day at a peak minute; DefiLlama's figure is the better daily number. UNVERIFIED for 7d/30d and rank.
- Dune dashboard lead: https://dune.com/khashayarkei/relaylink (not vetted).

## Relay Chain architecture (material correction)
- Celestia blog, https://blog.celestia.org/relay-chain-a-case-study-in-product-centric-chain-architecture/: Relay Chain is built on **Sovereign SDK (Rust) with Celestia for data availability**, not OP Stack or Arbitrum Orbit. Why: "gas costs eroded profitability, batching to save costs added latency, and solver capital fragmented across dozens of networks." Claims: ~1 ms soft confirmations, P99 under 10 ms, "30,000+ user operations/second", settlement cost "~$0.005/order". "Celestia doesn't interpret or execute Relay Chain's data, it only ensures data is available and ordered." Headroom claim: "with Celestia's Fibre protocol delivering up to 1 Tb/s of blockspace, Relay Chain has headroom to scale orders of magnitude beyond current volumes."
- Read: Relay Chain is a single-operator app chain whose job is solver accounting. It has no general validator set; the trust is in the Oracle signers and the Allocator MPC (see 01-technical.md §2).

## Relay 2.0 and Vaults
- "Relay 2.0 — Introducing A New Era of Multichain Payments", 26 Aug 2025, relay.link/blog/introducing-relay-v2 (mirror https://radar.relay.link/introducing-a-new-era-of-multichain-payments-on-relay/): a rebrand ("sharper identity, refreshed visuals") plus Relay Vaults, "permissionless, ERC4626 compliant, yield-bearing pools designed to provide liquidity that solvers use to facilitate faster, cheaper, and more efficient crosschain transactions", initially on Ethereum mainnet and Arbitrum. Code: https://github.com/relayprotocol/relay-vaults.
- "Relay Weekly Update: Vault Milestones, Role Progression, Community Events" on radar.relay.link indicates a community role/points program around vaults. UNVERIFIED mechanics.
- Blog posts "Is Relay Safe?" and "Best Crypto Bridge in 2026" exist (titles via search); eco.com relays a "99.9%+ fill rate" claim and "no single party holds your funds during execution". Secondhand.

## Token
- No RELAY token, no official airdrop statement from any Relay channel or from Peter Watts. Third-party airdrop guides are speculative. Token warrants in the Series A terms make a future TGE plausible.

## Incidents and complaints
- Search found no substantive user complaint threads under "relay.link stuck / lost funds / refund"; results were dominated by unrelated companies named Relay (Relay Financial, Relay Payments, Relay for Reddit). The official support site https://support.relay.link has "Where are my funds?" and "How do I find my transaction?" articles. Absence of indexed complaints is not evidence of absence; the status page (13-status-incidents.md) shows 25 incidents in 20 days.

## Legal
- Terms and privacy for Reservoir Tools, Inc. / relay.link could not be fetched (403/404/429). Do not cite any "Relay" ToS language found in search; those belong to unrelated companies. UNVERIFIED: jurisdiction, restricted countries, KYC stance. Compliance review needed before we advertise Relay routes to restricted geographies.

## Corrections to the first-pass reports
1. Add Jason Maier (COO) and Julien Genestoux (VP Eng) to the team section of 02-business.md.
2. Relay Chain stack is Sovereign SDK + Celestia DA.
3. DefiLlama shows ~$79M/day, which implies roughly $2.4B/month and is consistent with "$20B+ cumulative" over ~18 months of Relay 2.0 plus the earlier NFT-minting era.
4. Any valuation number is unsourced; none is stated in this study.
