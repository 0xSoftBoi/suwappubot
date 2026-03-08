# All Chains

Suwappu supports 15 blockchain networks across three chain types: EVM, Solana, and non-EVM (Sui, TON). Every chain is accessible through the same unified API -- the `chain` parameter in your requests determines which network to use.

## Supported Chains

| Chain | Chain ID | Key | Aliases | Native Token | Type | Status |
|-------|----------|-----|---------|-------------|------|--------|
| Ethereum | 1 | `ethereum` | `eth` | ETH | EVM | Live |
| Optimism | 10 | `optimism` | `op` | ETH | EVM | Live |
| BNB Chain | 56 | `bsc` | `bnb` | BNB | EVM | Live |
| Polygon | 137 | `polygon` | `matic` | MATIC | EVM | Live |
| Arbitrum | 42161 | `arbitrum` | `arb` | ETH | EVM | Live |
| Base | 8453 | `base` | -- | ETH | EVM | Live |
| Avalanche | 43114 | `avalanche` | `avax` | AVAX | EVM | Live |
| Fantom | 250 | `fantom` | `ftm` | FTM | EVM | Live |
| Linea | 59144 | `linea` | -- | ETH | EVM | Live |
| Mantle | 5000 | `mantle` | -- | MNT | EVM | Live |
| Gnosis | 100 | `gnosis` | -- | xDAI | EVM | Live |
| Scroll | 534352 | `scroll` | -- | ETH | EVM | Live |
| Solana | -- | `solana` | `sol` | SOL | Solana | Live |
| Sui | -- | `sui` | -- | SUI | Move | Live |
| TON | -- | `ton` | -- | TON | TON | Live |

## Using Chain Keys

Pass the **key** or **alias** as the `chain` parameter in API requests. Keys and aliases are interchangeable:

```bash
# These are equivalent
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"from_token": "ETH", "to_token": "USDC", "amount": "1", "chain": "ethereum"}'

curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"from_token": "ETH", "to_token": "USDC", "amount": "1", "chain": "eth"}'
```

## Currently Resolved Chains

The API currently resolves the following chain keys and aliases for swap routing:

| Key | Alias |
|-----|-------|
| `ethereum` | `eth` |
| `optimism` | `op` |
| `bsc` | `bnb` |
| `polygon` | `matic` |
| `arbitrum` | `arb` |
| `base` | -- |
| `avalanche` | `avax` |
| `solana` | `sol` |

Additional chains (Fantom, Linea, Mantle, Gnosis, Scroll, Sui, TON) are live and queryable via `GET /chains` and `GET /tokens`, with swap routing expanding continuously.

## Chain Types

### EVM Chains

All 12 EVM chains share the same address format (`0x...`), use the same token standards (ERC-20), and are routed through the Li.Fi aggregator for optimal pricing. A single EVM managed wallet works across all EVM chains.

See [EVM Chains](evm-chains.md) for detailed token addresses.

### Solana

Solana uses Base58 addresses, the SPL token standard, and routes swaps through the Jupiter aggregator. Solana wallets are separate from EVM wallets.

See [Solana](solana.md) for token addresses and Solana-specific details.

### Sui and TON

Sui uses the Move VM and TON uses its own virtual machine. Both have distinct address formats and token standards. Support for these chains is expanding.

## Discovering Chains Programmatically

Use `GET /chains` to fetch all supported chains at runtime:

```bash
curl https://api.suwappu.bot/v1/agent/chains
```

Use `GET /tokens?chain=<key>` to fetch available tokens on a specific chain:

```bash
curl "https://api.suwappu.bot/v1/agent/tokens?chain=base" \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```
