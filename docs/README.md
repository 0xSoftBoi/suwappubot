# Suwappu Documentation

This is the navigation hub for Suwappu's product, developer, architecture, security, and
operations documentation. Start with the job you are trying to do; do not browse the
monorepo directory-by-directory unless you are maintaining it.

> **Code and generated/runtime contracts are ground truth.** Plans and research are context,
> not current behavior. See [Product Status](product-status.md) when maturity is ambiguous.

## Start here

| Goal | Start | Go deeper |
|---|---|---|
| **Use Suwappu** | [Quickstart](quickstart.md) | [Feature guides](features/README.md) |
| **Build an agent** | [Agent clients](agent-clients.md) | [Agent control plane](agents/control-plane.md) |
| **Autonomous trading agent** | [Autopilot](agents/autopilot.md) | commit-reveal loop, risk gates, public decision feed |
| **Integrate an app** | [Quickstart](quickstart.md#build-an-application) | [`@suwappu/sdk`](../packages/sdk/README.md) · [Python SDK](../packages/sdk-python/README.md) |
| **Check maturity / execution authority** | [Product status](product-status.md) | [Agent clients](agent-clients.md) |
| **Understand the system** | [Architecture overview](architecture/OVERVIEW.md) | [`ARCHITECTURE.md`](../ARCHITECTURE.md) · [ADRs](adr/README.md) |
| **Contribute** | [Onboarding](ONBOARDING.md) | [`CONVENTIONS.md`](../CONVENTIONS.md) · [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| **Operate production** | [Production inventory](deployment/production-inventory.md) | [Build reliability](deployment/build-reliability.md) · [Railway](deployment/railway.md) · [Railway best practices](deployment/railway-best-practices.md) · [Monitoring](deployment/monitoring.md) |
| **Handle an incident** | [Incident docs](incidents/README.md) | [Monitoring](deployment/monitoring.md) |
| **Write or review docs** | [Documentation content model](content-model.md) | `./scripts/verify.sh docs` |

## Product and developer docs

### First success

- [Quickstart](quickstart.md) — one focused path to a first useful user/agent/app result.
- [Product status](product-status.md) — production, hosted, published/source, source-only,
  shadow, experimental, plan, and research semantics.
- [Agent clients](agent-clients.md) — MCP, SDK, REST, A2A, auth, version and custody
  boundaries.

### Feature guides

- [Feature index](features/README.md)
- [HyperLiquid](features/hyperliquid.md)
- [Tempo](features/tempo.md)
- [OpenClaw integration](features/openclaw_integration.md)
- [Smart accounts](smart-accounts.md)
- [Social recovery](social-recovery.md)
- [BTC / Atomiq integration](integrations/atomiq-api.md)
- [Ledger wallet integration](integrations/ledger-wallet.md)

Feature presence is not proof of universal client/chain availability. Use runtime discovery
and [Product Status](product-status.md).

## Execution authority

Suwappu separates authority into five levels:

1. **Discover** — read-only metadata.
2. **Quote** — price an intent.
3. **Simulate** — analyze a transaction.
4. **Prepare** — return unsigned self-custody transaction data.
5. **Managed execute** — explicit server-side fund movement.

Do not infer authority from method names. In particular, MCP `execute_swap` currently maps
to **Prepare**, not managed execution. See [Product Status](product-status.md).

## Architecture and engineering

Use the two architecture layers for different jobs:

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — **normative** boundaries, decision taxonomy,
  auth/config contracts, standing rules.
- [architecture/OVERVIEW.md](architecture/OVERVIEW.md) — **descriptive** runtime map,
  request/data flows, background work, routing and key-handling boundaries.

Supporting institutional knowledge:

- [ADRs](adr/README.md) — durable architecture decisions.
- [Decision log](DECISIONS.md) — operational lessons and smaller decisions.
- [Onboarding](ONBOARDING.md) — contributor setup and test lanes.
- [Migrations](development/migrations.md) — shared-schema change procedure.
- [`AGENTS.md`](../AGENTS.md) — policy for coding agents in this repository.
- [`CONVENTIONS.md`](../CONVENTIONS.md) — engineering rules.

## Security

Start with [`SECURITY.md`](../SECURITY.md) for vulnerability reporting and repository
security posture.

Money-path and security references:

- [Product status / authority](product-status.md)
- [Agent security and custody](agent-clients.md)
- [Compliance screening architecture](architecture/compliance-screening.md)
- [Dependency exceptions](security/dependency-exceptions.md)
- [KMS/key-wrapping history](KMS_AWS_MIGRATION.md)
- [Secret rotation](SECRET_ROTATION_RUNBOOK.md)

Security automation, SBOMs, scanners, and controls are evidence/tooling, **not an audit or
compliance certification** unless a separate artifact explicitly says otherwise.

## Operations

- [Production inventory](deployment/production-inventory.md) — current service-catalog
  snapshot and source-branch caveats.
- [Railway](deployment/railway.md) — deployment configuration and migration history.
- [Railway build reliability](deployment/build-reliability.md) — CI gate, watch paths, service lifecycle, and IaC transition.
- [Railway best practices](deployment/railway-best-practices.md) — **2026-08 audit**: Config-as-Code deprecation (cutoff 2026-12-01) + Infrastructure-as-Code migration runbook, verified config drift, cross-region DB latency, zero-downtime settings.
- [Railway cost audit](deployment/railway-cost-audit.md) — **2026-08-27 snapshot**: modelled per-service spend across both environments (~$122/mo), the `python-worker` RPC retry storm and 31.7 GB memory spike, six idle dev services, and a ranked reduction plan.
- [Monitoring](deployment/monitoring.md) — observability layers and blind spots.
- [Self-healing loop](deployment/self-healing-loop.md) — bounded recovery design.
- [Bridge rails](deployment/bridge-rails-runbook.md) — enable/verify cross-chain rails.
- [Incidents](incidents/README.md) — postmortems and incident process.

During an incident, verify Railway/monitoring directly. Markdown is never the live health
source of truth.

## Protocol, economics, plans and research

Protocol/economics work can exist without being production execution authority.

- Protocol contracts: [`../contracts/`](../contracts/) and
  [`../contracts/MAINNET_READINESS.md`](../contracts/MAINNET_READINESS.md)
- Economics/rewards: [`economics/`](economics/) · [`rewards/`](rewards/)
- Forward-looking work: [`plans/`](plans/) · [NEXT.md](NEXT.md)
- Point-in-time evidence: [`research/`](research/)
- Design studies/system: [`design/`](design/)

`bot/services/execution_sync*.py` remains **shadow** evidence infrastructure unless
[Product Status](product-status.md) says otherwise. Research and plan documents are
non-authoritative by definition.

## Sources of truth

| Question | Source |
|---|---|
| Platform/Agent chain + router counts | `showcase/src/data/stats.generated.json` |
| Agent chain support | runtime discovery / `GET /v1/agent/chains` |
| MCP catalog | runtime MCP discovery |
| Environment requirements | `.env.schema` + `capabilities.yaml` |
| Product maturity / execution authority | [product-status.md](product-status.md) |
| Production service membership/source | Railway + [production inventory](deployment/production-inventory.md) |
| Architecture boundaries | root `ARCHITECTURE.md` + ADRs |
| Published package version | package registry |
| Source package version | package `package.json` |

## Documentation standard

Read [content-model.md](content-model.md) before adding a substantial new page. Every doc
should have one primary job and use the appropriate content type: quickstart, how-to,
reference, concept, runbook, troubleshooting, or plan/research.

For money-moving docs, state custody and authority beside the action. For dynamic facts,
link the source of truth instead of making another copy.

Verify docs changes with:

```bash
./scripts/verify.sh docs
```

## Historical material

Some documents are intentionally retained as history. For example,
[production-site-replacement-audit.md](production-site-replacement-audit.md) describes an
older AWS topology, and parts of [deployment/railway.md](deployment/railway.md) preserve the
original Railway migration session. Historical evidence should stay labeled as history.

## Known documentation gaps

Git branching/release flow · DB schema reference · mobile iOS build/deploy guide ·
threat-model/audit-report index · canonical metrics/KPI dashboard index.
