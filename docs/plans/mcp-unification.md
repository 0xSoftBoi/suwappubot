# MCP unification: status and remaining plan

Companion to `docs/research/mcp-state-2026-08.md`. Refreshed 2026-08-07 after the catalog/bridge work and the hosted `2026-07-28` protocol implementation.

## What is now structurally true

Suwappu has one hosted MCP catalog. The stdio package is a transport bridge, not a second product.

| Layer | Authority / status |
|---|---|
| Runtime validation | Zod validators in `api-ts/src/routes/validators.ts` where a route has one |
| Hosted MCP catalog | `api-ts/src/routes/mcpTools.ts` |
| Hosted handlers | `api-ts/src/routes/mcp.ts` |
| OpenAPI | Generated/checked from the Agent API source contract |
| Source stdio package | `packages/mcp-server`: forwards hosted tools/resources/prompts; owns no Suwappu catalog |

Two invariants matter more than raw tool count:

1. A constraint advertised to an MCP client must match what the handler actually enforces.
2. A new hosted tool must become visible to the stdio bridge without copying its definition into a second file.

The second invariant is solved by architecture. The first is only partially solved and remains the main contract-quality project.

## Completed work

### One catalog across transports

Source `@suwappu/mcp-server` `0.6.0` forwards `tools/list`, `tools/call`, resources, and prompts to the hosted endpoint. Its source dependency was moved to the `@modelcontextprotocol/sdk` v1 compatibility line at `^1.30.0`.

This eliminates the old 11-vs-22 hand-maintained catalog divergence. The remaining distribution issue is that npm still reports package `0.1.1`; source `0.6.0` must be published before registries/docs advertise it as installable.

### Dual-era hosted protocol

Hosted source now supports stateless MCP `2026-07-28` plus the existing initialize-based legacy path through `2025-06-18`:

- `server/discover`
- per-request protocol/capability metadata
- matching Streamable HTTP protocol/method/name headers
- `resultType: "complete"` and server identity on modern results
- cache hints on cacheable catalog/resource results
- explicit HTTP 403 for invalid `Origin`
- legacy `initialize` retained without pretending the modern revision has a session

### Contract checks are in CI

`bun run check:mcp` verifies each MCP input schema that is mapped to a runtime Zod validator. The TypeScript quality workflow runs this alongside the OpenAPI drift check.

Today the mapping covers `get_quote`, `simulate_swap`, and `perps_quote`. The script reports the rest as coverage debt rather than pretending hand-written schemas are derived.

### Structured output started conservatively

`list_chains`, `get_prices`, and `get_tempo_tokens` declare `outputSchema`, and their handlers attach `structuredContent` derived from the exact JSON value exposed in text. That is **3/22**, not completion.

## Remaining work, in priority order

### 1. Publish the forwarding bridge

Release `@suwappu/mcp-server` from source `0.6.0` with tests/provenance, confirm the registry reports that exact version, then restore the stdio package entry in `packages/openclaw/server.json`.

Before restoring the MCP Registry package entry:

- `npm view @suwappu/mcp-server version` must return the intended release.
- The npm package must carry `mcpName: "bot.suwappu/mcp"`.
- A source/installed smoke test must show hosted `tools/list` parity.

### 2. Drive input-schema coverage toward 22/22

Do not hand-copy constraints. For each unmapped tool:

1. Identify or create the Zod schema actually used by its handler.
2. Make runtime validation consume that schema.
3. Derive the MCP `inputSchema` from the same object.
4. Add it to the independent `check-mcp-schemas.ts` mapping.

Prioritize money-adjacent/request-sensitive tools first: quote/simulation is already mapped; next review transaction preparation, lending/perps inputs, prediction IDs/limits, and wallet policy inputs.

### 3. Expand validated output schemas

Highest-value next candidates are `get_portfolio`, `get_quote`, `simulate_swap`, lending, perps, and prediction-market detail. Require a captured/handler-derived fixture and a regression test before publishing an `outputSchema`; a wrong schema is worse than no schema because clients are entitled to validate `structuredContent` against it.

### 4. Move the local bridge to official TypeScript SDK v2 when useful

The hosted server already speaks the modern era. The stdio bridge still uses the v1 compatibility package locally. Official TypeScript SDK v2 is the `2026-07-28` line and supports explicit dual-era negotiation. Migrate the bridge when modern stdio behavior/conformance is valuable; do not reintroduce local Suwappu tool definitions during that migration.

### 5. Make the authorization decision explicitly

The hosted MCP surface uses Agent API Bearer keys. OAuth/scoped remote authorization is a product/security decision because it changes consent, scopes, credential lifecycle, and the boundary around managed execution. Design and threat-review it before implementation.

### 6. Optimize context only after measuring it

Projection controls such as `response_format: concise | detailed` may help `get_portfolio`, `predict_markets`, `perps_markets`, and `list_tokens`, but add them only when agent traces show a real context-cost problem. Stable structured fields and correct capability boundaries rank higher.

## Verification gates

For MCP contract changes:

```bash
cd api-ts
bun run check
bun run check:mcp
bun run check:openapi
bun run test

cd ../showcase
node scripts/regen-docs.mjs
node scripts/gen-llms.mjs
node scripts/check-doc-contract.mjs
```

Money-adjacent changes additionally need adversarial review of authorization, metering order, idempotency/retry behavior, and the unsigned-preparation vs managed-execution boundary.

## Primary sources

- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [`server/discover`](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Official Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [Official MCP Registry](https://github.com/modelcontextprotocol/registry)
