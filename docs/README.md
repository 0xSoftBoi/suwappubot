# Suwappu Documentation

Suwappu is a fast-moving execution platform with user products, APIs, agent interfaces,
protocol work, and production infrastructure in one monorepo. This index is organized by
**what you are trying to do**, not by directory name.

> **Code is ground truth.** Runtime counts, environment requirements, and execution
> behavior can change faster than prose. Generated contracts such as
> `showcase/src/data/stats.generated.json`, `.env.schema`, and `capabilities.yaml` take
> precedence over hand-written counts. Plans and research are explicitly non-authoritative.

## Start here

| Goal | Read this first | Then go deeper |
|---|---|---|
| **Use Suwappu** | [Quickstart](quickstart.md) | [Feature guides](features/README.md) |
| **Build an agent** | [Agent clients](agent-clients.md) | [Agent control plane](agents/control-plane.md) · API reference under [`api/`](api/) |
| **Integrate an app** | [Quickstart](quickstart.md#build-an-application) | [`@suwappu/sdk`](../packages/sdk/README.md) · [Python SDK](../packages/sdk-python/README.md) |
| **Understand the architecture** | [Architecture overview](architecture/OVERVIEW.md) | [`ARCHITECTURE.md`](../ARCHITECTURE.md) · [ADRs](adr/README.md) |
| **Contribute code** | [Onboarding](ONBOARDING.md) | [`CONVENTIONS.md`](../CONVENTIONS.md) · [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| **Operate production** | [Production inventory](deployment/production-inventory.md) | [Railway](deployment/railway.md) · [Monitoring](deployment/monitoring.md) · [Incidents](incidents/README.md) |
| **Work on money-path code** | [`ARCHITECTURE.md`](../ARCHITECTURE.md) | [Key management](KMS_AWS_MIGRATION.md) · [Agent custody boundaries](agent-clients.md#agent-rest-custody-map) |
| **Understand why a decision exists** | [Decision log](DECISIONS.md) | [ADRs](adr/README.md) |

## Product and integration

### Quickstarts

- [Quickstart](quickstart.md) — shortest paths for a user, agent builder, application
  developer, and contributor.
- [Agent clients](agent-clients.md) — the authoritative guide to hosted MCP, TypeScript
  and Python SDKs, Agent REST, A2A, authentication, version boundaries, and custody.
- [Feature guides](features/README.md) — user-facing capabilities and where they are
  available.

### Agent platform

- [agent-clients.md](agent-clients.md) — MCP / SDK / REST / A2A integration guide.
- [agents/control-plane.md](agents/control-plane.md) — policy schema around fund-moving
  calls.
- [research/mcp-state-2026-08.md](research/mcp-state-2026-08.md) — point-in-time MCP
  research; useful context, not runtime truth.
- [distribution/registry-listings.md](distribution/registry-listings.md) — agent/tool
  registry distribution work.
- [features/openclaw_integration.md](features/openclaw_integration.md) — OpenClaw setup.

### Product capabilities

- [features/README.md](features/README.md) — feature map.
- [features/hyperliquid.md](features/hyperliquid.md) — HyperLiquid perps, spot, staking,
  vaults, TWAP, and funding workflows.
- [features/tempo.md](features/tempo.md) — Tempo fee-payer / gasless flows and MPP.
- [smart-accounts.md](smart-accounts.md) — smart-account integration.
- [social-recovery.md](social-recovery.md) — recovery design.
- [integrations/atomiq-api.md](integrations/atomiq-api.md) — BTC bridge integration.
- [integrations/ledger-wallet.md](integrations/ledger-wallet.md) — Ledger integration.

## Architecture and engineering

There are two architecture layers on purpose:

1. [`ARCHITECTURE.md`](../ARCHITECTURE.md) is **normative** — system boundaries,
   decision taxonomy, auth/config contracts, and standing rules.
2. [architecture/OVERVIEW.md](architecture/OVERVIEW.md) is **descriptive** — what runs,
   request flows, background services, data, chains/providers, and key handling.

Supporting references:

- [adr/](adr/README.md) — Architecture Decision Records. Append-only; merge is
  acceptance. MONEY-PATH and cross-stack changes should link the relevant decision.
- [DECISIONS.md](DECISIONS.md) — operational lessons and decisions that do not need a
  full ADR.
- [development/migrations.md](development/migrations.md) — dual-ORM schema changes.
- [DATAROOM.md](DATAROOM.md) — source-cited product brief. Verify time-sensitive claims
  before external use.
- [`AGENTS.md`](../AGENTS.md) — policy for AI coding agents working in this repository.
- [`CONVENTIONS.md`](../CONVENTIONS.md) — toolchain, code, git, testing, and naming rules.

## Security and compliance

- [`SECURITY.md`](../SECURITY.md) — vulnerability reporting and repository security
  posture.
- [architecture/compliance-screening.md](architecture/compliance-screening.md) —
  compliance-screening architecture.
- [security/dependency-exceptions.md](security/dependency-exceptions.md) — documented
  dependency exceptions.
- [KMS_AWS_MIGRATION.md](KMS_AWS_MIGRATION.md) — key-wrapping migration history and
  operational guidance.
- [SECRET_ROTATION_RUNBOOK.md](SECRET_ROTATION_RUNBOOK.md) — secret rotation and
  git-history purge procedure.

Security automation, SBOMs, scanners, and controls are evidence and tooling — **not an
external audit or compliance certification** unless a separate document explicitly says
otherwise.

## Operations

### Production

- [deployment/production-inventory.md](deployment/production-inventory.md) — current
  service-catalog view of the Railway production runtime. Use this before assuming the
  old four-service topology still exists.
- [deployment/railway.md](deployment/railway.md) — Railway configuration and migration
  history. Some sections are historical; use the production inventory plus actual
  committed service config for current topology.
- [deployment/monitoring.md](deployment/monitoring.md) — observability layers and their
  blind spots.
- [deployment/self-healing-loop.md](deployment/self-healing-loop.md) — bounded
  auto-recovery design.
- [deployment/bridge-rails-runbook.md](deployment/bridge-rails-runbook.md) — enabling and
  verifying cross-chain rails.

### Reliability

- [incidents/](incidents/README.md) — COE-style postmortems and incident template.
- [development/migrations.md](development/migrations.md) — schema migration runbook.
- [SECRET_ROTATION_RUNBOOK.md](SECRET_ROTATION_RUNBOOK.md) — credential-rotation
  procedure.

## Economics and protocol work

### Committed designs

- [economics/SEASONS_TOKENOMICS.md](economics/SEASONS_TOKENOMICS.md)
- [economics/REDEMPTION_AND_PARTNERS.md](economics/REDEMPTION_AND_PARTNERS.md)
- [rewards/DESIGN.md](rewards/DESIGN.md)

### Protocol primitives

The Solidity primitives under [`../contracts/primitives/`](../contracts/primitives/) are
separate from the production route-selection authority. See
[`../contracts/README.md`](../contracts/README.md) and
[`../contracts/MAINNET_READINESS.md`](../contracts/MAINNET_READINESS.md) before treating
anything there as production-ready.

The execution-synchronization modules under `bot/services/execution_sync*.py` are also
**shadow/read-only evidence infrastructure today**. They support calibration and replay;
they do not replace production routing merely because the code exists.

## Design and client surfaces

- [design/figma.md](design/figma.md)
- [design/proof-material.md](design/proof-material.md)
- [design/serif-decision.md](design/serif-decision.md)
- [mobile/performance.md](mobile/performance.md)

## Institutional knowledge

The repository keeps high-value context close to the code:

- [`AGENTS.md`](../AGENTS.md) — agent policy.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — standing architecture boundaries.
- [`CONVENTIONS.md`](../CONVENTIONS.md) — day-to-day engineering rules.
- [ONBOARDING.md](ONBOARDING.md) — contributor setup and verification lanes.
- [adr/](adr/README.md) — durable architecture decisions.
- [DECISIONS.md](DECISIONS.md) — lessons and smaller decisions.
- [incidents/](incidents/README.md) — production learning.

This is deliberate: important implementation context should survive a Slack thread, an
agent session, or a team handoff.

## Plans — forward-looking, not current behavior

Verify every plan against current code before relying on it:

- [NEXT.md](NEXT.md)
- [plans/aegis-fork-extend.md](plans/aegis-fork-extend.md)
- [plans/agent-leading-edge-roadmap.md](plans/agent-leading-edge-roadmap.md)
- [plans/mcp-unification.md](plans/mcp-unification.md)
- [plans/robinhood-chain-native.md](plans/robinhood-chain-native.md)
- [plans/starknet-btc-neobank-plan.md](plans/starknet-btc-neobank-plan.md)
- [plans/btcfi-expansion-plan.md](plans/btcfi-expansion-plan.md)
- [support-tickets-plan.md](support-tickets-plan.md)
- [pq-settlement-profile.md](pq-settlement-profile.md)
- [economics/COBRAND_CARD_AND_COALITION.md](economics/COBRAND_CARD_AND_COALITION.md)
- [economics/REWARDS_MARKETPLACE.md](economics/REWARDS_MARKETPLACE.md)
- [parity/cozy-card-scoping.md](parity/cozy-card-scoping.md)
- [parity/competitive-improvements.md](parity/competitive-improvements.md)
- [parity/chatdev-feature-parity.md](parity/chatdev-feature-parity.md)

## Research — point-in-time context

Research is evidence for decisions, not a promise that a researched system is shipped.

- [research/institutional-knowledge-practices.md](research/institutional-knowledge-practices.md)
- [NEOBANK_ROADMAP.md](NEOBANK_ROADMAP.md)
- [research/llm-credits/](research/llm-credits/)
- [research/launch/erc8056-stock-token-interface-risk.md](research/launch/erc8056-stock-token-interface-risk.md)
- [design/visual-study.md](design/visual-study.md)
- [design/reference-breakdown-exa.md](design/reference-breakdown-exa.md)
- [design/reference-breakdown-greptile.md](design/reference-breakdown-greptile.md)

## Documentation quality contract

When documentation and code disagree, fix the document in the same PR as the behavior
change whenever possible.

- **Counts:** derive chain/router counts from `showcase/src/data/stats.generated.json`.
- **Configuration:** derive environment requirements from `.env.schema` and
  `capabilities.yaml`.
- **Agent capabilities:** discover MCP tools/resources/prompts at runtime; use
  [agent-clients.md](agent-clients.md) for semantics and custody boundaries.
- **Production topology:** use [production-inventory.md](deployment/production-inventory.md)
  plus committed Railway config; do not infer deployment from source directories.
- **Plans/research:** label them as forward-looking or point-in-time.
- **Verification:** run `./scripts/verify.sh docs` before merging docs changes.

## Known stale / historical material

- [production-site-replacement-audit.md](production-site-replacement-audit.md) describes
  an older AWS ALB/ECS topology and is kept for history.
- Parts of [deployment/railway.md](deployment/railway.md) preserve the original Railway
  migration/provisioning session. The current service catalog is
  [deployment/production-inventory.md](deployment/production-inventory.md).

## Known documentation gaps

Git branching & release flow · DB schema reference · mobile iOS build/deploy guide ·
threat-model/audit-report index · canonical metrics/KPI dashboard index.
