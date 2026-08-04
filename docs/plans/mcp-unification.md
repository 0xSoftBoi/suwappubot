# Plan: one contract, every agent surface

Companion to `docs/research/mcp-state-2026-08.md`. That document says *what* is
wrong. This one says *how* to fix it, and argues for a specific design over the
obvious alternatives.

## The actual root cause

The 11-vs-22 tool divergence and the stale protocol version are symptoms. The
disease is that **the same contract is written down four times**, by hand, in
four places:

| # | Where | Status |
|---|---|---|
| 1 | `api-ts/src/routes/validators.ts` — 77 Zod schemas | **Runtime truth.** What the server actually enforces. |
| 2 | `openapi-agent.json` | **Already generated from #1** via `z.toJSONSchema()` — `scripts/gen-openapi.ts` |
| 3 | `api-ts/src/routes/mcp.ts` — 22 hand-written `inputSchema` blocks | **Drifted.** 0 uses of Zod. |
| 4 | `packages/mcp-server/src/index.ts` — 11 hand-written tools | **Diverged.** A different product. |

We already solved this problem once, correctly, for OpenAPI. `gen-openapi.ts`
exists precisely so "the documented request shapes can never drift from runtime
validation." **The fix is to finish the job we started** — point the same
pipeline at MCP — not to invent a new mechanism.

### The drift is real, not theoretical

Verified live against `api.suwappu.bot/mcp` on 2026-08-04:

| Field | Zod enforces | MCP advertises |
|---|---|---|
| `get_quote.slippage` | `number().min(0).max(0.5)` | `{type: "number"}` — **no bounds** |
| `get_quote.wallet_address` | validated EVM address | `{type: "string"}` — anything |

An agent that reads our schema and sends `slippage: 5` gets a 400 it had no way
to anticipate. We published a contract we do not honour. Also: **0 of 22 tools
declare `outputSchema`**, so every result is unstructured prose.

## Design decision: three options considered

**Option A — hand-fix the schemas.** Copy the constraints across, bump the
protocol, resync the npm tools. Rejected: it fixes today's drift and guarantees
tomorrow's. Four hand-maintained copies remain four.

**Option B — generate MCP from the OpenAPI spec** (the `openapi-mcp-generator` /
Kubb approach the ecosystem favours). Rejected *for us*: our OpenAPI file is
itself a derived artifact with hand-authored prose. Generating a derivative of a
derivative doubles the lag and means MCP inherits documentation drift instead of
runtime truth. Good pattern when OpenAPI *is* your source; ours is not.

**Option C — Zod as the single source, MCP and OpenAPI both derived.** Chosen.
It reuses a pipeline already proven in this repo, and it points every surface at
the thing that actually runs.

## The design

### One registry, four surfaces

Today a tool's contract is scattered. Instead, each tool declares itself once:

```ts
defineTool({
  name: 'get_quote',
  description: '…',
  input: QuoteRequestSchema,      // the SAME Zod object the route validates with
  output: QuoteResponseSchema,    // new — gives us outputSchema + structuredContent
  annotations: { readOnlyHint: true },
  handler: …,
})
```

From that one declaration we emit:

1. **MCP `tools/list`** — `inputSchema`/`outputSchema` via `z.toJSONSchema()`
2. **OpenAPI** — the existing generator, unchanged in spirit
3. **Runtime validation** — the route already uses this schema
4. **SDK methods** — TS and Python clients target the same shapes

Constraints (`min`/`max`, address formats) reach agents automatically, because
they are the constraints the server enforces. Drift stops being a thing that
requires discipline and becomes a thing that is structurally impossible.

### The npm server holds zero tool definitions

The slick part. `@suwappu/mcp-server` should not *have* a tool catalogue. It
becomes a thin stdio↔Streamable-HTTP bridge that fetches `tools/list` from the
hosted endpoint at startup and forwards `tools/call` through.

