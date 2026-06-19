# Guides

Hands-on walkthroughs and tutorials for building with the Suwappu API. Each guide is self-contained and uses real endpoints against the production base URL `https://api.suwappu.bot`. Start with cross-chain swaps and managed wallets, then move on to full bot and automation tutorials.

## Core Walkthroughs

| Guide | What you'll learn |
|-------|-------------------|
| [Cross-Chain Swaps](cross-chain-swaps.md) | Quote, execute, and track a swap that bridges between chains |
| [Managed Wallets](managed-wallets.md) | Server-side wallets with no private-key handling in your agent |
| [Webhook Setup](webhook-setup.md) | Receive signed swap-status callbacks and verify them |

## Trading Features

| Guide | What you'll learn |
|-------|-------------------|
| [Perpetual Futures](perps-trading.md) | Open leveraged long/short positions via HyperLiquid |
| [Prediction Markets](prediction-markets.md) | Browse and trade Polymarket binary-outcome markets |
| [Limit Orders & DCA](limit-orders-dca.md) | Price-triggered swaps (Telegram Mini App) |

## Tutorials

| Guide | What you'll build |
|-------|-------------------|
| [Building a Trading Bot](building-a-trading-bot.md) | A simple price-triggered trading bot on the API |
| [Portfolio Rebalancer](portfolio-rebalancer.md) | A periodic rebalancer using quote + swap + portfolio |
| [Trading CLI](trading-cli.md) | A small command-line tool for quotes and swaps |
| [Natural-Language CLI](natural-language-cli.md) | A CLI built on the `/execute` endpoint |
| [MCP Portfolio Advisor](mcp-portfolio-advisor.md) | Use the MCP server in Claude or Cursor as a portfolio advisor |

## Prerequisites

Every guide assumes you have registered an agent and have a Bearer token:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
# Response: { "success": true, "api_key": "suwappu_sk_..." }
```

Send `Authorization: Bearer suwappu_sk_YOUR_KEY` on every authenticated request.
