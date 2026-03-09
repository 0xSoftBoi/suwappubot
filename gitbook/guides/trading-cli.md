# Trading CLI

The `@suwappu/sdk` package includes `suwappu`, an interactive command-line tool for swapping tokens, checking prices, viewing your portfolio, and managing perpetual positions — all from your terminal with colored output, formatted tables, and spinners.

## Installation

```bash
# Global install (recommended)
npm install -g @suwappu/sdk

# Or run directly with npx
npx @suwappu/sdk chains
```

## Configuration

The CLI reads your API key from three sources (highest priority first):

1. **CLI flags** (not yet supported for API key)
2. **Environment variable**: `SUWAPPU_API_KEY`
3. **Config file**: `~/.suwappu/config.json`

### Set Up Your API Key

```bash
# Option 1: Environment variable
export SUWAPPU_API_KEY=suwappu_sk_your_api_key

# Option 2: Config file
suwappu config set api-key suwappu_sk_your_api_key
```

### View Current Config

```bash
suwappu config show
# Configuration:
#   API Key (config): suwa..._key
#   API Key (env):    not set
#   Base URL:         default (https://api.suwappu.bot)
```

---

## Commands

### `suwappu chains`

List all supported blockchain networks with their status.

```bash
suwappu chains
```

```
┌──────────┬──────────┬─────────┐
│ Chain    │ Chain ID │ Status  │
├──────────┼──────────┼─────────┤
│ Ethereum │ 1        │ active  │
│ Base     │ 8453     │ active  │
│ Arbitrum │ 42161    │ active  │
└──────────┴──────────┴─────────┘
```

### `suwappu tokens <chain>`

List available tokens on a specific chain.

```bash
suwappu tokens ethereum
```

```
┌────────┬────────────────┬──────────┬──────────┐
│ Symbol │ Address        │ Decimals │ Chain    │
├────────┼────────────────┼──────────┼──────────┤
│ ETH    │ 0x00000...0000 │ 18       │ ethereum │
│ USDC   │ 0xa0b86...9012 │ 6        │ ethereum │
│ WBTC   │ 0x2260f...4c63 │ 8        │ ethereum │
└────────┴────────────────┴──────────┴──────────┘
```

### `suwappu prices <tokens...>`

Get current prices with 24-hour change. Accepts multiple tokens.

```bash
suwappu prices ETH BTC SOL
```

```
┌───────┬────────────┬────────────┐
│ Token │ Price      │ 24h Change │
├───────┼────────────┼────────────┤
│ ETH   │ $2,847.50  │ +3.21%     │
│ BTC   │ $67,000.00 │ -1.50%     │
│ SOL   │ $142.30    │ +5.67%     │
└───────┴────────────┴────────────┘
```

### `suwappu portfolio`

Show token balances with USD values and a total.

```bash
suwappu portfolio
suwappu portfolio --chain ethereum
```

```
┌───────┬─────────┬───────────┬──────────┐
│ Token │ Balance │ USD Value │ Chain    │
├───────┼─────────┼───────────┼──────────┤
│ ETH   │ 1.5     │ $4,271.25 │ ethereum │
│ USDC  │ 1,000   │ $1,000.00 │ ethereum │
├───────┼─────────┼───────────┼──────────┤
│             Total│ $5,271.25 │          │
└───────┴─────────┴───────────┴──────────┘
```

### `suwappu swap <from> <to> <amount>`

Get a swap quote, review the details, then confirm to execute.

```bash
suwappu swap ETH USDC 1.0 --chain ethereum
```

```
⠋ Getting quote: 1 ETH → USDC

┌────────────────┬──────────────────────┐
│ From           │ 1 ETH                │
│ To             │ 2,847.50 USDC        │
│ Rate           │ 2847.50              │
│ Price Impact   │ +0.05%               │
│ Slippage       │ +0.50%               │
│ Gas            │ $2.50                │
│ Fee            │ $0.10                │
│ DEX            │ Uniswap V3           │
│ Route          │ direct               │
│ Est. Time      │ 15s                  │
│ Chain          │ ethereum             │
└────────────────┴──────────────────────┘

Execute this swap? [y/N] y
✔ Executing swap

Swap submitted!
  TX: 0xabc123...
  Status: confirmed
  Chain: ethereum
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--chain <chain>` | Chain to swap on (default: `ethereum`) |
| `--slippage <pct>` | Max slippage percentage |
| `--json` | Output raw JSON (skips confirmation) |

### `suwappu perps markets`

List available perpetual futures markets.

```bash
suwappu perps markets
```

```
┌─────────┬───────┬────────────┬──────────────┬─────────────┐
│ Market  │ Asset │ Mark Price │ Funding Rate │ Max Leverage│
├─────────┼───────┼────────────┼──────────────┼─────────────┤
│ ETH-USD │ ETH   │ $2,847.50  │ +0.01%       │ 50x         │
│ BTC-USD │ BTC   │ $67,000.00 │ +0.01%       │ 100x        │
└─────────┴───────┴────────────┴──────────────┴─────────────┘
```

### `suwappu perps positions <address>`

Show open perpetual positions with unrealized PnL.

```bash
suwappu perps positions 0x1234...5678
```

```
┌─────────┬──────┬──────┬───────────┬───────────┬─────────┬─────────┬────────────┐
│ Market  │ Side │ Size │ Entry     │ Mark      │ PnL     │Leverage │ Liq. Price │
├─────────┼──────┼──────┼───────────┼───────────┼─────────┼─────────┼────────────┤
│ ETH-USD │ LONG │ 1.5  │ $2,800.00 │ $2,850.00 │ $75.00  │ 10x     │ $2,540.00  │
└─────────┴──────┴──────┴───────────┴───────────┴─────────┴─────────┴────────────┘
```

---

## JSON Output

Every command supports `--json` for machine-readable output. This is useful for piping to `jq` or integrating with scripts.

```bash
# Pipe to jq
suwappu chains --json | jq '.[].name'

# Use in scripts
PRICE=$(suwappu prices ETH --json | jq -r '.[0].priceUsd')
echo "ETH is $PRICE"

# Skip swap confirmation
suwappu swap ETH USDC 1.0 --chain base --json
```

---

## Comparison with Natural Language CLI

| Feature | `suwappu` CLI | [Natural Language CLI](natural-language-cli.md) |
|---------|--------------|------------------------------------------------|
| Interface | Structured commands | Free-form English |
| Protocol | REST API | A2A (Agent-to-Agent) |
| Best for | Scripts, automation, quick lookups | Conversational, exploratory |
| Output | Formatted tables | Natural language responses |
| Confirmation | Interactive y/N for swaps | Handled by agent |

Both tools use the same API under the hood. Use the structured CLI for automation and the natural language CLI for exploration.
