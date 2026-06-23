# OpenClaw Integration

[OpenClaw](https://openclaw.ai) is the largest open-source AI-agent framework (60k+ stars, native
Telegram / WhatsApp / Discord / Slack). It consumes MCP servers directly, so adding Suwappu needs
**no wrapper code** — unlike the LangChain/CrewAI toolkits, it's a single CLI command.

## Quick start

```bash
# 1. Get a free API key
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" -d '{"name":"my-openclaw"}'
export SUWAPPU_API_KEY=suwappu_sk_...

# 2. Add Suwappu to OpenClaw (read-only by default — execute_swap excluded)
openclaw mcp add suwappu \
  --url https://api.suwappu.bot/mcp \
  --transport streamable-http \
  --header "Authorization=Bearer $SUWAPPU_API_KEY" \
  --exclude execute_swap

# 3. Verify
openclaw mcp probe suwappu        # lists the loaded tools
```

Your agent can now quote, price, and check portfolios across 14 chains over any channel:

> **User (Telegram):** quote 0.5 ETH to USDC on Base
> **Agent:** 0.5 ETH → ~860 USDC on Base via OKX (price impact 0.96%, gas ~$0.01).

## Tools exposed

| Tool | Type | Description |
|------|------|-------------|
| `get_quote` | read | Best route, price impact, gas, fees, expiry |
| `get_prices` | read | USD price + 24h change |
| `get_portfolio` | read | Balances + USD values across chains |
| `list_chains` / `list_tokens` | read | Supported chains / popular tokens |
| `get_tempo_tokens` | read | Trending tokens |
| `browse_mpp_directory` | read | Market / provider directory |
| `predict_markets` / `predict_market_detail` | read | Prediction markets |
| `execute_swap` | **write** | Execute a quoted swap — **gated** (see below) |

## Enabling swap execution safely

Keep execution off the general agent. Put it on a dedicated trading agent with explicit
tool-allowlisting, mirroring the `suwappu-crewai-crew` Analyst → Risk → Executor split:

```jsonc
// agents.json
{
  "agents": {
    "research":  { "mcp": { "suwappu": { "include": ["get_quote","get_prices","get_portfolio"] } } },
    "trader":    { "mcp": { "suwappu": { "include": ["get_quote","execute_swap","get_portfolio"] } } }
  }
}
```

**Always** `get_quote` → show route/price-impact → get user confirmation → `execute_swap <quote_id>`,
preserving the `quote_id` for the audit trail. Suwappu also enforces 2FA, per-swap/hourly/daily
spending limits, and tx-simulation server-side, so these guardrails hold even if the model errs.

## Why it's safe by design

- **Read-only default** — `--exclude execute_swap` means a fresh install can never move funds.
- **Non-custodial** — keys live in Turnkey TEE enclaves; the agent never sees them.
- **Server-side limits** — spending caps + 2FA + simulation are enforced by Suwappu, not the agent.

## Status

Validated 2026-06-18 against the live endpoint: `openclaw mcp probe` loaded 9 tools and a local
model successfully executed `get_quote` end-to-end. See `packages/openclaw/PUBLISHING.md` for
publishing this to ClawHub and the MCP registry.
