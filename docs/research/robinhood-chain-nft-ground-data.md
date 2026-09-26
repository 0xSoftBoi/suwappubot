# Robinhood Chain NFT Ground Data (on-chain, 2026-08-26)

Source: Blockscout API, chain_id 4663 (Robinhood Chain, Arbitrum Orbit L2, native ETH).
Endpoint: `/api/v2/tokens?type=ERC-721,ERC-1155`, ranked by holder count. Top 50 captured.

## Top collections by holders (excluding infra NFTs)

Infra/positions excluded: Uniswap V3/V4 Positions (47.1k / 23.6k holders), Fee Beneficiary (16.6k).

| Collection | Supply | Holders | Holder/Supply | Contract |
|---|---|---|---|---|
| Howl Street (HOWL) | 100,000 | 30,304 | 0.30 | 0x4A2C6e28…1f1a |
| Robinhood Gift (GIFT) | 16,585 | 16,582 | 1.00 | 0xEdAe666f…bf76 |
| /dev/daemons (DAEMON) | — | 12,713 | — | 0x6Ca58412…78A9 |
| Robinhood Gift #2 | 12,602 | 12,601 | 1.00 | 0xB91691e6…831a |
| 'Much Good for Poor Dogs' by Hood Inu | 10,529 | 9,341 | 0.89 | 0xAFE255DB…0711 |
| 4K Punks | 9,999 | 9,094 | 0.91 | 0x51A773E8…3624 |
| HoodStreet Brokers (HOOD) | — | 8,971 | — | 0x1a30156f…9AbB |
| Florakins | 10,000 | 8,906 | 0.89 | 0xfb16359c…3003 |
| StonkBabies (SBB) | 10,000 | 8,902 | 0.89 | 0x90529996…E382 |
| Robinhood Goats (RG) | 10,000 | 8,648 | 0.86 | 0x9693521a…b1A6 |
| Monsters | 10,711 | 8,453 | 0.79 | 0x2ef6501d…ad25 |
| Robinhood Cats | 10,000 | 8,357 | 0.84 | 0x74b862F4…1fdA |
| CRUDE CATS | 10,000 | 8,340 | 0.83 | 0x6987622c…2D4f |
| The Neighborhoods (TNH) | 10,000 | 8,332 | 0.83 | 0xFE5C6382…5Cfd |
| Goblin Genesis | 10,000 | 8,325 | 0.83 | 0x09C9a292…04cB |
| SIGNALS | — | 8,118 | — | 0xB9106811…CB85 |
| EggsHood | 9,999 | 8,035 | 0.80 | 0x735513F1…0996 |
| Bits. | 10,000 | 8,034 | 0.80 | 0xa73Ad660…5F74 |
| URSAPE | 10,000 | 7,908 | 0.79 | 0x949E1dFa…a2FB |
| Tickup Fun (TICK) | 21,000 | 7,892 | 0.38 | 0x2995E8a8…9CC4 |
| Criminal | 10,000 | 7,855 | 0.79 | 0x8818e07B…aF66 |
| Bulls of Sherwood | 10,000 | 7,577 | 0.76 | 0x6fF91ECa…03e3 |
| Hood DoggoZ | 8,888 | 7,520 | 0.85 | 0x5C070405…daDa |
| Robinhood Distorted (RHD) | 7,777 | 7,315 | 0.94 | 0x34B4Cf2f…7Eaa |
| Cryptid Punks | 7,777 | 7,095 | 0.91 | 0xd6C9d1b4…9a45 |
| Robin Bonsai | 7,777 | 6,850 | 0.88 | 0xD1B4D1aF…45de |
| Fablings | 39,981 | 6,480 | 0.16 | 0xa1858144…b384 |

(Plus ~15 more in the 6.5k–7.8k holder band, nearly all 8.5k–10k supply.)

## Patterns extracted (design against these)

1. **Supply band**: the winning organic band is **7,777–10,000**. Modal values: 10,000, 9,999, 8,888, 7,777. Oversized supplies (21k Tickup, 40k Fablings, 100k Howl Street) show sharply worse holder/supply ratios (0.16–0.38) — they don't mint out proportionally.
2. **Holder/supply ratio 0.79–0.94** for every healthy 7.7k–10k collection → distribution is wide, ~1 token per wallet, consistent with **free or near-free mints** driving breadth. Robinhood's own "Gift" drops are 1:1 holder:supply airdrops.
3. **Theme**: the chain's meta is *finance/trading culture* — names lean on Hood/Street/Brokers/Stonk/Bulls/Signals/Tick/Market Operators. Punk derivatives and meme animals dressed in trading identity dominate. A trading-bot "founder edition" is exactly on-meta.
4. **Scarcity works as a tier, not as the collection**: nothing small (<5k supply) appears in the top-50 holder ranks — scarcity plays out inside 7.7k–10k collections via trait rarity, not via tiny total supply. (Blockscout ranks by holders, so small elite collections may still trade well but don't build breadth.)
5. Blockscout does not expose floor/volume for this chain (`volume_24h: null`) — price/volume data must come from marketplace sources (see companion market research doc).
