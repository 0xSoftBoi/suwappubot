# Suwappu Product Status

This page answers one question: **what does the presence of a Suwappu capability mean today?**

The monorepo contains production services, hosted APIs, published packages, source-only clients,
shadow systems, research, and readiness-gated protocol work. Those are not equivalent states.
Use this page to avoid turning “code exists” into an incorrect production claim.

> Runtime state changes faster than prose. During an incident or release decision, verify live
> deployment state, package registries, and generated capability discovery directly.

## Status vocabulary

| Status | Meaning |
|---|---|
| **Production** | User-facing runtime surface deployed for real product use. |
| **Hosted** | Live network/API interface operated by Suwappu. Availability and capability may vary by method, auth, chain, or client. |
| **Published + source** | Package exists in a public package registry and also has monorepo source. Registry and source versions can differ. |
| **Source-only** | Supported source exists in the repository, but there is no current package-registry release to treat as authoritative. Pin a commit for production use. |
| **Shadow** | Runs only as evidence/analysis beside production. It does not have production money-path authority. |
| **Experimental / readiness-gated** | Implementation/research exists, but production deployment or dependency must be proven separately. |
| **Historical / plan / research** | Context or intent, not a statement of current behavior. |

## Current surface matrix

| Surface / component | Status | Contract |
|---|---|---|
| `www.suwappu.bot` showcase | **Production** | Public product/research/developer surface. |
| Terminal / Mini App | **Production** | Interactive markets, trading and portfolio surface. |
| Telegram | **Production** | Conversational trading/account surface backed by the Python runtime. |
| Webapp | **Production** | Deployed application surface; feature parity can differ from terminal/Telegram. |
| Agent REST | **Hosted** | Explicit application API. Self-custody preparation and managed execution are separate endpoints. |
| Hosted MCP | **Hosted** | Structured tools/resources/prompts. Discover the catalog at runtime. MCP `execute_swap` prepares an unsigned transaction; it is not managed execution. |
| A2A | **Hosted** | Natural-language quote/price/discovery surface. No fund-moving execution method today. |
| `@suwappu/sdk` | **Published + source** | TypeScript client. Monorepo source may be ahead of npm; check registry + package README before relying on a source-only API. |
| `@suwappu/mcp-server` | **Published/source boundary** | Stdio bridge to hosted MCP. Prefer hosted MCP when package/source versions diverge. |
| Python SDK | **Source-only** | Pin a repository revision for production integration. |
| `bot/services/execution_sync*.py` | **Shadow** | Calibration, receipts, historical/walk-forward replay and modeled counterfactual evidence. Production route selection remains authoritative. |
| `contracts/primitives/` | **Experimental / readiness-gated** | Solidity protocol primitives with tests/readiness material. Repo presence is not deployment evidence. |
| `docs/plans/` | **Historical / plan / research** | Forward-looking work. Verify against code before relying on it. |
| `docs/research/` | **Historical / plan / research** | Point-in-time evidence, not a shipping guarantee. |

## The execution authority ladder

This ladder is the most important status boundary for builders.

| Level | Capability | Authority |
|---|---|---|
| **0 — Discover** | Chains, tokens, prices, markets, portfolio metadata | Read-only |
| **1 — Quote** | Price an intent / compare eligible routes | Read-only |
| **2 — Simulate** | Evaluate a transaction before signing/execution | Read-only analysis |
| **3 — Prepare** | Return unsigned self-custody transaction data | Caller still controls signing/broadcast |
| **4 — Managed execute** | Server-side managed execution | **Can move funds** |

Do not grant a client Level 4 merely because it can discover a tool with an execution-sounding
name. Authorization belongs to the application/policy layer, not tool metadata.

### Current interface mapping

- **MCP**: discovery, quote, simulation and unsigned preparation. Its historical
  `execute_swap` name maps to **Level 3**, not Level 4.
- **Agent REST**: `/swap` prepares; `/swap/execute` is explicit managed execution.
- **TypeScript / Python SDK**: use explicit prepare-vs-managed methods in current source.
- **A2A**: quote/discovery only; no Level 3/4 execution method today.

See [agent-clients.md](agent-clients.md) for method-level semantics.

## Generated/runtime truth

Use these contracts instead of hand-maintained claims:

| Question | Source of truth |
|---|---|
| Platform/Agent API chain and router counts | `showcase/src/data/stats.generated.json` |
| Current Agent API chain support | `GET /v1/agent/chains`, MCP `list_chains`, SDK discovery |
| Current MCP tools/resources/prompts | MCP runtime discovery |
| Environment requirements | `.env.schema` + `capabilities.yaml` |
| Source package version | each package's `package.json` / README |
| Published package version | npm registry |
| Production service membership/source | Railway project/environment configuration |
| Production health | Railway + monitoring, not this file |
| Architecture boundaries | root `ARCHITECTURE.md` + ADRs |

## Production provenance caveat

A Railway service being in the `production` environment does not prove it is sourced from
`main`. The current production inventory records source-branch exceptions separately. See
[deployment/production-inventory.md](deployment/production-inventory.md) before making a
release/provenance claim.

## Promotion rules

A lower-maturity artifact should move upward only with evidence appropriate to its risk:

1. **Source-only → published**: release contract passes, registry artifact is reproducible,
   package docs match the published API.
2. **Experimental → production**: deployment evidence, threat/risk review, monitoring,
   rollback/kill path, and documented ownership exist.
3. **Shadow → routing authority**: replay/holdout evidence, sufficient observed executed data,
   controlled live cohort, hard kill conditions, and no reliability/security regression.
4. **Plan/research → shipped**: code + tests + deployment/integration evidence replace prose
   as the authority.

## Documentation rule

When a feature changes maturity, update this file in the same PR whenever possible. Avoid
marketing a capability as production based only on implementation existence, a passing unit
test, or a service name containing `prod`.

Next: [Quickstart](quickstart.md) · [Agent clients](agent-clients.md) ·
[Architecture](architecture/OVERVIEW.md) · [Production inventory](deployment/production-inventory.md)
