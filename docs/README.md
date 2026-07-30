# Documentation

Start here if you're new: [CONTRIBUTING.md](../CONTRIBUTING.md) gets a local instance
running, and [CLAUDE.md](../CLAUDE.md) explains the service layout and build gotchas.

## Development

| Doc | What it covers |
|-----|----------------|
| [Migrations](development/migrations.md) | The dual-ORM schema rules — no Alembic, additive and idempotent only |
| [Secret rotation runbook](SECRET_ROTATION_RUNBOOK.md) | Rotating credentials after exposure |

## Architecture

| Doc | What it covers |
|-----|----------------|
| [Agent clients](agent-clients.md) | Connecting agents over MCP, A2A and REST |
| [Smart accounts](smart-accounts.md) | Account abstraction design |
| [Social recovery](social-recovery.md) | Wallet recovery design |
| [Compliance screening](architecture/compliance-screening.md) | Screening architecture |
| [KMS migration](KMS_AWS_MIGRATION.md) | Envelope encryption and the move to KMS |

## Features

| Doc | What it covers |
|-----|----------------|
| [Feature overview](features/README.md) | Index of feature docs |
| [HyperLiquid](features/hyperliquid.md) | Perpetuals integration |
| [OpenClaw](features/openclaw_integration.md) | Zero-code agent integration |
| [Tempo](features/tempo.md) | Gasless sponsored swaps |

## Deployment

| Doc | What it covers |
|-----|----------------|
| [Railway](deployment/railway.md) | How each service deploys |
| [Monitoring](deployment/monitoring.md) | Health checks and alerting |
| [Self-healing loop](deployment/self-healing-loop.md) | Automated recovery |

## API reference

The full REST reference lives in [`gitbook/`](../gitbook/).

---

Other directories (`plans/`, `economics/`, `parity/`, `rewards/`, `integrations/`)
hold working notes and internal planning documents. They are not maintained as
user-facing documentation and may be out of date.
