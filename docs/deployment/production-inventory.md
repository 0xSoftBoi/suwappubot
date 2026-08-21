# Production Service Inventory

This document is the service-catalog view of Suwappu's Railway production runtime.
It exists because the production topology has outgrown the original four-service Railway
migration plan, and source directories are no longer a reliable proxy for deployed
services.

**Snapshot verified against the Railway production environment on 2026-08-21.** Service
membership and health are operational state and can change independently of this file;
use Railway itself for the live answer during an incident.

## Production runtime

### Core product and request surfaces

| Service | Responsibility |
|---|---|
| `python-api` | Python/FastAPI service, Telegram/bot integration, legacy/internal execution paths |
| `api-ts` | TypeScript API: Agent REST, MCP, A2A, webapp and execution-facing routes |
| `webapp` | Web application surface |
| `terminal` | Trading terminal / Mini App surface |
| `showcase` | Public website, product/research discovery |

### Workers, ingestion, and intelligence

| Service | Responsibility |
|---|---|
| `python-worker` | Background Python work separated from request serving |
| `pump-onchain-ingest-prod` | Production on-chain ingestion pipeline |
| `signal-lab-prod` | Production signal/intelligence service |

### Bridge and settlement infrastructure

| Service | Responsibility |
|---|---|
| `suwappu-bridge` | Bridge service |
| `suwappu-relayer` | Relayer service |

### State and coordination

| Service | Responsibility |
|---|---|
| `Postgres` | Primary relational state |
| `Redis` | Caching, coordination, queues/pub-sub where configured |

At the time of the 2026-08-21 verification, Railway reported a successful latest
production deployment for each service above. **Do not encode that health result into
automation or assume it remains true later.**

## Environments

The Railway project currently has:

- `production`
- `dev`

A service existing in the Railway project does not necessarily mean it is active in both
environments. Always scope operational checks to the environment you are investigating.

## Source of truth by question

| Question | Source of truth |
|---|---|
| What services exist right now? | Railway project/environment service inventory |
| What commit/config builds a service? | Service source + committed Railway/Docker config |
| What URLs/domains point at it? | Railway networking/domain configuration |
| What variables are required by code? | `.env.schema` + `capabilities.yaml` |
| What variables are actually set? | Railway environment/service variables — never copy secrets into docs |
| Is it healthy right now? | Railway deployment/replica status + monitoring, not this Markdown file |
| How do requests flow between code components? | `docs/architecture/OVERVIEW.md` |

## Why this differs from `deployment/railway.md`

[`railway.md`](railway.md) began as the migration/provisioning runbook for the original
`python-api`, `api-ts`, `terminal`, and `showcase` app services plus Postgres/Redis. It is
still useful for build configuration and migration history, but sections describing that
original service count are historical.

As the platform grew, dedicated services were added for the webapp, background work,
bridge/relayer infrastructure, and signal/on-chain ingestion. This file is the concise
current inventory; the long migration runbook should not be used as a service catalog.

## Operational rules

1. **Do not infer deployment from directory names.** A source directory can be unused,
   shared by multiple services, or deployed under a different service name.
2. **Do not put secret values in docs.** Document variable names/contracts only.
3. **Separate request serving from background health.** A healthy API does not prove a
   worker, relayer, or ingestion pipeline is healthy.
4. **Check dependencies during incidents.** Postgres/Redis and upstream RPC/provider
   failures can make application replicas look healthy while user workflows fail.
5. **Update this catalog when adding/removing a production service.** The change should
   land with the service/config change, not weeks later.
6. **Keep historical migration notes labeled as history.** They are useful evidence but
   should never masquerade as the current runtime.

See also: [Monitoring](monitoring.md) · [Railway runbook](railway.md) ·
[Architecture overview](../architecture/OVERVIEW.md) · [Incident process](../incidents/README.md)
