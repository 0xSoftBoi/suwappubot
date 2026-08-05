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

This package intentionally ships **no tool definitions**. It is a stdio bridge:
it fetches the tool catalogue from the hosted endpoint at startup and forwards
calls to it.

That means the tools you get are always whatever `https://api.suwappu.bot/mcp`
currently serves — **22 at the time of writing**, spanning swaps, quotes and
simulation, portfolio and prices, perps, prediction markets, and lending. New
tools appear without updating this package.

To see the live list without installing anything:

```bash
curl -s -X POST https://api.suwappu.bot/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```

Earlier versions of this package hand-maintained their own catalogue, which
drifted to 11 tools with different names and arguments from the hosted server.
Holding zero definitions makes that class of bug impossible rather than merely
fixed.

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `SUWAPPU_API_KEY` | To call tools | — | Listing tools works without it |
| `SUWAPPU_API_URL` | No | `https://api.suwappu.bot` | Point at a dev deployment |

## License

MIT
