# Suwappu API

The cross-chain DeFi action plane built for AI agents. Suwappu gives builders a unified interface for token discovery, best-route quotes, simulation, self-custody transaction preparation, managed swap execution, prediction markets, HyperLiquid research, and Morpho market data across 40+ blockchain networks.

The interfaces have different authority levels on purpose: REST/SDK is the complete Agent API, MCP exposes discoverable tools with **unsigned** swap preparation, and A2A is a quote/price/discovery intent layer with no execution.

## Why Suwappu?

- **40+ Chains** -- discover the current list at `GET /v1/agent/chains` instead of hard-coding it.
- **Best-route quotes** -- supported providers are chain/route gated and evaluated by the routing engine.
- **Preview before capital** -- `POST /swap/simulate` runs safety checks without signing, broadcasting, or persisting a swap.
- **Two custody paths** -- `POST /swap` returns an unsigned self-custody transaction; `POST /swap/execute` signs/broadcasts with the authenticated agent's managed wallet.
- **Three protocols** -- REST API, MCP (Model Context Protocol), and A2A (Agent-to-Agent), with explicit authority boundaries.
- **Perpetual Futures Research** -- browse HyperLiquid markets, quote hypothetical positions, and inspect positions; Agent API execution is not exposed today.
- **Prediction Markets** -- browse market data and place explicit Polymarket orders through the documented prediction REST/SDK endpoints.
- **Lending Research** -- browse Morpho lending markets and rates; deposits/borrows are not exposed on the Agent API today.
- **Managed-wallet controls** -- policies, approvals, audit history, idempotency, and kill switches for automation.

## 60-second no-funds quickstart

Register and get a quote before you fund anything:

```bash
# 1. Register an agent (no auth needed)
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'

# Save agent.api_key from the response, then discover instead of hard-coding.
export SUWAPPU_API_KEY=suwappu_sk_YOUR_KEY
curl https://api.suwappu.bot/v1/agent/chains

# 2. Get a quote. This does not move funds.
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer $SUWAPPU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from_token":"ETH","to_token":"USDC","amount":"0.1","chain":"base"}'
```

To go further, choose custody explicitly. [Your First Swap](quickstart/first-swap.md) creates/funds a managed wallet, binds a fresh quote to it, simulates the trade, then shows the managed execution and reconciliation steps. [SDK Examples](quickstart/sdk-examples.md) shows the same preview-first boundary in TypeScript.

## Documentation

| Section | Description |
|---------|-------------|
| [Quick Start](quickstart/README.md) | Choose custody, quote, simulate, execute, reconcile |
| [Authentication](authentication/README.md) | API keys, bearer tokens, and rate limits |
| [API Reference](api-reference/README.md) | Complete endpoint documentation |
| [Protocols](protocols/README.md) | REST, MCP, and A2A authority boundaries |
| [Billing](billing/README.md) | x402 pay-per-call payments, credits, and subscription pricing |
| [Chains Reference](chains-reference/README.md) | Supported network concepts; discover the live list at runtime |
| [Guides](guides/README.md) | Product monetization, strategy lifecycle, automation, and market research |

## Build, measure, then monetize

Start with [Build a Business on Suwappu](guides/build-a-business.md) for customer-revenue models and [Strategy Lifecycle](guides/strategy-lifecycle.md) for replay -> paper -> live promotion. Keep builder margin separate from a customer's strategy P&L; neither is guaranteed.

## Agent discovery

- **[llms.txt](https://suwappu.bot/llms.txt)** -- curated machine-readable docs index.
- **[llms-full.txt](https://suwappu.bot/llms-full.txt)** -- full generated docs corpus.
- **[Agent Card](https://api.suwappu.bot/.well-known/agent.json)** -- A2A-compatible descriptor.
- **[OpenAPI Spec](https://api.suwappu.bot/v1/agent/openapi)** -- OpenAPI 3.1 contract.
- **MCP** -- `POST https://api.suwappu.bot/mcp`; call `tools/list` for the live tool inventory.

Treat those generated/runtime contracts as authoritative when a package registry or copied example lags the repository.
