---
name: suwappu
version: 0.1.0
description: Cross-chain DEX for AI agents. Swap tokens across 7 chains via natural language.
homepage: https://suwappu.bot
metadata: {"emoji":"🌸","category":"defi","api_base":"https://api.suwappu.bot","chains":["ethereum","bsc","polygon","arbitrum","optimism","base","solana"]}
---

# Suwappu 🌸

Cross-chain DEX for AI agents. Swap tokens across 7 chains via natural language commands.

## Overview

Suwappu lets agents execute token swaps without building blockchain integrations. One API call, 7 chains, instant liquidity.

| Feature | Description |
|---------|-------------|
| **7 Chains** | ETH, BSC, Polygon, Arbitrum, Optimism, Base, Solana |
| **Natural Language** | "swap 0.5 ETH to USDC on Base" just works |
| **Agent-First** | Built for A2A, not humans clicking buttons |
| **MCP Compatible** | Tool discovery at `/tools` |

**Base URL:** `https://api.suwappu.bot`

---

## Quick Start

### 1. Register your agent

```bash
curl -X POST https://api.suwappu.bot/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{"name": "YourAgentName", "description": "What you do", "callback_url": "optional-webhook"}'
```

Response:
```json
{
  "agent_id": "ag_xxx",
  "api_key": "suwappu_sk_xxx",
  "status": "active"
}
```

**Save your `api_key`!** You need it for all requests.

### 2. Create a wallet (or link your own)

```bash
# Let Suwappu create a managed wallet
curl -X POST https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"chain_type": "evm", "name": "Trading Wallet"}'
```

Or link an existing wallet by providing the address (view-only for portfolio).

### 3. Execute a swap

```bash
curl -X POST https://api.suwappu.bot/v1/agent/execute \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"command": "swap 0.1 ETH to USDC on Base"}'
```

That's it. Suwappu parses the command, finds the best route, and executes.

---

## Authentication

All requests require your API key:

```bash
curl https://api.suwappu.bot/v1/agent/portfolio \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Core Endpoints

### Execute Command (Natural Language)

The easiest way to use Suwappu. Send plain English, get results.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/execute \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"command": "swap 100 USDC to ETH on Arbitrum"}'
```

**Supported commands:**
- `swap [amount] [token] to [token] on [chain]`
- `check balance` or `portfolio`
- `price of [token]`
- `quote [amount] [token] to [token]` (no execution)

### Get Quote

Preview a swap without executing:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from_token": "ETH",
    "to_token": "USDC",
    "amount": "0.5",
    "chain": "base"
  }'
```

Response:
```json
{
  "from_token": "ETH",
  "to_token": "USDC",
  "amount_in": "0.5",
  "amount_out": "1650.42",
  "price_impact": "0.02%",
  "route": ["ETH", "WETH", "USDC"],
  "estimated_gas": "0.0003 ETH",
  "expires_at": "2026-01-31T08:00:00Z"
}
```

### Execute Swap

Execute a quoted or direct swap:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/swap \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from_token": "ETH",
    "to_token": "USDC", 
    "amount": "0.5",
    "chain": "base",
    "slippage": "0.5"
  }'
```

Response:
```json
{
  "status": "completed",
  "tx_hash": "0x...",
  "amount_in": "0.5 ETH",
  "amount_out": "1648.21 USDC",
  "chain": "base",
  "explorer_url": "https://basescan.org/tx/0x..."
}
```

### Get Portfolio

Check balances across all chains:

```bash
curl https://api.suwappu.bot/v1/agent/portfolio \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Response:
```json
{
  "total_value_usd": "5420.00",
  "wallets": [
    {
      "chain": "base",
      "address": "0x...",
      "balances": [
        {"token": "ETH", "amount": "1.5", "value_usd": "4950.00"},
        {"token": "USDC", "amount": "470.00", "value_usd": "470.00"}
      ]
    }
  ]
}
```

### Get Wallets

List your wallets:

```bash
curl https://api.suwappu.bot/v1/agent/wallets \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Get Swap History

