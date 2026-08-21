# Build on Suwappu: MCP, SDK, REST, and A2A

Suwappu exposes the same agent platform through four deliberately different surfaces. Pick the one whose capability and custody model matches your product instead of treating their method names as interchangeable.

| Surface | Best for | Transaction boundary |
| --- | --- | --- |
| Hosted MCP | Agent/tool discovery, structured reads, simulation, perps, predictions, lending | `execute_swap` prepares an unsigned self-custody transaction |
| TypeScript/Python SDK | Application code over the agent REST API | Explicit self-custody prepare vs managed execution |
| Agent REST | Lowest-level, explicit integration | `/swap` prepares; `/swap/execute` is managed execution |
| A2A | Natural-language quotes/prices/discovery | No A2A execution method today |

The current chain set changes as integrations land. Discover it with MCP `list_chains`, SDK `listChains()` / `list_chains()`, or `GET /v1/agent/chains` rather than copying a count into your app.

## Get an API key

Register an agent:

```bash
curl -X POST https://api.suwappu.bot/v1/agent/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-agent"}'
```

The API returns a `suwappu_sk_...` credential. Store it as `SUWAPPU_API_KEY` and never commit it.

Some MCP discovery and public read tools work without a key; agent-scoped data and managed capabilities require authentication.

---

## Hosted MCP

Use the hosted endpoint whenever your client supports Streamable HTTP:

```text
https://api.suwappu.bot/mcp
```

Authenticated clients send:

```text
Authorization: Bearer $SUWAPPU_API_KEY
```

Source `0.6.0` supports modern MCP `2026-07-28` plus the existing `2024-11-05`, `2025-03-26`, and `2025-06-18` legacy path. Prefer the modern stateless revision: each request carries `params._meta.io.modelcontextprotocol/protocolVersion` and `clientCapabilities`, with matching `MCP-Protocol-Version` / `Mcp-Method` HTTP headers (`Mcp-Name` is also required for tool, resource, and prompt calls that name a target). Modern clients probe with `server/discover`; they do **not** initialize a session.

Legacy clients can continue to negotiate with `initialize` and `notifications/initialized`; the legacy handshake's newest supported revision remains `2025-06-18`. If you are writing a production client instead of configuring an MCP host, prefer the official MCP SDK's dual-era negotiation rather than maintaining the wire protocol yourself.

### Client configuration

OpenClaw:

```bash
openclaw mcp add suwappu --url https://api.suwappu.bot/mcp \
  --transport streamable-http \
  --header "Authorization=Bearer $SUWAPPU_API_KEY" --exclude execute_swap
```

Cursor — `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "headers": {
        "Authorization": "Bearer suwappu_sk_..."
      }
    }
  }
}
```

VS Code — `.vscode/mcp.json`:

```json
{
  "servers": {
    "suwappu": {
      "type": "http",
      "url": "https://api.suwappu.bot/mcp",
      "headers": {
        "Authorization": "Bearer ${input:suwappu_key}"
      }
    }
  }
}
```

Cline — `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "transportType": "streamableHttp",
      "headers": {
        "Authorization": "Bearer suwappu_sk_..."
      }
    }
  }
}
```

### Current 22-tool catalog

Call `tools/list` at runtime; the table is a map, not a client-side registry to copy.

| Area | Tools |
| --- | --- |
| Core read/quote | `get_quote`, `get_portfolio`, `get_prices`, `list_chains`, `list_tokens`, `get_tempo_tokens`, `browse_mpp_directory` |
| Simulation | `simulate_swap` |
| Unsigned transaction preparation | `execute_swap` |
| Predictions | `predict_markets`, `predict_market`, `predict_book`, `predict_price`, `predict_trades` |
| Perps | `perps_markets`, `perps_quote`, `perps_positions` |
| Lending | `lend_markets`, `lend_market` |
| Managed swap observability | `get_swap_status`, `get_swap_history` |
| Wallet policy | `list_wallet_policies` |

The endpoint also exposes MCP resources and prompts. Discover them with
`resources/list` / `resources/read` and `prompts/list` / `prompts/get`.

### Public MCP surface

These lifecycle/discovery methods are public:

- `server/discover` (modern)
- `initialize`
- `tools/list`
- `resources/list` / `resources/templates/list` / `resources/read`
- `prompts/list` / `prompts/get`
- `notifications/initialized` (legacy)

These four tool calls are also public:

- `list_chains`
- `list_tokens`
- `get_tempo_tokens`
- `browse_mpp_directory`

Everything else should be treated as authenticated unless discovery says otherwise.

### MCP result handling

A robust client should:

1. Check the JSON-RPC envelope for `error`.
2. On `2026-07-28`, require/handle `resultType`; `complete` is final and `input_required` would require a multi-round-trip retry. Suwappu's current handlers complete in one round trip.
3. Check a successful `tools/call` result for `isError: true`.
4. Prefer `structuredContent` when the tool declares an `outputSchema`.
5. Fall back to text content for tools that do not yet expose structured output.
6. Honor `ttlMs` / `cacheScope` on modern catalog and resource responses instead of rediscovering on every turn.
7. Treat `annotations` as descriptive behavioral hints, **not authorization**.
8. Intersect discovered tools with an application-owned allowlist before calling them.

