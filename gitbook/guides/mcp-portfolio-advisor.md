# Build an MCP Portfolio Product

Build a portfolio product on Suwappu's hosted MCP server, from a one-shot report to a paid monitoring workspace. The useful product boundary is deliberate: let the model read balances, prices, policies, and quotes freely, then require explicit approval before it can even prepare a transaction.

Want runnable code first? [`suwappu-mcp-advisor`](https://github.com/0xSoftBoi/suwappu-mcp-advisor) contains matching TypeScript and Python examples. They keep a local tool allowlist, support modern `2026-07-28` discovery with a legacy fallback, and emit neutral research flags rather than pretending price moves are automatic buy/sell signals.

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

If you are building the client yourself, prefer an official MCP SDK in production. Suwappu supports the stateless `2026-07-28` request model and the legacy initialize path; [MCP Protocol](../protocols/mcp.md) documents both wire shapes for debugging and educational clients.

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

## 4. Make recommendations reproducible

Do not let a model's prose be your only record. Persist a compact evidence record for every report or alert:

```json
{
  "wallet": "0x...",
  "observed_at": "2026-08-07T14:00:00Z",
  "portfolio_value_usd": 12500,
  "allocation": { "ETH": 0.62, "USDC": 0.38 },
  "rules": ["concentration > 60%"],
  "flags": ["reduce_concentration"],
  "quote_id": null
}
```

The deterministic fields let you dedupe alerts, explain why the user was notified, replay decisions after a bug fix, and compare product versions without trusting model memory. For monitoring products, add hysteresis: for example, enter a concentration-alert state above one threshold and clear it only below a lower threshold. That avoids notifying a customer every poll when a value oscillates around one boundary.

## 5. Make the advice economically useful

Do not rebalance just because a target moved by a percentage point. Compare the expected benefit with execution cost:

```text
estimated_net_improvement
  = expected_rebalance_benefit
  - route_fee
  - gas
  - expected_slippage
  - your_service_fee
```

Only propose a trade when the reason and the estimated costs are visible. Store the before/after allocation, quote ID, model recommendation, human approval, prepared transaction hash/id (if any), and eventual on-chain transaction hash supplied by the signing wallet. A price decline by itself is not evidence that an unheld asset should be bought; turn rules into neutral review flags and let the user's policy decide whether to request a quote.

## 6. Grow from a report into a product

Ship the smallest useful capability first, then charge for retained value:

| Stage | What the customer gets | Good activation signal |
|------|-------------------------|------------------------|
| Report | One reproducible portfolio review | First successful portfolio + price read |
| Monitor | Scheduled snapshots and deduplicated alerts | User keeps at least one monitor active |
| Workspace | Saved rules, history, evidence, exports | User returns to inspect or change policy |
| Approval | Quote + simulation attached to a flagged decision | User explicitly requests a quote/preview |

The product is the **intelligence, evidence, and workflow layer**; an approval feature does not need to hide custody inside the model. Common revenue models are a monthly monitoring subscription, a per-report/per-alert charge, or a higher automation tier with customer-specific policy limits.

Measure activation and retention before optimizing model cleverness. Useful events include `first_report_completed`, `monitor_created`, `alert_opened`, `rule_changed`, `quote_requested`, and `preview_approved`. Avoid using trade volume or customer portfolio gains as a proxy for whether your product itself has retention.

## 7. Keep builder economics separate from customer P&L

Suwappu's own x402 metering pays for Suwappu API usage; it does not automatically charge your customer on your behalf. Keep your customer revenue ledger separate from Suwappu/API, model, gas, venue, and slippage costs. See [Build a Business on Suwappu](build-a-business.md) for the unit-economics template.

As a current illustrative pay-per-call calculation, `get_portfolio` and `get_prices` are 1 credit each and 1 credit is approximately $0.001. Polling both every 15 minutes is 2 calls × 96 polls/day × 30 days = 5,760 credits, or about **$5.76 per monitored wallet-month** before model, storage, notification, support, and payment-processing costs. Active Suwappu subscription tiers can bypass per-call metering, so re-check [Pricing](../billing/pricing.md) before using this example in a forecast.

Your builder contribution margin can be modeled separately:

```text
builder_contribution_margin
  = customer_revenue
  - Suwappu/API cost
  - model cost
  - storage + notifications + hosting
  - payment processing + variable support
```

Customer trading or lending P&L is a different ledger. Do not count it as your revenue, do not promise it as product ROI, and do not hide route fees, gas, slippage, or venue risk inside the builder-margin calculation.

## Next steps

- [Portfolio Rebalancer](portfolio-rebalancer.md) — turn the same decision rule into a scheduled, preview-first worker.
- [Strategy Lifecycle](strategy-lifecycle.md) — backtest/replay, paper, and live gates.
- [MCP Protocol](../protocols/mcp.md) — live tool contract, costs, and response semantics.
