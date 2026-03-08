# EVM Chains

All 12 EVM chains use the same address format, ERC-20 token standard, and are routed through the Li.Fi aggregator for optimal swap pricing. A single EVM managed wallet works across all EVM chains.

Native tokens on all chains use the zero address: `0x0000000000000000000000000000000000000000`.

---

## Ethereum

| Property | Value |
|----------|-------|
| Chain ID | 1 |
| Key | `ethereum` |
| Alias | `eth` |
| Native Token | ETH |

### Common Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| ETH | `0x0000000000000000000000000000000000000000` | 18 |
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | 18 |
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 |
| USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 |
| WBTC | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | 8 |

---

## Optimism

| Property | Value |
|----------|-------|
| Chain ID | 10 |
| Key | `optimism` |
| Alias | `op` |
| Native Token | ETH |

### Common Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| ETH | `0x0000000000000000000000000000000000000000` | 18 |
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| USDC | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 |
| USDC.e | `0x7F5c764cBc14f9669B88837ca1490cCa17c31607` | 6 |
| USDT | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | 6 |

---

## BNB Chain

| Property | Value |
|----------|-------|
| Chain ID | 56 |
| Key | `bsc` |
| Alias | `bnb` |
| Native Token | BNB |

### Common Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| BNB | `0x0000000000000000000000000000000000000000` | 18 |
| WBNB | `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c` | 18 |
| USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 |
| USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 |
| BUSD | `0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56` | 18 |

---

## Polygon

| Property | Value |
|----------|-------|
| Chain ID | 137 |
| Key | `polygon` |
| Alias | `matic` |
| Native Token | MATIC |

### Common Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| MATIC | `0x0000000000000000000000000000000000000000` | 18 |
| WMATIC | `0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270` | 18 |
| USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 |
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` | 6 |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | 6 |

---

## Arbitrum

| Property | Value |
|----------|-------|
| Chain ID | 42161 |
| Key | `arbitrum` |
| Alias | `arb` |
| Native Token | ETH |

### Common Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| ETH | `0x0000000000000000000000000000000000000000` | 18 |
| WETH | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | 18 |
| USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |
| USDC.e | `0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8` | 6 |
| USDT | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 |

---

## Base

| Property | Value |
|----------|-------|
| Chain ID | 8453 |
| Key | `base` |
| Alias | -- |
| Native Token | ETH |

### Common Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| ETH | `0x0000000000000000000000000000000000000000` | 18 |
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| DAI | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` | 18 |

---

## Avalanche

| Property | Value |
|----------|-------|
| Chain ID | 43114 |
| Key | `avalanche` |
| Alias | `avax` |
| Native Token | AVAX |

### Common Tokens

| Token | Address | Decimals |
|-------|---------|----------|
| AVAX | `0x0000000000000000000000000000000000000000` | 18 |
| WAVAX | `0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7` | 18 |
| USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | 6 |
| USDC.e | `0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664` | 6 |
| USDT | `0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7` | 6 |

---

## Fantom

| Property | Value |
|----------|-------|
| Chain ID | 250 |
| Key | `fantom` |
| Alias | `ftm` |
| Native Token | FTM |

Token addresses for Fantom are resolved dynamically via the Li.Fi API at runtime. Use `GET /tokens?chain=fantom` to fetch available tokens.

---

## Linea

| Property | Value |
|----------|-------|
| Chain ID | 59144 |
| Key | `linea` |
| Alias | -- |
| Native Token | ETH |

Token addresses for Linea are resolved dynamically via the Li.Fi API at runtime. Use `GET /tokens?chain=linea` to fetch available tokens.

---

## Mantle

| Property | Value |
|----------|-------|
| Chain ID | 5000 |
| Key | `mantle` |
| Alias | -- |
| Native Token | MNT |

Token addresses for Mantle are resolved dynamically via the Li.Fi API at runtime. Use `GET /tokens?chain=mantle` to fetch available tokens.

---

## Gnosis

| Property | Value |
|----------|-------|
| Chain ID | 100 |
| Key | `gnosis` |
| Alias | -- |
| Native Token | xDAI |

Token addresses for Gnosis are resolved dynamically via the Li.Fi API at runtime. Use `GET /tokens?chain=gnosis` to fetch available tokens.

---

## Scroll

| Property | Value |
|----------|-------|
| Chain ID | 534352 |
| Key | `scroll` |
| Alias | -- |
| Native Token | ETH |

Token addresses for Scroll are resolved dynamically via the Li.Fi API at runtime. Use `GET /tokens?chain=scroll` to fetch available tokens.

---

## Notes

- **Native tokens** always use the zero address `0x0000000000000000000000000000000000000000` across all EVM chains.
- **USDC vs USDC.e**: Several chains have both native USDC and bridged USDC.e. Native USDC is the canonical version issued by Circle; USDC.e is the older bridged version. Both are supported.
- **Dynamic resolution**: For chains without hardcoded token lists above (Fantom, Linea, Mantle, Gnosis, Scroll), tokens are resolved at runtime via the Li.Fi API. Use `GET /tokens?chain=<key>` to discover available tokens.
- **Decimals matter**: When specifying amounts in the API, use human-readable values (e.g., `"1.5"` for 1.5 ETH). The API handles decimal conversion internally.
