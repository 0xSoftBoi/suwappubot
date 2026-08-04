# @suwappu/mcp-server

MCP server for [Suwappu](https://suwappu.bot) — cross-chain DEX for AI agents.

Swap tokens across 7+ chains from Claude Desktop, Cursor, Windsurf, or any MCP client.

## Quick Start

### 1. Get an API key

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
```

### 2. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "suwappu": {
      "command": "npx",
      "args": ["-y", "@suwappu/mcp-server"],
      "env": {
        "SUWAPPU_API_KEY": "suwappu_sk_your_key_here"
      }
    }
  }
}
```

### 3. Use it

Ask Claude: *"Get me a quote for swapping 0.5 ETH to USDC on Base"*

## Tools

| Tool | Description |
|------|-------------|
| `get_quote` | Swap quotes across 7+ chains |
| `get_portfolio` | Wallet balances across all chains |
| `get_prices` | Token prices with 24h change |
| `list_chains` | Supported chains |
| `list_tokens` | Tokens per chain |
| `execute_swap` | Execute a swap from a quote |

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `SUWAPPU_API_KEY` | Yes | — |
| `SUWAPPU_API_URL` | No | `https://api.suwappu.bot` |

## License

MIT
