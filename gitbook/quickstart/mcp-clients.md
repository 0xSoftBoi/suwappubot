# MCP Client Setup

Suwappu's MCP server is hosted remotely at `https://api.suwappu.bot/mcp` (JSON-RPC 2.0 over the MCP Streamable HTTP transport). There is no local process to install — point your MCP client at the URL and authenticate with your agent API key in the `Authorization` header. Get a key from [`POST /v1/agent/register`](../api-reference/registration.md) (public, no auth required).

All clients below use the same two things:

- **URL:** `https://api.suwappu.bot/mcp`
- **Header:** `Authorization: Bearer suwappu_sk_YOUR_KEY`

See the [MCP Protocol](../protocols/mcp.md) page for the full tool reference and credit costs, and [Agentic Payments](../billing/agentic-payments.md) for how pay-per-call billing works if you're on the free tier.

## Claude Code

Add the server with the CLI:

```bash
claude mcp add --transport http suwappu https://api.suwappu.bot/mcp \
  --header "Authorization: Bearer suwappu_sk_YOUR_KEY"
```

Or configure it directly in a project's `.mcp.json`:

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

Verify it's connected with `/mcp` inside a Claude Code session — you should see `suwappu` listed with its tools.

## Claude Desktop

Edit your `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "headers": {
        "Authorization": "Bearer suwappu_sk_YOUR_KEY"
      }
    }
  }
}
```

Restart Claude Desktop after saving. Ask Claude something like "what's the price of ETH and SOL?" to confirm the tools are discoverable.

## Cursor

Add a project-scoped `.cursor/mcp.json` (or the global `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "headers": {
        "Authorization": "Bearer suwappu_sk_YOUR_KEY"
      }
    }
  }
}
```

Open Cursor's MCP settings panel (Settings → MCP) to confirm the `suwappu` server shows a green status and lists its tools.

## Codex

Add the server to `~/.codex/config.toml`:

```toml
[mcp_servers.suwappu]
url = "https://api.suwappu.bot/mcp"

[mcp_servers.suwappu.http_headers]
Authorization = "Bearer suwappu_sk_YOUR_KEY"
```

**Timeout gotcha:** Codex's default MCP tool-call timeout is 60 seconds. Cross-chain quotes and unsigned swap preparation can occasionally take longer than that under upstream aggregator latency. Raise the tool timeout explicitly:

```toml
[mcp_servers.suwappu]
url = "https://api.suwappu.bot/mcp"
tool_timeout_sec = 120

[mcp_servers.suwappu.http_headers]
Authorization = "Bearer suwappu_sk_YOUR_KEY"
```

If `execute_swap` times out, get a fresh quote and prepare again. Despite its historical name, MCP `execute_swap` only prepares an **unsigned self-custody transaction**; it never signs, broadcasts, or creates a managed swap record. Do not use [`GET /v1/agent/swaps`](../api-reference/swap-history.md) to infer whether an MCP-prepared transaction was submitted — submission is owned by the wallet that signs it.

## OpenCode

Add the server under `mcp` in your OpenCode config (`opencode.json` or `~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "suwappu": {
      "type": "remote",
      "url": "https://api.suwappu.bot/mcp",
      "headers": {
        "Authorization": "Bearer suwappu_sk_YOUR_KEY"
      },
      "enabled": true
    }
  }
}
```

OpenCode discovers tools on startup — restart the session after editing the config, then ask it to list Suwappu's available tools to confirm the connection.

## Troubleshooting

- **401 / Unauthorized:** Your API key is missing, malformed, or was rotated. Re-check the `Authorization` header and confirm the key with [`GET /v1/agent/me`](../api-reference/agent-profile.md).
- **402 Payment Required:** You're on the free tier and out of prepaid credits. See [Agentic Payments](../billing/agentic-payments.md) for the topup/subscribe flow, or check your balance with `GET /v1/agent/billing`.
- **429 Too Many Requests:** You've hit your tier's rate limit. See [Rate Limits](../authentication/rate-limits.md).
- **Tool call times out:** Raise your client's MCP tool timeout (see the Codex gotcha above — most clients default to 30–60s, which is occasionally too tight for cross-chain quotes).
