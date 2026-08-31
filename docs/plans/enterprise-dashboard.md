# Enterprise Dashboard — Parity Plan

Goal: bring Suwappu's enterprise dashboard to feature parity with the trusted
compliant crypto platforms (Fireblocks Console, Coinbase Prime, Anchorage,
BitGo, Copper, Circle, Chainalysis). Execution is driven by
`docs/plans/enterprise-parity-graph.json` via the `/enterprise-parity` skill
(run under `/loop`). No test suites — build-verify only.

## What already exists (recon, 2026-08-31)

| Capability | Where | State |
|---|---|---|
| Org management UI (team, invites, API keys, usage) | `webapp/src/pages/Enterprise.tsx` | Live, tier-gated |
| Web dashboard (org, members, keys, usage chart) | `showcase/src/app/dashboard/` | Live |
| Org/RBAC schema (owner/admin/member/viewer) | `api-ts/src/db/schema/organizations.ts:30-64` | Live |
| Tamper-evident audit log (hash chain) | `api-ts/src/db/schema/security.ts:13-51` | Schema live, UI absent |
| API usage events | `organizations.ts` (`apiUsageEvents`) | Live |
| Compliance screening (allowlist/blocklist, OFAC, ENFORCE/MONITOR) | `bot/services/compliance/compliance_service.py` | Wired into swaps/withdrawals, no dashboard surface |
| Token risk scoring / rug detection | `bot/services/token_security/` | Live, no dashboard surface |
| Swap/fee/execution/approval tracking | `api-ts/src/db/schema/{swaps,fees,approvals,execution}.ts` | Live |
| Auth: flexAuth (JWT/cookie) + Telegram initData, role checks | `api-ts/src/middleware/flexAuth.ts`, `routes/enterprise.ts:43-80` | Live |
| Charting | `lightweight-charts@^5` (webapp), `UsageChart` (showcase) | Live |

## Architecture decisions

1. **Surface**: the browser dashboard at `showcase/src/app/dashboard/` is the
   enterprise surface (desktop, shareable, auditable). The webapp Enterprise
   page stays as the mobile companion; new features land on showcase first.
2. **API**: all new dashboard data comes from api-ts (`/v1/enterprise/*`),
   flexAuth + org-role checked, reading the existing Drizzle tables. Python
   compliance/risk services get thin read endpoints only where api-ts lacks
   the data.
3. **Audit-first**: every admin mutation writes to the hash-chained
   `auditLogs` table; the dashboard renders and exports that chain.
4. **No new infra**: reuse lightweight-charts, existing auth, existing tables;
   additive migrations only (per `docs/development/migrations.md`).

## Parity gap analysis (from market research, 2026-08-31)

Researched: Fireblocks Console, Coinbase Prime, Anchorage, Copper, Circle,
BitGo, Chainalysis KYT, Safe{Wallet}. Table-stakes features Suwappu lacks a
dashboard surface for, ranked by cross-platform frequency:

1. **Quorum approval workflows** (all custody platforms) — no approval-request
   flow exists → `policy-schema`, `policy-api`, `policy-ui`.
2. **Audit trail UI + tamper-evidence** — hash-chained `auditLogs` table exists
   but is invisible → `audit-api`, `audit-ui`.
3. **Transfer/spending policy rules** (limits, velocity, allowlists; tiered
   Safe-style spending limits) → `policy-*`.
4. **Multi-chain treasury overview + historical value** → `treasury-api/ui`.
5. **Transaction monitoring w/ filters + CSV export** → `tx-monitor-api/ui`.
6. **KYT/screening surface** — compliance service runs blind (ENFORCE/MONITOR,
   OFAC) with no dashboard → `compliance-api/ui`.
7. **Reporting/accounting exports** (Coinbase Prime journal pattern)
   → `reports-export`.
8. **Webhook/SIEM alerting** → `alerts-webhooks`.

Differentiators adopted: Fireblocks **Security Center** (one incident screen →
`security-center-ui`), Fireblocks **signed policy export** (in `policy-api`),
Safe **tiered spending limits** (in `policy-schema`), Chainalysis
**filterable alert groups** (in `compliance-ui`).

Already at parity (no node needed): RBAC roles, org/team management, scoped
API keys, API usage metering.

## Execution

Run `/loop /enterprise-parity` — each iteration completes one graph node,
verifies the build, commits, and pushes to
`claude/enterprise-dashboards-crypto-1f97xj`.
