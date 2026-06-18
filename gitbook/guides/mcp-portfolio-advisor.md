# MCP Portfolio Advisor

Turn Suwappu's MCP server into a hands-on portfolio advisor inside Claude, Cursor, or any MCP client. Once connected, your agent can read live balances and prices, reason about allocation, and propose (or execute) rebalancing swaps — all through natural conversation.

## 1. Connect the MCP server

Add Suwappu to your MCP client's server config. In Claude Desktop, that's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "suwappu": {
      "command": "npx",
      "args": ["-y", "@suwappu/mcp"],
      "env": { "SUWAPPU_API_KEY": "suwappu_sk_YOUR_KEY" }
    }
  }
}
```

Get your API key from the [registration endpoint](../api-reference/registration.md). See the [MCP Protocol](../protocols/mcp.md) page for the full tool list and transport details.

## 2. Tools the advisor uses

The advisor flow leans on a few read tools plus the swap tools:

| Tool | Role in the advisor |
|------|---------------------|
| `get_portfolio` | Current holdings and USD values across every chain |
| `get_prices` | Live token prices for valuation and drift checks |
| `list_chains` / `list_tokens` | Resolve symbols and supported routes |
| `get_quote` | Price a proposed rebalancing swap before acting |
| `execute_swap` | Execute an approved quote (managed-wallet only) |

## 3. Example conversation

Once connected, you can simply ask:

> "Show my portfolio and tell me if I'm over-weight any single asset."

The agent calls `get_portfolio` + `get_prices`, then reasons over the result:

> Your portfolio is **$12,480**. ETH is **63%** of it — above a typical 40% target.
> To rebalance toward 40/30/30 ETH/USDC/SOL, I'd swap **~1.1 ETH → USDC**.
> Want me to quote it?

On approval, it calls `get_quote`, shows the route and gas, and — if you've enabled a managed wallet — `execute_swap` to settle it.

## 4. Keep it safe

Because the same MCP connection can execute swaps, scope it like any other agent credential:

- Use a dedicated API key with **wallet policy limits** (per-swap and daily caps) — see [Managed Wallets](./managed-wallets.md).
- Keep `execute_swap` behind an explicit human "yes" in the conversation; have the agent **quote first, execute second**.
- Review the [Authentication](../authentication/README.md) guardrails before pointing an autonomous advisor at a funded wallet.

## Next steps

- [Portfolio Rebalancer](./portfolio-rebalancer.md) — the same logic as a scheduled script instead of a chat.
- [MCP Protocol](../protocols/mcp.md) — full tool reference and client setup.
