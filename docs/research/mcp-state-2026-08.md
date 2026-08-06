# MCP surface: current state vs the 2026-07-28 spec

Research date: 2026-08-04. Every "ours" claim below was verified against the
live `https://api.suwappu.bot/mcp` endpoint or the checked-in source, not from
memory. Spec claims are cited.

## TL;DR

We run **two divergent MCP servers** — a hosted one with 22 tools and a
published npm one with 11 *different* tools — and both speak a protocol
revision that is **two releases behind**. The npm package is what
`server.json` tells agents to install, so the worse of the two is the one
the ecosystem sees.

## 1. Protocol version: we are two revisions behind

`api-ts/src/routes/mcp.ts:77` negotiates:

```ts
const SUPPORTED_MCP_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18']
```

Current spec is **2026-07-28**; `2025-11-25` came between. The 2026-07-28
revision is the largest change since launch and is not a polish release —
it re-bases the protocol core:

| Change | Impact on us |
|---|---|
| **Stateless core** — `initialize`/`notifications/initialized` handshake removed; every request carries `_meta.io.modelcontextprotocol/protocolVersion` and `clientCapabilities` | Our whole entry path is handshake-shaped (`mcp.ts:1518` negotiates on `initialize`) |
| **`server/discover` is MUST** | We do not implement it at all |
| **`resultType` required on every result** (`"complete"` \| `"input_required"`) | Every one of our results omits it |
| **Cacheable lists** — `ttlMs` + `cacheScope` required on `tools/list`, `resources/list`, … | Not emitted; we lose client-side caching and prompt-cache hits |
| **`Mcp-Method` / `Mcp-Name` headers required** on Streamable HTTP POST | Not required or read by us |
| **MRTR** replaces server-initiated `sampling`/`elicitation`/`roots` | We use none of these, so this is cheap to adopt |
| **Sessions removed** (`Mcp-Session-Id` gone) | We are already effectively stateless — this one favours us |
| **Roots, Sampling, Logging deprecated**; HTTP+SSE deprecated | We use Streamable HTTP already — good |
| **Deterministic `tools/list` order** (SHOULD) | Worth confirming ours is stable |

Backward compatibility is real — clients must treat a missing `resultType` as
`"complete"` — so we are not *broken* today. But we cannot advertise
2026-07-28 support, and the stateless core means new clients increasingly
will not send `initialize` at all.

## 2. Two servers, two different products

| | Hosted `api.suwappu.bot/mcp` | npm `@suwappu/mcp-server` |
|---|---|---|
| Tools | **22** | **11** |
| Transport | Streamable HTTP | stdio only |
| SDK | n/a (hand-rolled) | `@modelcontextprotocol/sdk` **^1.12.1** (current: **1.30.0**) |
| Source | `api-ts/src/routes/mcp.ts` | `packages/mcp-server/` (was deleted for months — see PR #735) |

Hosted (verified live): `get_quote, get_portfolio, get_prices, list_chains,
list_tokens, execute_swap, simulate_swap, get_tempo_tokens,
browse_mpp_directory, predict_markets, predict_market, perps_markets,
perps_quote, perps_positions, lend_markets, lend_market, get_swap_status,
get_swap_history, predict_book, predict_price, predict_trades,
list_wallet_policies`

npm package: `get_token_price, get_portfolio, swap_tokens, get_swap_quote,
set_price_alert, get_alerts, get_trade_history, search_tokens,
get_token_safety, get_trending_tokens, list_chains`

These are not the same product. The npm server has **no perps, no
predictions, no lending, no simulate_swap** — i.e. none of the surface we
have built in the last year. It also has tools the hosted one lacks
(`set_price_alert`, `get_token_safety`, `get_trending_tokens`), so it is not
a strict subset either. `packages/openclaw/server.json` points the registry
at the npm package, so `npx @suwappu/mcp-server` is the front door and it is
the weaker door.

**Recommendation:** stop maintaining two tool catalogues. Make the npm
package a thin stdio proxy to the hosted endpoint, so there is exactly one
tool definition. Divergence is not a backlog item; it is a guarantee of
future drift.

## 3. Against Anthropic's tool-design guidance

Measured against [Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents):

**We already do well:**
- **Tool annotations** — 28 `readOnlyHint`/`destructiveHint`/`idempotentHint`
  occurrences in `mcp.ts`. Good; many servers skip these.
- **Pagination** — 19 `limit`/`offset`/truncation references.
- **Intent-shaped tools** — `simulate_swap`, `get_quote` → `execute_swap` is a
  coherent workflow, not raw CRUD.
- **Auth boundary is correct** — verified live: `tools/call` without a Bearer
  returns 401 with an actionable message pointing at agent registration;
  `tools/list` is deliberately open so registry validators can enumerate.
  This is a sound deliberate choice, documented at `mcp.ts:60`.

**Gaps, ranked by value:**

1. **No `outputSchema` / `structuredContent`** (0 occurrences). Agents must
   parse prose. This is the single highest-leverage fix: typed results cut
   hallucinated field names and let clients validate. Spec 2026-07-28 also
   loosened these to full JSON Schema 2020-12.
2. **No `response_format: concise | detailed`** (0 occurrences). Portfolio and
   market tools return everything every time, burning agent context.
3. **Naming is inconsistent across the two servers** — `get_quote` vs
   `get_swap_quote`, `execute_swap` vs `swap_tokens`. Guidance favours a
   consistent namespace. Collapsing to one server fixes this for free.
4. **Error messages** are good at the auth boundary but should carry the same
   "try X instead" steering on validation failures inside tools.

## 4. Remote-server authorization

`GET /.well-known/oauth-protected-resource` → **404** (verified live), and
there is no `oauth-protected-resource` / `oauth-authorization-server` handler
anywhere in `api-ts/src`. We authenticate MCP with the same static agent
Bearer key as the REST API.

That works and is not insecure, but it is off the path the spec now assumes
for remote servers: OAuth 2.1 with protected-resource metadata discovery.
2026-07-28 additionally **deprecates Dynamic Client Registration** in favour
of Client ID Metadata Documents, and hardens `iss` validation (RFC 9207).

For a server that moves user funds, the static-key model also means an agent
key is a bearer credential with no scoping or user consent step. Worth a
deliberate decision, not drift.

## Ranked recommendations

1. **Collapse the two servers into one catalogue.** Make
   `@suwappu/mcp-server` a stdio proxy to the hosted endpoint. Removes an
   11-vs-22 tool divergence permanently and fixes the naming inconsistency.
   Cheapest, highest payoff.
2. **Bump `@modelcontextprotocol/sdk` 1.12.1 → 1.30.0.** ~18 minor versions of
   spec support and fixes.
3. **Add `outputSchema` + `structuredContent`** to the hosted tools.
4. **Adopt 2026-07-28**: implement `server/discover`, emit `resultType`, add
   `ttlMs`/`cacheScope` on list results, accept `_meta` protocol version,
   honour `Mcp-Method`/`Mcp-Name`. Keep the old handshake path for
   compatibility.
5. **Add `response_format`** to the context-heavy read tools.
6. **Decide on OAuth 2.1** + protected-resource metadata — a product/security
   decision, not a code task.

## Sources

- [The 2026-07-28 Specification](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [Key Changes — MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Writing effective tools for AI agents — Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [The 2026 MCP Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [MCP specification version timeline](https://hidekazu-konishi.com/entry/mcp_specification_version_timeline.html)
