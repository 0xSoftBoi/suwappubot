# Add Suwappu to any AI agent (one config)

Suwappu is a hosted **MCP server** — any MCP-capable client can swap/quote/track across 14 chains.
Two ways in: the **hosted endpoint** (no install) or the **npm package** (stdio). Read-only is the
default; `execute_swap` is opt-in.

First, get a free key:
```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H 'Content-Type: application/json' -d '{"name":"my-agent"}'   # -> suwappu_sk_...
```

## OpenClaw
```bash
openclaw mcp add suwappu --url https://api.suwappu.bot/mcp \
  --transport streamable-http \
  --header "Authorization=Bearer $SUWAPPU_API_KEY" --exclude execute_swap
```

## Cursor — `~/.cursor/mcp.json`
```json
{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "headers": { "Authorization": "Bearer suwappu_sk_..." }
    }
  }
}
```

## VS Code (Copilot agent mode) — `.vscode/mcp.json`
```json
{
  "servers": {
    "suwappu": {
      "type": "http",
      "url": "https://api.suwappu.bot/mcp",
      "headers": { "Authorization": "Bearer ${input:suwappu_key}" }
    }
  }
}
```

## Cline — `cline_mcp_settings.json`
```json
{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "transportType": "streamableHttp",
      "headers": { "Authorization": "Bearer suwappu_sk_..." }
    }
  }
}
```

## Claude Desktop — `claude_desktop_config.json` (stdio via the npm package)
```json
{
  "mcpServers": {
    "suwappu": {
      "command": "npx",
      "args": ["-y", "@suwappu/mcp-server"],
      "env": { "SUWAPPU_API_KEY": "suwappu_sk_..." }
    }
  }
}
```

## LangChain / CrewAI / A2A
Use the dedicated toolkits instead of raw MCP:
[`@suwappu/langchain-suwappu`](https://github.com/0xSoftBoi/suwappu-langchain) ·
[`suwappu-crewai-crew`](https://github.com/0xSoftBoi/suwappu-crewai-crew) ·
[A2A agent-card](https://api.suwappu.bot/a2a)

---

### Tools
`get_quote` · `get_prices` · `get_portfolio` · `list_chains` · `list_tokens` · `get_tempo_tokens` ·
`browse_mpp_directory` · `predict_markets` / `predict_market_detail` · `execute_swap` *(gated)*

### Safety
Read-only by default. Enable `execute_swap` only on a dedicated trading agent. Non-custodial
(Turnkey TEE); server-side 2FA + spending limits + tx-simulation. Never commit `SUWAPPU_API_KEY`.
