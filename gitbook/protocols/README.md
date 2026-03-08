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

## npm Packages

| Package | Description |
|---------|-------------|
| [`@suwappu/mcp-server`](https://www.npmjs.com/package/@suwappu/mcp-server) | MCP server for Claude Desktop, Claude Code, Cursor (stdio transport) |
| [`@suwappu/sdk`](https://www.npmjs.com/package/@suwappu/sdk) | TypeScript SDK wrapping the REST API |
| [`@suwappu/langchain-suwappu`](https://www.npmjs.com/package/@suwappu/langchain-suwappu) | LangChain toolkit for building agents with Suwappu tools |

## Registry Listings

Suwappu is listed on the following agent/tool registries:

| Registry | Protocol | Status |
|----------|----------|--------|
| [awesome-a2a](https://github.com/ai-boost/awesome-a2a) | A2A | Listed ([PR #36](https://github.com/ai-boost/awesome-a2a/pull/36)) |
| [Smithery.ai](https://smithery.ai) | MCP | Pending submission |
| [mcpservers.org](https://mcpservers.org) | MCP | Planned |
| [StackA2A](https://stacka2a.dev) | A2A | Planned |
| [a2aregistry.org](https://a2aregistry.org) | A2A | Registered |

### Future Registry Submissions

The following registries require manual web form submission:

- **Smithery.ai** — Submit at [smithery.ai/new](https://smithery.ai/new). The `smithery.yaml` config is already in the repo at `packages/mcp-server/smithery.yaml`.
- **mcpservers.org** — Submit at [mcpservers.org/submit](https://mcpservers.org/submit). Also covers the awesome-mcp-servers GitHub list.
- **mcpserverdirectory.org** — Submit at [mcpserverdirectory.org/submit](https://mcpserverdirectory.org/submit).
- **StackA2A** — Submit at [stacka2a.dev/submit-agent](https://stacka2a.dev/submit-agent).
- **a2aagentlist.com** — Email gal6111@gmail.com with agent details.
- **a2aregistry.org** — API registration:
  ```bash
  curl -X POST "https://a2aregistry.org/api/agents/register" \
    -H "Content-Type: application/json" \
    -d '{"wellKnownURI": "https://api.suwappu.bot/.well-known/agent.json"}'
  ```

See the individual protocol guides for full details:

- [A2A Protocol](a2a.md)
- [MCP Protocol](mcp.md)
- [Agent Card](agent-card.md)
- [OpenAPI Spec](openapi.md)
