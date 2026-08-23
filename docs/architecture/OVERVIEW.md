# Architecture Overview

Ground-truth map of the major code boundaries and request flows. Extracted from code in
Aug 2026; when this drifts from source, source wins — update this file in the same PR as
the change.

Companion to root [`ARCHITECTURE.md`](../../ARCHITECTURE.md), which holds the
**normative** side: decision taxonomy (Core/Capability/Convention/Implementation), auth
and configuration contracts, and standing decisions. This file is the **descriptive**
map: what the major components do and how they interact.

Production deployment has grown beyond the original four-app Railway migration. Use
[`docs/deployment/production-inventory.md`](../deployment/production-inventory.md) for the
current service-catalog view rather than inferring runtime topology from this source map.

## Major code surfaces

| Component | Entry point / home | Role |
|---|---|---|
| Python API + bot | `api/main.py`, `bot/` | FastAPI, Telegram, WhatsApp, legacy/internal execution paths, background services |
| TypeScript API | `api-ts/src/index.ts` | Agent REST (`/v1/agent/*`), webapp routes, MCP, A2A, swap/execution routes |
| Webapp | `webapp/` | React/Vite web application consuming backend market/execution APIs |
| Terminal | `terminal/` | Trading terminal / Mini App surface |
| Mobile | `mobile/` | Expo iOS client using api-ts + shared SDK types |
| Browser extension | `extension/` | MV3 wallet/client surface |
| Showcase | `showcase/` | Public homepage, product/research directory, generated public stats |
| Contracts | `contracts/` | Solidity token/protocol work, including isolated protocol primitives |
| Shared clients | `packages/` | TypeScript SDK, Python SDK, MCP bridge, OpenClaw, design tokens |

These are source boundaries, **not a one-to-one production service list**. In production,
request-serving components are supplemented by dedicated workers, bridge/relayer
services, signal/on-chain ingestion services, Postgres, and Redis. See the
[production inventory](../deployment/production-inventory.md).

## Request flows

### Human clients

- **Telegram** → Python API webhook or polling path → handlers registered from `bot/` →
  shared services/execution engine.
- **Webapp / terminal** → TypeScript and/or Python-backed market/execution routes,
  depending on the surface and feature.
- **Mobile / extension** → API + shared client contracts.

### Agents and applications

- **Agent REST** → api-ts `/v1/agent/*`.
- **Hosted MCP** → api-ts `/mcp`.
- **A2A** → api-ts `/a2a` for natural-language quote/price/discovery workflows.
- **SDKs** → Agent REST with explicit self-custody preparation vs managed-execution
  semantics.

For current protocol negotiation and custody behavior, treat
[`docs/agent-clients.md`](../agent-clients.md) as authoritative rather than duplicating a
wire-protocol description here.

## Execution flow

At a high level:

```text
Intent
  → auth / wallet / policy checks
  → route eligibility
  → parallel quote discovery across eligible providers
  → quote comparison
  → simulation / safety / execution constraints
  → prepare unsigned transaction OR managed execution
  → receipt / status / settlement observations
```

Routing providers are **chain-gated**. The generated stats file currently reports 21
routing integrations, but no route should be documented as racing all 21. Eligibility
varies by source chain, destination chain, assets, provider health/capability, and the
specific execution path.

## Production runtime

Railway is the current app-runtime target, with `production` and `dev` environments.
Production has expanded beyond the migration-era `python-api`, `api-ts`, `terminal`, and
`showcase` set. The verified 2026-08-21 service catalog also includes `webapp`,
`python-worker`, bridge/relayer services, signal/on-chain ingestion services, Postgres,
and Redis.

Do not hard-code live health or domain assumptions in architecture prose. During an
incident, check Railway + monitoring directly. See:

- [Production inventory](../deployment/production-inventory.md)
- [Railway runbook](../deployment/railway.md)
- [Monitoring](../deployment/monitoring.md)

## Background services

The Python runtime starts multiple asynchronous/background responsibilities; production
also has dedicated worker services. Important categories include:

- **Money-moving / reconciliation** — fee sweeping, order execution, transaction polling,
  withdrawal reconciliation, bridge relaying.
- **Market / position monitoring** — perps, predictions, lending, execution scoring and
  related monitoring.
- **User-facing automation** — alerts, balance refreshes, approvals, digests and messaging
  integrations.
- **Plumbing** — health monitoring, webhook dispatch, event distribution and internal
  service calls.

A healthy request-serving process does not prove background workflows are healthy. Give
each critical worker or loop an observable health signal and keep failures isolated.

## Data layer

One PostgreSQL data plane is shared across the Python and TypeScript stacks, with local
development fallbacks where supported.

