# @suwappu/mcp-server

A thin stdio bridge to Suwappu's hosted MCP endpoint.

The bridge intentionally owns **zero Suwappu tool, resource, or prompt definitions**. It forwards discovery and calls to `https://api.suwappu.bot/mcp`, so the hosted endpoint stays the single source of truth.

> **Version check:** this repository describes bridge source `0.6.0`. Run
> `npm view @suwappu/mcp-server version` before installing. If the registry is
> behind, use the hosted endpoint for the current catalog.

## Prefer hosted MCP

Remote-capable MCP clients should connect directly:

```text
https://api.suwappu.bot/mcp
```

Authenticated calls use:

```text
Authorization: Bearer $SUWAPPU_API_KEY
```

Source `0.6.0` of the hosted server supports modern stateless MCP `2026-07-28` and retains the older initialize-based path through `2025-06-18` for compatibility. The source stdio bridge still uses the official TypeScript SDK v1 compatibility line locally; it forwards to the hosted endpoint, so the hosted catalog remains canonical.

## When you need stdio

Some clients still want a local stdio MCP process. Source `0.6.0` is a bridge for exactly that case:

```bash
git clone https://github.com/0xSoftBoi/suwappubot.git
cd suwappubot/packages/mcp-server
bun install
bun run build

SUWAPPU_API_KEY=suwappu_sk_... node dist/index.js
```

When npm reports `0.6.0` or newer, run the same bridge with `npx @suwappu/mcp-server`.

The bridge forwards tools, resources, and prompts. It also leaves authorization decisions to the hosted server, so anonymous public tool calls work over stdio instead of being blocked by a second hard-coded policy.

## Current hosted tool catalog

The hosted endpoint currently exposes 22 tools. Call `tools/list` at runtime rather than hard-coding this table into clients.

| Area | Tools | Capability |
| --- | --- | --- |
| Core data & discovery | `get_quote`, `get_portfolio`, `get_prices`, `list_chains`, `list_tokens`, `get_tempo_tokens`, `browse_mpp_directory` | Read/quote |
| Simulation | `simulate_swap` | Dry-run; never broadcasts |
| Transaction preparation | `execute_swap` | Builds an unsigned self-custody transaction |
| Predictions | `predict_markets`, `predict_market`, `predict_book`, `predict_price`, `predict_trades` | Read-only |
| Perps | `perps_markets`, `perps_quote`, `perps_positions` | Read-only |
| Lending | `lend_markets`, `lend_market` | Read-only |
| Managed swap observability | `get_swap_status`, `get_swap_history` | Read-only managed records |
| Wallet policy | `list_wallet_policies` | Read-only |

### The `execute_swap` name is historical

MCP `execute_swap` does **not** submit a managed swap. It consumes a cached quote and returns a transaction for the caller to review and sign.

Managed server-side execution is a separate REST capability:

```text
POST /v1/agent/swap/execute
```

Accordingly, `get_swap_status` and `get_swap_history` describe managed swap records. A self-custody transaction prepared through MCP does not become a managed record merely because it was prepared.

## Public discovery and calls

The MCP lifecycle/discovery methods are public:

- `server/discover` (modern hosted HTTP)
- `initialize`
- `tools/list`
- `resources/list` / `resources/templates/list` / `resources/read`
- `prompts/list` / `prompts/get`
- `notifications/initialized` (legacy)

Four `tools/call` targets are also public and zero-setup:

- `list_chains`
- `list_tokens`
- `get_tempo_tokens`
- `browse_mpp_directory`

Other tool calls require a Suwappu API key.

## Builder rules

- Treat `annotations` as behavioral hints, not authorization.
- Apply your own application capability policy after discovery.
- Check a tool result's `isError`; a JSON-RPC success envelope can still contain a failed tool result.
- Prefer `structuredContent` when a tool declares `outputSchema`, with text content as the compatibility fallback.
- Discover resources/prompts rather than assuming their names.
- Keep quote/read, simulation, unsigned preparation, and managed execution as distinct product permissions.

## Environment variables

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `SUWAPPU_API_KEY` | For authenticated calls | — | Public discovery/tools work without it |
| `SUWAPPU_API_URL` | No | `https://api.suwappu.bot` | Point the bridge at another deployment |

## License

MIT
