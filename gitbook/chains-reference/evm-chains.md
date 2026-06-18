# EVM Chains

Suwappu supports 40+ EVM-compatible networks, all sharing the `0x...` address format and the ERC-20 token standard. A single EVM managed wallet works across every EVM chain. Pass the chain **key** (e.g. `base`, `arbitrum`, `tempo`) as the `chain` parameter in your API requests. Most chains route through Li.Fi and the other aggregators; a few Bitcoin L2s route through chain-specific venues only.

## Major L1s & L2s

| Chain | Chain ID | Key | Native Token |
|-------|----------|-----|-------------|
| Ethereum | 1 | `ethereum` | ETH |
| Optimism | 10 | `optimism` | ETH |
| Flare | 14 | `flare` | FLR |
| BNB Chain | 56 | `bsc` | BNB |
| Unichain | 130 | `unichain` | ETH |
| Polygon | 137 | `polygon` | MATIC |
| Sonic | 146 | `sonic` | S |
| opBNB | 204 | `opbnb` | BNB |
| Fantom | 250 | `fantom` | FTM |
| Fraxtal | 252 | `fraxtal` | FRAX |
| zkSync Era | 324 | `zksync` | ETH |
| World Chain | 480 | `worldchain` | ETH |
| Flow EVM | 747 | `flow` | FLOW |
| Gnosis | 100 | `gnosis` | xDAI |
| Lisk | 1135 | `lisk` | ETH |
| Sei | 1329 | `sei` | SEI |
| Soneium | 1868 | `soneium` | ETH |
| Swellchain | 1923 | `swellchain` | ETH |
| Abstract | 2741 | `abstract` | ETH |
| Mantle | 5000 | `mantle` | MNT |
| Kaia | 8217 | `kaia` | KAIA |
| Base | 8453 | `base` | ETH |
| Apechain | 33139 | `apechain` | APE |
| Mode | 34443 | `mode` | ETH |
| Arbitrum | 42161 | `arbitrum` | ETH |
| Avalanche | 43114 | `avalanche` | AVAX |
| Linea | 59144 | `linea` | ETH |
| Berachain | 80094 | `berachain` | BERA |
| Unichain | 130 | `unichain` | ETH |
| Taiko | 167000 | `taiko` | ETH |
| Scroll | 534352 | `scroll` | ETH |

## Bitcoin L2s & BTC-Native Chains

These chains settle to or are secured by Bitcoin. Note that GOAT and Citrea use 18-decimal native BTC (ETH-style), not 8.

| Chain | Chain ID | Key | Native Token | Routing notes |
|-------|----------|-----|-------------|---------------|
| Rootstock | 30 | `rootstock` | RBTC | Li.Fi only; legacy gas, 0.06 gwei minimum |
| GOAT | 2345 | `goat` | BTC | GOATSwap only (not on aggregators) |
| Citrea | 4114 | `citrea` | cBTC | JuiceSwap only (UniV3 fork) |
| Hemi | 43111 | `hemi` | ETH | Aggregator-routed |
| BOB | 60808 | `bob` | ETH | Aggregator-routed |

## Emerging & Specialized Chains

| Chain | Chain ID | Key | Native Token | Notes |
|-------|----------|-----|-------------|-------|
| Tempo | 4217 | `tempo` | USD | USD-denominated, 6 decimals; TIP-20 stablecoins; gasless sponsorship |
| Plasma | 9745 | `plasma` | XPL | |
| HyperEVM | 999 | `hyperevm` | HYPE | EVM layer of HyperLiquid |

## Routing

EVM swaps race up to nine aggregators and bridges for the best execution price:

- **Li.Fi** — same-chain and cross-chain routing across most EVM chains
- **CoW Protocol** — batch-auction, MEV-protected settlement
- **OKX** — DEX aggregation
- **1inch** — DEX aggregation
- **KyberSwap** — DEX aggregation
- **Across** — fast cross-chain bridging
- **CCTP** — native USDC bridging
- **GOATSwap / JuiceSwap** — chain-specific venues for GOAT and Citrea, which aggregators do not cover

The API returns the best available route automatically — you do not choose the aggregator.

## Native vs. Wrapped Tokens

For native-token swaps (ETH, BNB, MATIC, AVAX, etc.), pass the token symbol (e.g. `ETH`) as `from_token` or `to_token`. Chains with non-ETH native tokens (BNB, MATIC, AVAX, FTM, MNT, xDAI, SEI, BERA, S, FLR, KAIA, APE, RBTC, cBTC, BTC, HYPE, XPL, FRAX, FLOW) use that symbol as the native unit.

## Discovering Tokens

Use `GET /v1/agent/tokens?chain=<key>` to list available tokens on any EVM chain:

```bash
curl "https://api.suwappu.bot/v1/agent/tokens?chain=base" \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```

## Example: Same-Chain Swap on Base

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from_token": "ETH", "to_token": "USDC", "amount": "0.5", "chain": "base"}'
```

## Example: Cross-Chain Swap (Arbitrum → Base)

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from_token": "USDC",
    "to_token": "USDC",
    "amount": "100",
    "from_chain": "arbitrum",
    "to_chain": "base"
  }'
```

See [Cross-Chain Swaps](../guides/cross-chain-swaps.md) for the full walkthrough.
