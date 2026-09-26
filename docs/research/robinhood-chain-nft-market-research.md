# Robinhood Chain NFT Market Research (2026-08-26)

Companion to `robinhood-chain-nft-ground-data.md` (on-chain holder data). This doc covers
prices, volumes, mint mechanics, and sell-through — web-sourced, cited.

Chain context: Robinhood Chain mainnet launched July 1, 2026 (Arbitrum Orbit, chain 4663).
~$979K 24h NFT volume as of Aug 11; 7 projects past 1,500 ETH cumulative volume.

## Verified collection economics

| Collection | Supply | Mint price | Floor (Aug) | Volume | Sell-out | Mechanic |
|---|---|---|---|---|---|---|
| StonkBrokers | 4,444 | Free (burn-to-qualify) | ~11.98 ETH (~$22.5K) | $4.7M+ | Sold out | ERC-6551 token-bound wallets holding real tokenized equities; activate via $STONKBROKER for ~70% of Anvil AMM fees. Floor pegged to token backing. |
| Spritehood | 44,444 | $17 std / $117 premium | ~0.0125 ETH | $1.28M mint rev | **53 min** | Two-tier: premium = 12.4% of units, **50.4% of revenue**. Generative RPG art, class binding, burn-to-upgrade. Pudgy co-founder. |
| Cash Cats | 10,000 | sub-cent | 0.0139–0.26 ETH (disputed) | 82.6+ ETH | — | Generative cat PFP, trait builder |
| Robinhood Punks | 2,000 | Free ($PUNKS holders) | 0.0037 ETH | 103.1 ETH | — | Pixel PFP, **2% royalty** (only confirmed royalty datum) |
| Gremlin Cartel | 5,000 | 0.001 ETH | 0.018 ETH (**18x mint**) | 277.6 ETH | — | Pixel PFP + token-bound accounts + poker-club revenue share |
| Gogh Punks | 10,000 | 0.003 ETH, 20/wallet | — | opened Aug 14 | — | Fully on-chain pixel portraits |
| Chain Mancers | 5,000 | 75% free (burn), 25% AMM-reserved | 0.9 ETH | — | — | Burn-to-mint + AMM liquidity reserve |

Sources: KuCoin (Spritehood 53-min/$1.28M; 7-projects-1,500-ETH), Odaily "NFT Summer Returns",
CryptoTicker (StonkBrokers ERC-6551), CryptoBriefing (Spritehood 44,444), stonkbrokers.io,
nftcalendar (Gogh Punks), opensea.io/blog (native Robinhood Chain support).

## Patterns that correlated with success

1. **Two-tier pricing is the revenue pattern.** Spritehood: cheap broad tier + premium tier
   capped at ~12% of supply → 50% of revenue → $1.28M and 53-minute sellout.
2. **Real utility inside the token = durable floor.** StonkBrokers (token-bound value +
   fee share): highest floor on chain (~$22.5K). Gremlin Cartel (revenue share): 18x floor.
3. **Free/burn-gated mints = distribution, not price.** Reliable sellouts, weak floors —
   matches the 0.79–0.94 holder/supply ratios in the on-chain doc.
4. **Supply for floor durability: 4,000–6,000** (StonkBrokers 4,444, Gremlin/Mancers 5,000).
   7.7k–10k builds breadth; 40k+ needs Spritehood-grade distribution machinery.
5. **Art meta:** pixel-art finance-meme PFP is table stakes; the biggest revenue event
   (Spritehood) won with *higher-production generative art + progression mechanics*.
6. **Royalty: 2%** is the only verified figure; assume 2–5% standard.

## Marketplaces / explorers

- Explorer: `robinhoodchain.blockscout.com` (official, Blockscout). **Avoid** lookalikes
  hoodscan.pro / hoodscan.app / hood-chain.com / robinscan.io — unverified, phishing pattern.
- Marketplace: OpenSea native support (`opensea.io/collections/chain/robinhood`).
  Anvil (NFT AMM) and OpenWave exist but depth unverified.

## Trading-bot founder-edition comps: dead end

Banana Gun used soulbound whitelist NFTs (not a priced sale); Maestro/BONKbot/Photon/
Trojan/BullX have no verifiable founder collections ("Maestro Genesis" is an unrelated
music brand — false match). **Design against the Robinhood Chain data above, not bot comps.**

## Caveats

- StonkBrokers "90%+ of chain NFT volume" claim is single-source (X) — directional only.
- Cash Cats floor figures conflict across sources.
- Any fee-share/revenue-share utility is MONEY-PATH: needs money-path-reviewer before deploy.
