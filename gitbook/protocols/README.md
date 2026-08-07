# Protocols

Suwappu speaks three protocols over the same base URL (`https://api.suwappu.bot`) so your agent can integrate however it works best: a plain REST API, the Model Context Protocol (MCP) for LLM tool use, and the Agent-to-Agent (A2A) protocol for natural-language, agent-discoverable messaging. They share the same routing engine, but they intentionally expose different authority levels.

## The Three Protocols

| Protocol | Endpoint | Transport | Best for |
|----------|----------|-----------|----------|
| REST API | `https://api.suwappu.bot/v1/agent/*` | HTTP + JSON | Full product surface, including explicit managed execution endpoints |
| MCP | `POST https://api.suwappu.bot/mcp` | JSON-RPC 2.0 | Discoverable tools; swap preparation is self-custody and unsigned |
| A2A | `POST https://api.suwappu.bot/a2a` | JSON-RPC 2.0 | Quote, price, and discovery conversations; no trade execution |

## When to Use Each

### REST API

Use the REST API when you control the client and need the most complete surface: quotes, swap simulation, self-custody preparation, managed swap execution, managed wallets, prediction-market orders, HyperLiquid market/quote/position reads, Morpho market reads, webhooks, and swap history.

```bash
curl -X POST https://api.suwappu.bot/v1/agent/quote \
  -H "Authorization: Bearer suwappu_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from_token": "ETH", "to_token": "USDC", "amount": "0.5", "chain": "base"}'
```

See the [API Reference](../api-reference/README.md) for the full endpoint list.

### MCP (Model Context Protocol)

Use MCP when an LLM client should discover and call Suwappu's capabilities as tools. Source `0.6.0` exposes **22 tools** over JSON-RPC 2.0; call `tools/list` at runtime instead of hard-coding the inventory. MCP `execute_swap` is a historical name for unsigned transaction preparation — it does not submit a managed swap. Claude Desktop, Claude Code, Cursor, Codex, OpenCode, and other MCP clients can discover the surface automatically.

See [MCP](mcp.md) for the handshake, tool reference, and pay-per-call costs, or [MCP Client Setup](../quickstart/mcp-clients.md) for exact config snippets per client.

### A2A (Agent-to-Agent)

Use A2A when another agent should talk to Suwappu in natural language. A swap-like message such as `"swap 0.5 ETH to USDC on base"` produces a quote artifact; it does **not** sign or broadcast a transaction. Treat A2A as the intent/quote layer and hand an approved quote to an explicit REST or MCP self-custody flow if execution is desired. Suwappu publishes an [A2A agent card](agent-card.md) at `/.well-known/agent.json` so other agents can discover it without prior knowledge.

See [A2A Protocol](a2a.md) for the JSON-RPC methods and message format.

## Authentication

Authenticated REST calls, stateful/paid MCP tools, and all A2A methods use the same Bearer token. The read-only lending REST routes are public. MCP lifecycle/discovery plus `list_chains`, `list_tokens`, `get_tempo_tokens`, and `browse_mpp_directory` are intentionally public so clients can discover Suwappu before authenticating. Register once when you need an authenticated surface:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
# Response: { "success": true, "api_key": "suwappu_sk_..." }
```

Then send `Authorization: Bearer suwappu_sk_YOUR_KEY` on authenticated calls. Never infer authentication or execution authority from an MCP tool annotation alone; the server remains the authority boundary.

## Discovery

Suwappu is built to be found by agents automatically. See [OpenAPI Spec](openapi.md) for the discovery files (`llms.txt`, `llms-full.txt`, `agent.json`, OpenAPI) and how agents bootstrap from them.

For crawlers that don't want to guess well-known paths one at a time, `GET https://api.suwappu.bot/.well-known/ai-catalog.json` returns a single [Agentic Resource Discovery (ARD)](https://agenticresourcediscovery.org/spec) v0.9 manifest listing every resource above (A2A agent card, MCP server, OpenAPI spec, `llms.txt`) with its media type and URL. Suwappu's MCP server is also listed in the official [MCP registry](https://registry.modelcontextprotocol.io) under the domain-verified `bot.suwappu/mcp` namespace — see [MCP](mcp.md#mcp-registry-listing) for the manifest and publishing steps.

## Pricing

REST, MCP, and A2A calls are all subject to the same rate limits and pay-per-call metering. See [Pricing](../billing/pricing.md) for the tier table and [Agentic Payments](../billing/agentic-payments.md) for the x402 402-challenge flow.
