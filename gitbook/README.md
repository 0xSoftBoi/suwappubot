# Suwappu API

The cross-chain DeFi API built for AI agents. Suwappu gives your agent the ability to swap tokens, trade perpetual futures, access prediction markets, and browse lending protocols across 40+ blockchain networks through a single unified interface. Whether you're building an autonomous trading bot, a portfolio manager, or a conversational finance assistant, Suwappu handles routing, execution, and settlement so your agent can focus on strategy.

## Why Suwappu?

- **40+ Chains** -- Ethereum, Base, Arbitrum, Optimism, Solana, Polygon, BSC, Avalanche, Starknet, TRON, Tempo, Bitcoin L2s, and 30+ more
- **9 Swap Providers** -- Best-price routing raced across LiFi, CoW, OKX, 1inch, KyberSwap, Jupiter, Across, and CCTP
- **3 Protocols** -- REST API, MCP (Model Context Protocol), and A2A (Agent-to-Agent) so your agent can connect however it works best
- **Perpetual Futures** -- Trade leveraged long/short positions on 10 major assets via HyperLiquid
- **Prediction Markets** -- Browse and trade binary outcome markets on Polymarket
- **Lending** -- Access DeFi lending markets through Morpho with competitive rates
- **Managed Wallets** -- Server-side key management and transaction signing, no private key handling in your agent
- **Natural Language** -- Send plain English commands like "swap 0.5 ETH to USDC on Base" via the `/execute` endpoint

## 60-Second Quickstart

```bash
# 1. Register your agent (no auth needed)
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
# Response: { "success": true, "api_key": "suwappu_sk_..." }

# 2. Get a swap quote
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"from_token": "ETH", "to_token": "USDC", "amount": "0.5", "chain": "base"}'
# Response: { "success": true, "quote_id": "q_abc123", "expected_output": "985.42", ... }

# 3. Execute the swap
curl -X POST https://api.suwappu.bot/v1/agent/swap/execute \
  -H "Authorization: Bearer suwappu_sk_..." \
  -H "Content-Type: application/json" \
  -d '{"quote_id": "q_abc123"}'
# Response: { "success": true, "swap_id": "sw_xyz789", "status": "pending", ... }

# 4. Check swap status
curl https://api.suwappu.bot/v1/agent/swap/status/sw_xyz789 \
  -H "Authorization: Bearer suwappu_sk_..."
# Response: { "success": true, "status": "completed", "tx_hash": "0x...", ... }
```

## Documentation

| Section | Description |
|---------|-------------|
| [Quick Start](quickstart/README.md) | Get up and running in minutes |
| [Authentication](authentication/README.md) | API keys, bearer tokens, and rate limits |
| [API Reference](api-reference/README.md) | Complete endpoint documentation |
| [Protocols](protocols/README.md) | REST, MCP, and A2A integration guides |
| [Chains Reference](chains-reference/README.md) | Supported networks and token lists |
| [Guides](guides/README.md) | Cross-chain swaps, managed wallets, trading bots, perps, predictions |

## Agent Discovery

Suwappu is built to be found and used by AI agents automatically:

- **[llms.txt](https://api.suwappu.bot/llms.txt)** -- Machine-readable API summary that LLMs can consume to understand our capabilities
- **[Agent Card](https://api.suwappu.bot/.well-known/agent.json)** -- A2A-compatible agent descriptor for agent-to-agent discovery
- **[OpenAPI Spec](https://api.suwappu.bot/v1/agent/openapi)** -- Full OpenAPI 3.1 specification for automated client generation

Point your agent at any of these endpoints and it can start swapping tokens without reading a single page of docs.
