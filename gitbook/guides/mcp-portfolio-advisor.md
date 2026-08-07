# MCP Portfolio Advisor

Build a conversational portfolio advisor on Suwappu's hosted MCP server. The useful product boundary is deliberate: let the model read balances, prices, policies, and quotes freely, then require explicit approval before it can even prepare a transaction.

## 1. Connect the hosted MCP server

There is no local package required for the hosted path. Point your MCP client at:

```text
https://api.suwappu.bot/mcp
```

For example, a project-scoped MCP config can look like:

```json
{
  "mcpServers": {
    "suwappu": {
      "type": "http",
      "url": "https://api.suwappu.bot/mcp",
      "headers": {
        "Authorization": "Bearer suwappu_sk_YOUR_KEY"
      }
    }
  }
}
```

Get the API key from [registration](../api-reference/registration.md). See [MCP Client Setup](../quickstart/mcp-clients.md) for client-specific configuration.

## 2. Give the advisor a narrow tool policy

Discover the live tool catalog with `tools/list`, then allow only the tools your product actually needs. A read-first advisor usually needs:

| Tool | Role | Moves funds? |
|------|------|--------------|
| `get_portfolio` | Current balances and USD values | No |
| `get_prices` | Current token prices | No |
| `list_chains` / `list_tokens` | Resolve supported assets | No |
| `list_wallet_policies` | Explain the managed-wallet guardrails | No |
| `get_quote` | Price a proposed rebalance | No |
| `simulate_swap` | Dry-run a quote and surface safety checks | No |
| `execute_swap` | Prepare an unsigned self-custody transaction | **No broadcast** |

Despite its historical name, MCP `execute_swap` does **not** execute a managed-wallet swap. It returns an unsigned transaction for a wallet to review, sign, and submit. A managed execution is a separate REST operation (`POST /v1/agent/swap/execute`) and should remain a visibly separate approval boundary in your product.

## 3. Use an advice -> quote -> preview -> approval flow

Give the model an instruction like:

> Analyze the portfolio and propose a rebalance. Never claim a trade is profitable. Show current allocation, target drift, quote expiry, minimum output, route fees/gas when available, and the expected post-trade allocation. Do not call `execute_swap` until I explicitly approve the exact quote. If approved, return the unsigned transaction and stop; never claim it was submitted.

A good conversation then has four distinct stages:

1. **Advice** — read portfolio and prices; calculate drift.
2. **Quote** — price the smallest trade that clears your rebalance threshold.
3. **Preview** — run `simulate_swap`, show costs and warnings, and re-check the quote if it is stale.
4. **Approval** — on an explicit human yes, optionally prepare the unsigned transaction. Signing is still outside the MCP server.

That state machine is easier to audit than giving a model a broad tool set and hoping the prompt carries the safety policy.

## 4. Make the advice economically useful

Do not rebalance just because a target moved by a percentage point. Compare the expected benefit with execution cost:

```text
estimated_net_improvement
  = expected_rebalance_benefit
  - route_fee
  - gas
  - expected_slippage
  - your_service_fee
```

Only propose a trade when the reason and the estimated costs are visible. Store the before/after allocation, quote ID, model recommendation, human approval, prepared transaction hash/id (if any), and eventual on-chain transaction hash supplied by the signing wallet.

## 5. Turn it into a product

The advisor is a good paid-agent pattern because customers can pay for the **intelligence and automation layer** without giving the model invisible custody. Common models are a monthly portfolio-monitoring subscription, a per-report/per-alert charge, or an automation tier with customer-specific policy limits.

Suwappu's own x402 metering pays for Suwappu API usage; it does not automatically charge your customer on your behalf. Keep your customer revenue ledger separate from Suwappu/API, model, gas, venue, and slippage costs. See [Build a Business on Suwappu](build-a-business.md) for the unit-economics template.

## Next steps

- [Portfolio Rebalancer](portfolio-rebalancer.md) — turn the same decision rule into a scheduled, preview-first worker.
- [Strategy Lifecycle](strategy-lifecycle.md) — backtest/replay, paper, and live gates.
- [MCP Protocol](../protocols/mcp.md) — live tool contract, costs, and response semantics.
