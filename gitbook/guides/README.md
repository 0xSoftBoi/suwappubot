# Guides

Hands-on walkthroughs and tutorials for building with the Suwappu API. Each guide uses real endpoints against `https://api.suwappu.bot` and states whether it is read-only, preview-only, self-custody, or managed execution. Start with the product and strategy lifecycle before putting capital behind automation.

## Build a Product

| Guide | What you'll learn |
|-------|-------------------|
| [Build a Business on Suwappu](build-a-business.md) | Revenue models, customer billing boundaries, and a builder-margin ledger |
| [Strategy Lifecycle](strategy-lifecycle.md) | Backtest/replay -> paper -> live gates, net P&L, and operational safety |
| [Build a Strategy Product with Flywheel](flywheel.md) | Outcome-safe execution, evaluation boundaries, OSS positioning, and paid product patterns |
| [Build a Quote-Qualified Arbitrage Monitor](arbitrage-monitor.md) | Executable-route screening, request economics, paid intelligence, and safe two-leg handoff |
| [Build a Standalone Trading Bot](building-a-trading-bot.md) | Single-node execution safety, REST/SDK/MCP authority, OSS tradeoffs, and a monitor-to-automation business ladder |
| [Build a Standalone Recurring DCA Product](dca-automation.md) | Single-writer schedule identity, outcome-safe recurring execution, REST/SDK/MCP authority, and a preview-to-automation business ladder |
| [Build a Standalone Prediction Monitor](prediction-markets.md) | Credential-free snapshots, durable alert state, operating economics, calibration, and OSS tradeoffs |
| [Build a Lending Monitor](lending-monitor.md) | Risk-aware Morpho snapshots, alert state, polling economics, OSS boundaries, and a paid-monitor product ladder |
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
| [Perpetual Futures Research](perps-trading.md) | Live mark/funding context, quotes, position-risk snapshots, and alert products; no Agent API execution |
| [Standalone Prediction Monitor](prediction-markets.md) | Run credential-free market monitoring; keep trading behind a separate authority boundary |
| [Lending Monitor](lending-monitor.md) | Monitor current Morpho rates, liquidity, listing status, and warnings without moving funds |
| [Limit Orders](limit-orders-dca.md) | Price-triggered swaps (Telegram Mini App) |

## Tutorials

| Guide | What you'll build |
|-------|-------------------|
| [Building a Standalone Trading Bot](building-a-trading-bot.md) | A USDC price-target product with single-writer state, outcome recovery, observability, and builder economics |
| [Build a Standalone Recurring DCA Product](dca-automation.md) | Fixed-USDC schedules with intended-time identity, cost guards, recovery, observability, reconciliation, and product economics |
| [Portfolio Rebalancer](portfolio-rebalancer.md) | Fixed-target treasury workflow with explicit holdings, durable managed execution, reconciliation, and monetization patterns |
| [Standalone Prediction Monitor](prediction-markets.md) | A screener/watchlist/alerts product with restart-safe state and market-quality evidence |
| [Lending Monitor](lending-monitor.md) | A snapshot/delta/alert pipeline you can turn into a paid research product |
| [Trading CLI](trading-cli.md) | A small command-line tool for quotes and swaps |
| [Natural-Language CLI](natural-language-cli.md) | A CLI built on the `/execute` endpoint |
| [MCP Portfolio Advisor](mcp-portfolio-advisor.md) | A read-first advisor with an explicit unsigned-transaction handoff |

## Prerequisites

Most authenticated guides assume you have registered an agent and have a Bearer token. The lending REST routes are public, so you can complete [Build a Lending Monitor](lending-monitor.md) without a key; hosted MCP lending tools still require authentication.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
# Response: { "success": true, "api_key": "suwappu_sk_..." }
```

Send `Authorization: Bearer suwappu_sk_YOUR_KEY` on every authenticated request.