- **Python:** SQLAlchemy models under `bot/models/`; runtime/bootstrap migration logic
  lives under `database/`.
- **TypeScript:** Drizzle schemas under `api-ts/src/db/schema/`.

Schema changes that cross both stacks must keep the contracts synchronized. Follow
[`docs/development/migrations.md`](../development/migrations.md) rather than changing one
ORM in isolation.

Redis is used for caching/coordination/pub-sub/queue-style responsibilities where the
relevant service enables it.

## Chains and routing integrations

**Do not hand-write platform counts into application logic.** The generated public source
of truth is [`showcase/src/data/stats.generated.json`](../../showcase/src/data/stats.generated.json),
regenerated from canonical chain/provider configuration and drift-gated in CI.

At the current generation:

- **45 platform mainnet chains**
- **18 Agent API chains**
- **21 chain-gated routing integrations**

The Agent API intentionally exposes a discovered subset of the wider platform chain set.
Agent/application code should call MCP `list_chains`, SDK `listChains()` /
`list_chains()`, or `GET /v1/agent/chains` instead of embedding the count.

## Wallets and keys — MONEY-PATH

Wallet/key handling is security-sensitive and should be reviewed separately from normal
feature code.

- Private-key material is stored encrypted; current code supports envelope-encryption and
  wallet-provider abstractions.
- Keys are decrypted or delegated only at signing/execution boundaries where required.
- Managed/custodial operations and self-custody transaction preparation are separate
  concepts.
- Agent interfaces intentionally expose different transaction boundaries; see
  [agent-clients.md](../agent-clients.md#agent-rest-custody-map).

Any diff that changes signing, private-key handling, withdrawals, managed execution,
fee collection, or authorization belongs in the **MONEY-PATH** review category and should
receive adversarial review before merge.

Operational references:

- [KMS migration / key wrapping](../KMS_AWS_MIGRATION.md)
- [Secret rotation](../SECRET_ROTATION_RUNBOOK.md)
- [Agent security baseline](../agent-clients.md#security-baseline-for-builders)

## Execution intelligence and replay

Suwappu now records and analyzes more than the selected quote. Recent execution-sync work
adds provider-independent candidates/intents, hard feasibility constraints, Pareto
pruning, normalized receipts, calibration from observed executed swaps, and historical /
walk-forward replay.

That system is deliberately **shadow/read-only evidence infrastructure today**:

- production routing remains authoritative;
- rejected alternatives are modeled counterfactuals, not observed fills;
- observed production fills are kept separate from modeled outcomes;
- providers without sufficient executed evidence are excluded from calibration rather
  than receiving optimistic defaults;
- promotion requires replay/holdout evidence and a controlled live stage with hard kill
  conditions.

This separation is an architecture invariant, not marketing nuance: model output must not
silently become money-path authority.

## Protocol primitives

`contracts/primitives/` contains isolated Solidity work including a time-parameterized
curve, self-amortizing ERC-4626 vault, and mutual-credit primitive with Foundry tests and
mainnet-readiness material.

These contracts are part of the monorepo's protocol work, but their presence should not
be interpreted as proof that they are deployed or that the main swap router depends on
them. Check [`contracts/MAINNET_READINESS.md`](../../contracts/MAINNET_READINESS.md) and
actual deployment evidence before making a production claim.

## Knowledge and configuration contracts

Important system facts are intentionally encoded in versioned repository artifacts:

- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — normative boundaries and decisions.
- [`AGENTS.md`](../../AGENTS.md) — agent policy.
- [`CONVENTIONS.md`](../../CONVENTIONS.md) — engineering rules.
- [ADRs](../adr/README.md) — durable architecture decisions.
- [Decision log](../DECISIONS.md) — operational lessons.
- [`.env.schema`](../../.env.schema) — environment-variable contract.
- [`capabilities.yaml`](../../capabilities.yaml) — optional capability/provider manifest.
- [`stats.generated.json`](../../showcase/src/data/stats.generated.json) — generated public
  chain/router counts.

## Where to go deeper

- New contributor: [ONBOARDING.md](../ONBOARDING.md)
- Build an agent/app: [quickstart.md](../quickstart.md) → [agent-clients.md](../agent-clients.md)
- Runtime topology: [production-inventory.md](../deployment/production-inventory.md)
- Deploy/ops: [railway.md](../deployment/railway.md) · [monitoring.md](../deployment/monitoring.md)
- Migrations: [development/migrations.md](../development/migrations.md)
- Decisions: [DECISIONS.md](../DECISIONS.md) · [adr/](../adr/README.md)
- Docs map: [docs/README.md](../README.md)
