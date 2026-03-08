# Protocol Comparison: REST vs A2A vs MCP

Suwappu exposes three protocols for interacting with the DEX. All three share the same authentication mechanism and provide access to the same underlying capabilities --- swaps, quotes, portfolio checks, price lookups, and token/chain discovery.

## Comparison Table

| Feature | REST API | A2A Protocol | MCP Protocol |
|---------|----------|-------------|-------------|
| Transport | HTTP | JSON-RPC 2.0 over HTTP | JSON-RPC 2.0 over HTTP |
| Endpoint | `/v1/agent/*` | `/a2a` | `/mcp` |
| Auth | Bearer token | Bearer token | Bearer token |
| Best for | Direct integration | Agent-to-agent communication | LLM tool use (Claude, etc.) |
| Discovery | OpenAPI spec | Agent card | `tools/list` |
| State | Stateless | Task-based (submit -> work -> complete) | Stateless tool calls |
| Message format | JSON request/response | Natural language in, structured task out | Typed tool calls with JSON schemas |
| Streaming | No | No (push notifications supported) | No |

## When to Use Each

### REST API

Use the REST API when you are building a traditional integration --- a web app, a backend service, or a script that needs to call specific endpoints directly. You get fine-grained control over each request and predictable response shapes. The OpenAPI spec at `/v1/agent/openapi` enables code generation in any language.

**Good for:** Backend services, web frontends, mobile apps, CI/CD pipelines, any code-first integration.

### A2A Protocol

Use the A2A (Agent-to-Agent) protocol when you are building an AI agent that communicates with Suwappu as a peer. A2A uses natural language messages and returns structured task objects with lifecycle states. Your agent sends a message like "swap 0.5 ETH to USDC on base" and receives a task that transitions through `submitted -> working -> completed`.

**Good for:** Autonomous agents, multi-agent orchestration systems, agent frameworks (LangGraph, CrewAI, AutoGen).

### MCP Protocol

Use the MCP (Model Context Protocol) when you are connecting Suwappu to an LLM that supports MCP --- such as Claude Desktop, Claude Code, or any MCP-compatible client. The LLM discovers available tools via `tools/list` and calls them with typed arguments. No natural language parsing is needed; the LLM handles that.

**Good for:** Claude Desktop, Claude Code, Cursor, any MCP-compatible LLM client.

## Authentication

All three protocols require the same Bearer token. Obtain one by registering:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-agent",
    "description": "My trading agent",
    "webhook_url": "https://my-agent.example.com/webhook"
  }'
```

The response includes an `api_key` (prefixed `suwappu_sk_`). Use it as a Bearer token in the `Authorization` header for all subsequent requests, regardless of which protocol you choose:

```
Authorization: Bearer suwappu_sk_YOUR_KEY
```

## Quick Start by Protocol

| Protocol | First request |
|----------|--------------|
| REST | `GET /v1/agent/quote?from_token=ETH&to_token=USDC&amount=0.5&chain=base` |
| A2A | `POST /a2a` with `{"method":"message/send","params":{"message":{"role":"user","parts":[{"type":"text","text":"quote 0.5 ETH to USDC on base"}]}}}` |
| MCP | `POST /mcp` with `{"method":"initialize","params":{}}`, then `tools/list`, then `tools/call` |

See the individual protocol guides for full details:

- [A2A Protocol](a2a.md)
- [MCP Protocol](mcp.md)
- [Agent Card](agent-card.md)
- [OpenAPI Spec](openapi.md)
