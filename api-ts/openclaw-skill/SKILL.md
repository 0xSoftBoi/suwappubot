---
name: suwappu-dex
description: Cross-chain DEX for swapping tokens across 7+ blockchains. Get quotes, check prices, view portfolio balances, and execute swaps on Ethereum, Base, Arbitrum, Polygon, BSC, Optimism, Avalanche, and Solana.
version: 0.2.0
user-invocable: true
requires:
  env:
    - SUWAPPU_API_KEY
  bins:
    - curl
    - jq
metadata: {"openclaw":{"primaryEnv":"SUWAPPU_API_KEY","skillKey":"suwappu-dex"}}
---

# Suwappu DEX Skill

You are a cross-chain DEX assistant. Use the Suwappu API to help users swap tokens, check prices, and view portfolio balances across 7+ blockchain networks.

## API Base URL

Production: `https://api.suwappu.bot`
Development: `https://devapi.suwappu.bot`

All authenticated requests require:
```
Authorization: Bearer $SUWAPPU_API_KEY
```

## MCP Server (Preferred)

If MCP is available, connect to the Suwappu MCP endpoint instead of using curl:

```json
{
  "mcpServers": {
    "suwappu": {
      "type": "http",
      "url": "https://api.suwappu.bot/mcp",
      "headers": {
        "Authorization": "Bearer $SUWAPPU_API_KEY"
      }
    }
  }
}
```

This exposes tools: `get_quote`, `get_portfolio`, `get_prices`, `list_chains`, `list_tokens`, `execute_swap`.

## Available Actions

### 1. Get a Swap Quote

When the user asks to swap tokens or wants a price quote:

```bash
curl -s -X POST "https://api.suwappu.bot/v1/agent/quote" \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from_token": "ETH",
    "to_token": "USDC",
    "amount": "0.5",
    "chain": "base",
    "wallet_address": "OPTIONAL_0x_ADDRESS"
  }' | jq '.'
```

**Parameters:**
- `from_token` (required): Token symbol to swap from (ETH, USDC, SOL, etc.)
- `to_token` (required): Token symbol to swap to
- `amount` (required): Human-readable amount (e.g. "0.5", "100")
- `chain` (optional, default "ethereum"): Chain name — ethereum, base, arbitrum, polygon, bsc, optimism, avalanche, solana
- `from_chain` / `to_chain` (optional): For cross-chain swaps
- `wallet_address` (optional): Include to get executable transaction data
- `slippage` (optional): Decimal slippage tolerance (0.03 = 3%)

**Response includes:** `quote_id`, exchange rate, estimated output, gas costs, route info. Save the `quote_id` to execute the swap later.

### 2. Check Token Prices

When the user asks about token prices:

```bash
curl -s "https://api.suwappu.bot/v1/agent/prices?symbols=ETH,SOL,USDC,BTC" \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" | jq '.prices'
```

Supported symbols: ETH, SOL, BNB, USDC, USDT, BTC, DAI, WBTC, ARB, OP, AVAX, MATIC, WETH, BONK, JUP, RAY. Max 20 per request.

### 3. Check Portfolio / Balances

When the user asks about their wallet balance:

```bash
curl -s "https://api.suwappu.bot/v1/agent/portfolio?wallet_address=0x1234...&chain=base" \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" | jq '.'
```

- `wallet_address` (required): 0x... for EVM, base58 for Solana
- `chain` (optional): Filter to specific chain

### 4. List Supported Chains

```bash
curl -s "https://api.suwappu.bot/v1/agent/chains" \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" | jq '.chains'
```

### 5. List Tokens on a Chain

```bash
curl -s "https://api.suwappu.bot/v1/agent/tokens?chain=base&search=USD" \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" | jq '.tokens'
```

### 6. Execute a Swap

After getting a quote, execute the swap:

```bash
curl -s -X POST "https://api.suwappu.bot/v1/agent/swap" \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "quote_id": "QUOTE_ID_FROM_STEP_1",
    "wallet_address": "0xUSER_WALLET"
  }' | jq '.'
```

This returns an **unsigned transaction** that the user must sign with their wallet.

### 7. Natural Language Execute

For simple commands, use the execute endpoint which parses natural language:

```bash
curl -s -X POST "https://api.suwappu.bot/v1/agent/execute" \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "swap 0.5 ETH to USDC on base",
    "wallet_address": "0xOPTIONAL"
  }' | jq '.'
```

## Supported Chains

| Chain | Key | Native Token | Type |
|-------|-----|-------------|------|
| Ethereum | ethereum | ETH | EVM |
| Base | base | ETH | EVM |
| Arbitrum | arbitrum | ETH | EVM |
| Polygon | polygon | MATIC | EVM |
| BNB Chain | bsc | BNB | EVM |
| Optimism | optimism | ETH | EVM |
| Avalanche | avalanche | AVAX | EVM |
| Solana | solana | SOL | Solana |

## Response Format

All API responses include `"success": true/false`. On success, data is in the top-level fields. On error, check `"error"` and `"message"` fields.

## Important Notes

- Quotes expire in 60 seconds. Always get a fresh quote before executing.
- The API returns unsigned transactions. Users must sign and broadcast themselves.
- For Solana swaps, transactions are base64-encoded and need deserialization before signing.
- Cross-chain swaps (e.g. ETH on Ethereum to USDC on Base) are supported via Li.Fi bridges.
- Rate limits: Free tier = 30 req/min, Agent tier = 100 req/min, Pro = 500 req/min.

## Registration

If you don't have an API key yet, register at:

```bash
curl -s -X POST "https://api.suwappu.bot/v1/agent/register" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-openclaw-agent", "description": "OpenClaw trading agent"}' | jq '.'
```

Save the returned `api_key` (starts with `suwappu_sk_`). It cannot be retrieved later.
