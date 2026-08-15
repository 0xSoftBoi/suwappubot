# MCP surface: 2026-07-28 audit and remediation

Research refreshed: 2026-08-07. Protocol claims below use the official MCP specification and official SDK repositories. Repository claims refer to checked-in source unless explicitly labeled as a registry check.

## TL;DR

The highest-risk MCP drift has been removed in source:

- The hosted server has one 22-tool catalog, and source `@suwappu/mcp-server` is now a thin stdio bridge to that catalog rather than a second product.
- Hosted source supports modern stateless MCP `2026-07-28` while retaining the initialize-based legacy path through `2025-06-18`.
- Modern requests validate per-request protocol metadata plus `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` where required. Modern results carry `resultType`; discovery/list/resource results carry cache hints.
- `server/discover` is implemented and public.
- Three tools currently expose validated `outputSchema` + matching `structuredContent`; coverage is deliberately partial rather than guessed.

The largest remaining gaps are release/distribution, structured-output coverage, and an explicit remote-authorization decision. On 2026-08-07, npm still reports `@suwappu/mcp-server` **0.1.1** even though repository source is `0.6.0`; do not advertise an unpublished bridge version as installable.

## 1. Protocol: dual-era instead of handshake-only

MCP `2026-07-28` introduced a stateless core. Modern requests carry protocol version and client capabilities in `params._meta`; Streamable HTTP mirrors routing-relevant fields into headers. `server/discover` advertises versions/capabilities, all successful results carry `resultType`, and cacheable catalog/resource methods carry `ttlMs` plus `cacheScope`.

Checked-in hosted source now implements that modern shape while preserving the existing legacy path:

| Concern | Source status |
|---|---|
| `server/discover` | Implemented; public; advertises server capabilities and supported revisions |
| Per-request protocol metadata | Required for modern requests |
| `MCP-Protocol-Version` / `Mcp-Method` | Validated against the JSON-RPC body before auth/metering |
| `Mcp-Name` | Required and validated for `tools/call`, `resources/read`, and `prompts/get`; Base64 sentinel form is decoded before comparison |
| HTTP `Origin` | Requests with a disallowed `Origin` are rejected with 403; modern MCP headers are included in the CORS allowlist |
| `resultType` | `complete` on current modern results |
| Server identity | `_meta.io.modelcontextprotocol/serverInfo` on modern results |
| Cache hints | Added to discovery, tool/prompt/resource lists, resource templates, and resource reads |
| Legacy `initialize` | Retained; negotiates only legacy revisions and never pretends the modern revision has a session |
| MRTR | No current Suwappu handler needs client input mid-call, so no `input_required` flow is necessary today |
| Custom `Mcp-Param-*` headers | None of the current tool schemas declares `x-mcp-header`, so there is no custom mirrored parameter to validate today |

This is deliberately dual-era. A modern client can probe/use `2026-07-28`; an older client can continue through `initialize`. That is more useful than forcing every existing integration to migrate in lockstep.

## 2. One catalog, two transports

Earlier source contained two independently maintained MCP products: the hosted endpoint and an npm stdio server with a different tool set. Source `0.6.0` fixes the architectural problem: `packages/mcp-server` owns no Suwappu tool/resource/prompt definitions. It forwards discovery and calls to the hosted endpoint.

| Surface | Source role | Catalog authority |
|---|---|---|
| `https://api.suwappu.bot/mcp` | Streamable HTTP server | **Canonical** |
| `packages/mcp-server` | Local stdio compatibility bridge | Hosted server |

The source bridge currently uses `@modelcontextprotocol/sdk` `^1.30.0`, the v1 compatibility line. Official TypeScript SDK v2 is the current modern line and makes `2026-07-28` an explicit opt-in/negotiated era. Migrating the local bridge to v2 is worthwhile when modern stdio semantics are needed, but it is no longer required to keep Suwappu's catalog current because the bridge does not duplicate that catalog.

The distribution gap is more urgent: `npm view @suwappu/mcp-server version` returned `0.1.1` on 2026-08-07. Until source `0.6.0` is published, docs and registry metadata should prefer the hosted endpoint and must not imply `npx @suwappu/mcp-server` installs the new bridge.

## 3. Tool quality: meaningful progress, incomplete coverage

Source is materially better than the original audit:

- All catalog tools carry behavioral annotations, with the important caveat that annotations are hints rather than authorization.
- Input schemas backed by server validators are generated from those validators for key money-adjacent paths, reducing advertised/runtime drift.
- `list_chains`, `get_prices`, and `get_tempo_tokens` expose `outputSchema`; their tool results attach `structuredContent` derived from the same JSON value shown in text.
- Malformed/unknown tool calls are rejected before per-tool charging.
- The capability boundary is explicit: MCP `execute_swap` prepares an unsigned self-custody transaction and never signs or broadcasts it; managed execution remains a separate REST permission.

Structured-output coverage is still **3 of 22 tools**. That should grow from captured/validated real result shapes rather than guessed schemas. `get_portfolio`, `get_quote`, `simulate_swap`, and the market/lending reads are the highest-value next candidates because downstream apps are most likely to make decisions from those fields.

`response_format`/projection controls are also still absent on context-heavy reads. Add them only where measurements show context size is a real problem; correctness and stable structured data come first.

## 4. Remote authorization remains a product/security decision

Suwappu's hosted MCP uses the same agent Bearer credential model as the Agent REST API. The repository does not currently expose the MCP OAuth protected-resource discovery flow.

That is not something to bolt on as a documentation-only compliance checkbox. For a financial-agent product, authorization scopes, consent, credential lifecycle, and how managed execution is separated from read/quote capabilities need a deliberate design and threat review. Until that decision is made, docs should state the Bearer-key model exactly and builders should keep local capability allowlists.

## 5. Ranked remaining work

1. **Publish the source bridge intentionally.** Release `@suwappu/mcp-server` from source `0.6.0` (with provenance/checks), then restore/verify any registry package entry against the actually published version.
2. **Expand validated structured output.** Prioritize portfolio, quote, simulation, perps/prediction, and lending shapes; require captured fixtures/tests before advertising schemas.
3. **Move the stdio bridge to the official TypeScript SDK v2 when modern stdio is needed.** Keep hosted forwarding as the catalog authority.
4. **Add conformance/integration coverage for both protocol eras.** Especially modern header mismatch, unsupported version, cache hints, and legacy fallback behavior.
5. **Decide on OAuth/scoped remote authorization.** Treat it as a product/security project, not a protocol-version bump.
6. **Measure context pressure before adding response projections.** Optimize only the read tools where real agent traces show excessive tokens.

## Primary sources

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [MCP base protocol and per-request `_meta`](https://modelcontextprotocol.io/specification/2026-07-28/basic)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [`server/discover`](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [MCP caching rules](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching)
- [MCP schema reference](https://modelcontextprotocol.io/specification/2026-07-28/schema)
- [Official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Official Python SDK](https://github.com/modelcontextprotocol/python-sdk)