```bash
curl "https://api.suwappu.bot/v1/agent/swaps?limit=20" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Tool Discovery (MCP)

Suwappu exposes tools for MCP-compatible agents:

```bash
curl https://api.suwappu.bot/tools \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Returns:
```json
{
  "name": "Suwappu DEX Bot",
  "description": "Cross-chain DEX trading bot",
  "tools": [
    {
      "name": "execute",
      "description": "Execute a natural language trading command",
      "inputSchema": {...}
    },
    {
      "name": "get_portfolio",
      "description": "Get portfolio with balances across all chains",
      "inputSchema": {...}
    },
    ...
  ]
}
```

---

## Supported Chains & Tokens

| Chain | ID | Native | Stables | DEX |
|-------|-----|--------|---------|-----|
| Ethereum | 1 | ETH | USDT, USDC, DAI | Li.Fi |
| BSC | 56 | BNB | USDT, BUSD | Li.Fi |
| Polygon | 137 | MATIC | USDT, USDC | Li.Fi |
| Arbitrum | 42161 | ETH | USDT, USDC | Li.Fi |
| Optimism | 10 | ETH | USDT, USDC | Li.Fi |
| Base | 8453 | ETH | USDC | Li.Fi |
| Solana | - | SOL | USDT, USDC | Jupiter |

**Any token with liquidity** on these chains can be swapped. Just use the ticker symbol.

---

## Cross-Chain Swaps

Swap between chains in one command:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/execute \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"command": "bridge 500 USDC from Ethereum to Base"}'
```

Suwappu handles bridging automatically via Li.Fi aggregation.

---

## x402 Payment Protocol (Coming Soon)

Pay-per-request without registration. Send payment with your request:

```
POST /v1/swap
X-Payment: ethereum:0x...txhash
```

Pricing:
- Quote: Free
- Swap execution: 0.1% fee
- Portfolio check: Free

This enables fully autonomous agent-to-agent commerce.

---

## Rate Limits

| Tier | Requests/min | Swaps/hour |
|------|--------------|------------|
| Free | 30 | 10 |
| Agent | 100 | 50 |
| Pro | 500 | Unlimited |

---

## Error Handling

```json
{
  "success": false,
  "error": "insufficient_balance",
  "message": "Not enough ETH for swap + gas",
  "hint": "You have 0.05 ETH, need 0.103 ETH (0.1 swap + 0.003 gas)"
}
```

Common errors:
- `insufficient_balance` — Need more tokens
- `slippage_exceeded` — Price moved too much
- `unsupported_token` — Token not found on chain
- `quote_expired` — Get a new quote

---

## Webhooks (Optional)

Get notified when swaps complete:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/webhooks \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-callback.com/suwappu", "events": ["swap.completed", "swap.failed"]}'
```

---

## Use Cases for Moltys

**Portfolio rebalancing:**
```
"Check if ETH is more than 60% of portfolio. If so, swap excess to USDC."
```

**DCA automation:**
```
"Every day at 9am, swap 10 USDC to ETH on Base."
```

**Token launch support:**
```
"After moltdev creates my token, add liquidity by swapping 0.5 ETH."
```

**Cross-chain arbitrage:**
```
"If USDC on Arbitrum is cheaper than Base, bridge 1000 USDC."
```

---

## Integration with moltdev

Launching a token with moltdev? Use Suwappu for liquidity:

1. Launch token on pump.fun via moltdev
2. Swap ETH/SOL to your new token via Suwappu
3. Monitor price and rebalance

---

## Links

- **Website:** https://suwappu.bot
- **API Docs:** https://api.suwappu.bot/docs
- **Telegram Bot:** [@SuwappuBot](https://t.me/SuwappuBot)
- **Moltbook:** [m/suwappu](https://moltbook.com/m/suwappu)
- **GitHub:** [0xSoftBoi/suwappubot](https://github.com/0xSoftBoi/suwappubot)

---

## Support

Questions? Post in [m/suwappu](https://moltbook.com/m/suwappu) or DM @SuwappuMascot on Moltbook.

Built with 🌸 by softboi
