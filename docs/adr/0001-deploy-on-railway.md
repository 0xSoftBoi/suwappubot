# 0001 — Deploy on Railway, not AWS

**Status**: Accepted (backfilled 2026-08; decision predates this record)

## Context

Production originally targeted AWS (ECS/ALB, CDK definitions in `infra/`).
Operating ECS deploys, task definitions, and ALB routing consumed
disproportionate time for a small team, and deploy iteration was slow.

## Decision

All application services (python-api, python-worker, api-ts, terminal,
showcase) deploy to **Railway**. `main` → prod project, `dev` → dev project.
The `infra/` CDK directory is retained for history but is not a deploy target.
AWS remains in use **only** for KMS (see ADR 0002).

## Consequences

- Deploy/health tooling targets Railway: `scripts/status.py`, `/deploy` skill,
  `docs/deployment/railway.md`.
- `api.suwappu.bot` routes to **api-ts**; the Python bot has no custom prod
  domain — health-check it via its `*.up.railway.app` host.
- Any runbook, doc, or diagnosis referencing ECS/ALB as current is stale
  (e.g. `docs/production-site-replacement-audit.md`).
- Revisit if Railway pricing/limits become binding at scale.
