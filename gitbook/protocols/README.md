# Protocols

Suwappu speaks three protocols over the same base URL (`https://api.suwappu.bot`) so your agent can integrate however it works best: a plain REST API, the Model Context Protocol (MCP) for LLM tool use, and the Agent-to-Agent (A2A) protocol for natural-language, agent-discoverable messaging. All three are backed by the same routing engine, managed wallets, and authentication.

## The Three Protocols

| Protocol | Endpoint | Transport | Best for |
|----------|----------|-----------|----------|
| REST API | `https://api.suwappu.bot/v1/agent/*` | HTTP + JSON | Custom backends, SDKs, full control over every endpoint |
| MCP | `POST https://api.suwappu.bot/mcp` | JSON-RPC 2.0 | LLM clients (Claude Desktop, Cursor, Claude Code) that call tools |
| A2A | `POST https://api.suwappu.bot/a2a` | JSON-RPC 2.0 | Agent-to-agent orchestration and natural-language messages |

## When to Use Each

### REST API

Use the REST API when you control the client and want explicit, typed access to every capability — quotes, swaps, managed wallets, perps, prediction markets, lending, webhooks, and swap history. This is the lowest-level and most complete surface.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from_token": "ETH", "to_token": "USDC", "amount": "0.5", "chain": "base"}'
```

See the [API Reference](../api-reference/README.md) for the full endpoint list.

### MCP (Model Context Protocol)

Use MCP when an LLM client should discover and call Suwappu's capabilities as tools. The MCP endpoint exposes ten tools (get_quote, execute_swap, get_portfolio, get_prices, list_chains, list_tokens, get_tempo_tokens, browse_mpp_directory, predict_markets, predict_market_detail) over JSON-RPC 2.0. Claude Desktop, Cursor, and other MCP clients pick them up automatically.

See [MCP](mcp.md) for the handshake, tool reference, and client configuration.

### A2A (Agent-to-Agent)

Use A2A when another agent should talk to Suwappu in natural language. You send a message like `"swap 0.5 ETH to USDC on base"` and receive a task with structured artifacts. Suwappu publishes an [A2A agent card](agent-card.md) at `/.well-known/agent.json` so other agents can discover it without prior knowledge.

See [A2A Protocol](a2a.md) for the JSON-RPC methods and message format.

## Authentication

REST, MCP, and A2A all use the same Bearer token. Register once to get a key:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
# Response: { "success": true, "api_key": "suwappu_sk_..." }
```

Then send `Authorization: Bearer suwappu_sk_YOUR_KEY` on every request. The only public, unauthenticated endpoints are agent discovery (`/register`, `/v1/agent/chains`, `/v1/agent/openapi`, `/.well-known/agent.json`, `/llms.txt`).

## Discovery

Suwappu is built to be found by agents automatically. See [OpenAPI Spec](openapi.md) for the discovery files (`llms.txt`, `agent.json`, OpenAPI) and how agents bootstrap from them.