### Important: MCP `execute_swap` prepares, it does not execute

The historical tool name is easy to misread. MCP `execute_swap` consumes a cached quote and returns an **unsigned** transaction for the caller to review and sign. It does not call the managed execution route and it does not create a managed swap record.

Managed server-side execution is:

```text
POST /v1/agent/swap/execute
```

That distinction is why `get_swap_status` / `get_swap_history` describe managed swap records, not every self-custody transaction an MCP client may later broadcast itself.

---

## `@suwappu/mcp-server` for stdio clients

Repository source `0.6.0` is a thin stdio bridge with no local Suwappu catalog. It forwards tools, resources, prompts, and the hosted auth policy.

The latest npm release is currently `0.1.1`, so prefer hosted MCP until the `0.6.0` forwarding bridge is published. See [the package README](../packages/mcp-server/README.md) for source-build instructions.

This version boundary matters: do not document an unpublished package version as if `npx` can already install it.

---

## TypeScript SDK

Repository source is `@suwappu/sdk` `0.6.0`; the latest npm release is currently `0.4.0`. The source API is ahead of npm while the next release is being prepared.

Read-only start:

```ts
import { Suwappu } from "@suwappu/sdk";

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY });
const quote = await client.getQuote({
  from: "USDC",
  to: "ETH",
  chain: "base",
  amount: "100",
});
console.log(quote.toAmount);
```

Source `0.6.0` separates custody explicitly:

```ts
// Self-custody: returns unsigned transaction data.
await client.prepareSwap({ quoteId, walletAddress });

// Managed wallet: server-side execution.
await client.executeManagedSwap(quoteId);
```

Legacy `swap()` and `executeSwap()` remain managed-execution aliases for compatibility. New code should use the explicit names.

See [packages/sdk/README.md](../packages/sdk/README.md).

---

## Python SDK

The Python SDK is source-only today; there is no current PyPI `suwappu` release.

Install from the repository (pin a commit SHA in production):

```bash
pip install "suwappu @ git+https://github.com/0xSoftBoi/suwappubot.git@main#subdirectory=packages/sdk-python"
```

Current source exposes the same custody split:

```python
# Self-custody, unsigned.
await client.prepare_swap(quote_id=quote.quote_id, wallet_address=wallet)

# Managed wallet execution.
await client.execute_managed_swap(quote.quote_id)
```

`execute_swap()` remains a backwards-compatible managed alias.

See [packages/sdk-python/README.md](../packages/sdk-python/README.md).

---

## Agent REST custody map

| Action | Method/path | Moves funds by itself? |
| --- | --- | --- |
| Quote | `POST /v1/agent/quote` | No |
| Simulate | `POST /v1/agent/swap/simulate` | No |
| Prepare self-custody tx | `POST /v1/agent/swap` | No — unsigned |
| Managed execution | `POST /v1/agent/swap/execute` | Yes, through the managed-wallet pipeline |
| Managed status | `GET /v1/agent/swap/status/:swapId` | No |
| Managed history | `GET /v1/agent/swaps` | No |

For money-moving products, make the managed-execution capability an explicit user/application opt-in and simulate before execution.

---

## A2A 0.3

Discover the public Agent Card:

```bash
curl https://api.suwappu.bot/.well-known/agent.json
```

Authenticated natural-language messages use JSON-RPC at:

```text
https://api.suwappu.bot/a2a
```

Example:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "kind": "message",
      "role": "user",
      "parts": [
        {
          "kind": "text",
          "type": "text",
          "text": "swap 0.5 ETH to USDC on base"
        }
      ]
    }
  }
}
```

Today that `swap ...` language returns a **quote**. A2A has no execution method. Current natural-language capabilities are quote, prices, chain discovery, token discovery/hints, portfolio integration hints, and help.

Task lookup/cancel uses A2A 0.3 `params.id`; the server accepts legacy `taskId` for compatibility.

See the dedicated [natural-language CLI](https://github.com/0xSoftBoi/suwappu-natural-language-cli) for TypeScript and Python examples.

---

## Framework examples

- [LangChain](https://github.com/0xSoftBoi/suwappu-langchain) — current data/simulation tools; managed execution excluded by default.
- [CrewAI](https://github.com/0xSoftBoi/suwappu-crewai-crew) — current Python source SDK; execution requires explicit CLI + environment opt-in.
- [MCP advisor](https://github.com/0xSoftBoi/suwappu-mcp-advisor) — small MCP client with a local four-tool allowlist.
- [Natural-language A2A CLI](https://github.com/0xSoftBoi/suwappu-natural-language-cli) — A2A 0.3 quote/discovery reference.
- [OpenClaw](../packages/openclaw/SKILL.md) — native MCP integration.

## Security baseline for builders

- Keep `SUWAPPU_API_KEY` out of source and logs.
- Start with a local read-only/tool allowlist.
- Never grant execution merely because a discovered tool annotation looks safe.
- Bind quotes/simulations to the wallet that will actually be used.
- Simulate unfamiliar routes before enabling managed execution.
- Keep self-custody signing code separate from managed execution code.
- Treat AI-generated trade ideas as untrusted input to your policy layer, not authorization.
