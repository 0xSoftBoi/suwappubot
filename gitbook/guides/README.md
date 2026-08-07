# Guides

Hands-on walkthroughs and tutorials for building with the Suwappu API. Each guide uses real endpoints against `https://api.suwappu.bot` and states whether it is read-only, preview-only, self-custody, or managed execution. Start with the product and strategy lifecycle before putting capital behind automation.

## Build a Product

| Guide | What you'll learn |
|-------|-------------------|
| [Build a Business on Suwappu](build-a-business.md) | Revenue models, customer billing boundaries, and a builder-margin ledger |
| [Strategy Lifecycle](strategy-lifecycle.md) | Backtest/replay -> paper -> live gates, net P&L, and operational safety |
| [Build a Strategy Product with Flywheel](flywheel.md) | Outcome-safe execution, evaluation boundaries, OSS positioning, and paid product patterns |
| [Build with LangChain](langchain.md) | Schema-defined agent tools, approval-gated execution, and a paid-product blueprint |
| [Build with CrewAI](crewai.md) | Multi-agent role boundaries, typed plans, host-owned execution, and product economics |

## Core Walkthroughs

| Guide | What you'll learn |
|-------|-------------------|
| [Cross-Chain Swaps](cross-chain-swaps.md) | Quote, execute, and track a swap that bridges between chains |
| [Managed Wallets](managed-wallets.md) | Server-side wallets with no private-key handling in your agent |
| [Webhook Setup](webhook-setup.md) | Receive signed swap-status callbacks and verify them |

## Trading Features

| Guide | What you'll learn |
|-------|-------------------|
| [Perpetual Futures Research](perps-trading.md) | Browse/quote HyperLiquid markets and monitor positions; no Agent API execution |
| [Prediction Markets](prediction-markets.md) | Browse and trade Polymarket binary-outcome markets |
| [Limit Orders & DCA](limit-orders-dca.md) | Price-triggered swaps (Telegram Mini App) |

## Tutorials

| Guide | What you'll build |
|-------|-------------------|
| [Building a Trading Bot](building-a-trading-bot.md) | A price-triggered bot; add the lifecycle and accounting gates before live use |
| [Portfolio Rebalancer](portfolio-rebalancer.md) | A preview-first periodic rebalancer using portfolio + quote + simulation |
| [Trading CLI](trading-cli.md) | A small command-line tool for quotes and swaps |
| [Natural-Language CLI](natural-language-cli.md) | A CLI built on the `/execute` endpoint |
| [MCP Portfolio Advisor](mcp-portfolio-advisor.md) | A read-first advisor with an explicit unsigned-transaction handoff |

## Prerequisites

Every guide assumes you have registered an agent and have a Bearer token:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
# Response: { "success": true, "api_key": "suwappu_sk_..." }
```

Send `Authorization: Bearer suwappu_sk_YOUR_KEY` on every authenticated request.
