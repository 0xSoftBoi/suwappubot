---
name: suwappu-dex
description: "Use Suwappu's hosted MCP server for cross-chain quotes, swap simulation and unsigned transaction preparation, managed-wallet portfolio reads, prices, prediction-market research, Hyperliquid research, and Morpho market data."
homepage: https://suwappu.bot
metadata:
  {
    "openclaw":
      {
        "emoji": "🌸",
        "os": ["darwin", "linux", "win32"],
        "requires": { "env": ["SUWAPPU_API_KEY"] },
        "tags": ["dex", "defi", "swap", "cross-chain", "trading", "finance"],
      },
  }
tools:
  - get_quote
  - get_portfolio
  - get_prices
  - list_chains
  - list_tokens
  - execute_swap
  - simulate_swap
  - get_tempo_tokens
  - browse_mpp_directory
  - predict_markets
  - predict_market
  - perps_markets
  - perps_quote
  - perps_positions
  - lend_markets
  - lend_market
  - get_swap_status
  - get_swap_history
  - predict_book
  - predict_price
  - predict_trades
  - list_wallet_policies
---

# Suwappu MCP 🌸

Use Suwappu's hosted MCP server for DeFi data, swap routing, simulation, and
self-custody transaction preparation. The source 0.6 server advertises **22 tools**;
always treat the runtime `tools/list` response as canonical because deployed versions
can move independently of this skill.

## Setup

Register for an API key:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name":"my-openclaw"}'
export SUWAPPU_API_KEY=suwappu_sk_...
```

Then connect OpenClaw:

```bash
openclaw mcp add suwappu \
  --url https://api.suwappu.bot/mcp \
  --transport streamable-http \
  --header "Authorization=Bearer $SUWAPPU_API_KEY"
openclaw mcp probe suwappu
```

MCP initialization, `tools/list`, and the pure discovery tools `list_chains`,
`list_tokens`, `get_tempo_tokens`, and `browse_mpp_directory` are public. Other
tool calls require the bearer key. Keep the key in an environment variable or
secret manager, never a committed config file.

## Tool map

| Goal | Tools | Important boundary |
| --- | --- | --- |
| Route a swap | `get_quote`, `simulate_swap`, `execute_swap` | `execute_swap` returns an unsigned transaction; it never signs or broadcasts. |
| Inspect assets | `get_portfolio`, `get_prices`, `list_chains`, `list_tokens` | Portfolio reads are scoped to the caller's managed EVM wallet. |
| Reconcile managed swaps | `get_swap_status`, `get_swap_history` | These refer to swaps created by REST `POST /v1/agent/swap/execute`, not MCP `execute_swap`. |
| Prediction research | `predict_markets`, `predict_market`, `predict_book`, `predict_price`, `predict_trades` | MCP prediction tools are read-only. REST has a separate explicit order surface. |
| Perps research | `perps_markets`, `perps_quote`, `perps_positions` | The Agent API does not expose open/close execution. Treat quote/funding fields as research data; current funding can be a placeholder. |
| Lending research | `lend_markets`, `lend_market` | Read-only Morpho market data; no deposit/withdraw tool. |
| Managed-wallet controls | `list_wallet_policies` | Inspect existing policy guardrails. |
| Extra discovery | `get_tempo_tokens`, `browse_mpp_directory` | Public discovery; MPP directory is a third-party directory. |

## Safe swap flow

1. Call `get_quote` and preserve `quote_id`.
2. Call `simulate_swap` with that `quote_id` and, when available, the signing
   wallet address. Inspect `would_execute`, checks, warnings, expected output,
   price impact, and fees.
3. Show the economic terms to the user and get explicit approval.
4. Call `execute_swap <quote_id> <wallet_address>` to prepare the transaction.
5. Review, sign, and broadcast the returned transaction with the user's wallet.
6. Reconcile on-chain using the transaction hash from the user's broadcaster.

`execute_swap` consumes/prepares from the cached quote but does **not** create a
managed swap record. A timeout on this MCP tool therefore does not mean Suwappu
broadcast anything. If you need server-side signing and managed status/history,
use the explicit REST managed-wallet flow documented at
https://suwappu.bot/docs.

## Product-building patterns

- **Paid intelligence:** combine prices, prediction books/trades, perps market
  reads, or lending data into alerts, research, scoring, or reports.
- **Approval-based automation:** monitor conditions continuously, then quote +
  simulate + ask for approval before preparing a self-custody swap.
- **Operator tooling:** surface wallet policies, managed-swap history, and market
  context in an internal dashboard or agent console.

Do not describe Suwappu's x402/API metering as builder revenue. Those charges pay
for Suwappu API usage. Price your own product separately and track its revenue and
costs independently from strategy P&L.

## Safety and economics

- Never claim an MCP swap was broadcast: the MCP execution-shaped tool only
  prepares an unsigned transaction.
- Never claim the perps or lending MCP tools execute positions; they are research
  surfaces today.
- Do not hardcode chain counts, provider counts, API credit prices, or swap fees.
  Discover chains with `list_chains`; check live billing/pricing before making an
  economic decision.
- A profitable-looking spread is not a business model. Include API costs, gas,
  route fees, slippage, failed attempts, and your own product costs before calling
  an opportunity profitable.

Canonical docs: https://suwappu.bot/docs
Machine-readable docs: https://suwappu.bot/llms.txt
