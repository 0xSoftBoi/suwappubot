# All Chains

Suwappu supports 40+ blockchain networks across four chain types: EVM, Solana, TRON, and Starknet. Every chain is accessible through the same unified API -- the `chain` parameter in your requests determines which network to use. This includes major L1s and L2s, Bitcoin L2s (Rootstock, Citrea, BOB, Hemi, GOAT), and emerging chains like Tempo, Plasma, Berachain, and HyperEVM.

## Chain Types at a Glance

| Type | Address format | Token standard | Routing | Count |
|------|----------------|----------------|---------|-------|
| EVM | `0x...` | ERC-20 | Aggregated (Li.Fi, CoW, OKX, 1inch, KyberSwap, Across, CCTP) + chain-specific venues | 40+ |
| Solana | Base58 | SPL | Jupiter | 1 |
| TRON | Base58Check (`T...`) | TRC-20 | Li.Fi | 1 |
| Starknet | Felt252 | Cairo | AVNU (SNIP-29 paymaster) | 1 |

## Core EVM Chains

| Chain | Chain ID | Key | Native Token |
|-------|----------|-----|-------------|
| Ethereum | 1 | `ethereum` | ETH |
| Optimism | 10 | `optimism` | ETH |
| BNB Chain | 56 | `bsc` | BNB |
| Polygon | 137 | `polygon` | MATIC |
| Base | 8453 | `base` | ETH |
| Arbitrum | 42161 | `arbitrum` | ETH |
| Avalanche | 43114 | `avalanche` | AVAX |
| Fantom | 250 | `fantom` | FTM |
| Linea | 59144 | `linea` | ETH |
| Mantle | 5000 | `mantle` | MNT |
| Gnosis | 100 | `gnosis` | xDAI |
| Scroll | 534352 | `scroll` | ETH |

## Bitcoin L2s & BTC-Native Chains

| Chain | Chain ID | Key | Native Token |
|-------|----------|-----|-------------|
| Rootstock | 30 | `rootstock` | RBTC |
| Citrea | 4114 | `citrea` | cBTC |
| GOAT | 2345 | `goat` | BTC |
| BOB | 60808 | `bob` | ETH |
| Hemi | 43111 | `hemi` | ETH |

## Emerging & Specialized Chains

| Chain | Chain ID | Key | Native Token |
|-------|----------|-----|-------------|
| Tempo | 4217 | `tempo` | USD |
| Plasma | 9745 | `plasma` | XPL |
| HyperEVM | 999 | `hyperevm` | HYPE |
| Berachain | 80094 | `berachain` | BERA |
| Sonic | 146 | `sonic` | S |
| Sei | 1329 | `sei` | SEI |
| zkSync Era | 324 | `zksync` | ETH |
| Unichain | 130 | `unichain` | ETH |

See [EVM Chains](evm-chains.md) for the complete list of all 40+ EVM networks with chain IDs and native tokens.

## Non-EVM Chains

| Chain | Chain ID | Key | Native Token | Type |
|-------|----------|-----|--------------|------|
| Solana | `solana` | `solana` | SOL | Solana |
| TRON | `tron` | `tron` | TRX | TRON |
| Starknet | `SN_MAIN` | `starknet` | STRK | Starknet |

## Using Chain Keys

Pass the **key** (or a known alias) as the `chain` parameter in API requests:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"from_token": "ETH", "to_token": "USDC", "amount": "1", "chain": "base"}'
```

## Chain Types

### EVM Chains

All EVM chains share the same address format (`0x...`) and ERC-20 token standard. Most route through Li.Fi and the other aggregators for optimal pricing; a few Bitcoin L2s route through chain-specific venues only (e.g. GOAT via GOATSwap, Citrea via JuiceSwap). A single EVM managed wallet works across every EVM chain.

See [EVM Chains](evm-chains.md) for the full table.

### Solana

Solana uses Base58 addresses, the SPL token standard, and routes swaps through the Jupiter aggregator. Solana wallets are separate from EVM wallets.

See [Solana](solana.md) for token details.

### TRON

TRON uses Base58Check addresses (starting with `T`), the TRC-20 token standard, and routes swaps through Li.Fi. TRON wallets are separate from EVM and Solana wallets.

### Starknet

Starknet uses a Cairo-based account-abstraction model with Felt252 addresses. Swaps route through AVNU with integrator fees, and gasless transactions are supported via the SNIP-29 paymaster. In the TypeScript API, Starknet is read-only — signing and broadcast are handled by the Python bot backend.

## Discovering Chains Programmatically

Use `GET /v1/agent/chains` to fetch all supported chains at runtime:

```bash
curl https://api.suwappu.bot/v1/agent/chains
```

Use `GET /v1/agent/tokens?chain=<key>` to fetch available tokens on a specific chain:

```bash
curl "https://api.suwappu.bot/v1/agent/tokens?chain=base" \
  -H "Authorization: Bearer suwappu_sk_your_api_key"
```