This is the established ecosystem pattern — [`mcp-remote`](https://www.npmjs.com/package/mcp-remote),
[`mcp-proxy`](https://github.com/sparfenyuk/mcp-proxy), `fastmcp-remote` all exist
because stdio-only clients need to reach HTTP servers. We are not inventing
anything; we are stopping the practice of maintaining a second, worse server.

Consequences worth stating plainly:
- The 11-vs-22 divergence becomes **impossible**, not merely fixed.
- New tools reach `npx @suwappu/mcp-server` users **without republishing**.
- Our `tools/list` is deliberately unauthenticated, so the proxy can fetch the
  catalogue before it has a key — this design already fits.
- Cost: an offline/self-hosted user can no longer run the tools locally. They
  could not anyway — every tool calls our API.

## Phases

Each phase ships and is verifiable on its own. Phase 0 first: stop the bleeding
before refactoring.

**Phase 0 — freeze the drift (small, do first).**
Add `scripts/check-mcp-schemas.ts` mirroring `check-openapi.ts --check`: assert
every MCP `inputSchema` equals `z.toJSONSchema()` of its validator. It will fail
immediately on `get_quote` — that is the point. Wire into CI.
*Done when:* CI fails on the known drift.

**Phase 1 — derive `inputSchema` from Zod.**
Introduce the tool registry; map all 22 tools to their validators. Some tools
(`predict_*`, `perps_*`, `lend_*`) may have no validator yet — write the Zod
schema and use it in the route too, so the mapping is honest.
*Done when:* Phase 0's check passes with zero manual overrides, and live
`get_quote.slippage` advertises `maximum: 0.5`.

**Phase 2 — `outputSchema` + `structuredContent`.**
The highest-value item for agent quality. Add Zod response schemas; return
`structuredContent` alongside the existing text content (spec keeps text for
back-compat).
*Done when:* all 22 tools declare `outputSchema` and results validate against it.

**Phase 3 — npm package becomes a proxy.**
Rewrite `packages/mcp-server/src/index.ts` as the bridge. Bump
`@modelcontextprotocol/sdk` `^1.12.1 → ^1.30.0`. Keep the CI smoke test added in
PR #735 — it becomes the regression gate for the proxy.
*Done when:* `npx @suwappu/mcp-server` lists the same 22 tools as hosted.

**Phase 4 — adopt spec 2026-07-28.**
Implement `server/discover` (MUST), emit `resultType`, add `ttlMs`/`cacheScope`
on list results, read protocol version from `_meta`, honour `Mcp-Method`/
`Mcp-Name`. Keep the `initialize` path for older clients — back-compat is
explicit in the spec. Add `2025-11-25` and `2026-07-28` to
`SUPPORTED_MCP_VERSIONS`.
*Done when:* a 2026-07-28 client works without an `initialize` handshake, and an
old client still works.

**Phase 5 — `response_format: concise | detailed`.**
On the context-heavy reads (`get_portfolio`, `predict_markets`, `perps_markets`,
`list_tokens`). Default `concise`; `detailed` returns the identifiers needed for
follow-up calls.

**Phase 6 — OAuth 2.1 (decision, not a task).**
`/.well-known/oauth-protected-resource` 404s; MCP auth is a static agent bearer
key. For a server that moves funds that means an unscoped credential with no
user-consent step. 2026-07-28 also deprecates Dynamic Client Registration in
favour of Client ID Metadata Documents. **This needs a product call before any
code** — it changes how every existing integration authenticates.

## Ordering rationale

Phases 0–2 are pure quality-of-contract and touch only the hosted server; they
carry no client-visible breakage. Phase 3 removes an entire class of future work
and should not wait. Phase 4 is the largest and benefits from 1–2 landing first,
since a generated registry is far cheaper to re-emit under a new protocol than
22 hand-written blocks. Phase 6 is gated on a decision, not effort.

## What I would *not* do

- **Do not** hand-sync the npm server's 11 tools up to 22. That is Phase 3's job
  to delete, and doing both wastes the work.
- **Do not** adopt 2026-07-28 by dropping older versions. The spec's whole
  back-compat design (missing `resultType` reads as `"complete"`) exists so we
  do not have to.
- **Do not** generate MCP from OpenAPI (Option B) just because tooling exists.

## Sources

- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Writing effective tools for AI agents — Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [mcp-remote](https://www.npmjs.com/package/mcp-remote) · [mcp-proxy](https://github.com/sparfenyuk/mcp-proxy)
- [MCP outputSchema / structuredContent](https://sunpeak.ai/blogs/mcp-app-output-schema-structuredcontent/)
- [OpenAPI→MCP conversion architecture](https://www.truefoundry.com/blog/openapi-to-mcp-server-conversion)
