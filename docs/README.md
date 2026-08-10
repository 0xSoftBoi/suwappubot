# Suwappu Docs Index

Map of everything under `docs/`, grouped by what kind of knowledge it holds.
**Docs drift; code is ground truth** — treat PLAN and RESEARCH docs as
historical intent, not current behavior. Update this index when adding a doc.

## Start here (institutional knowledge)

| Doc | What it is |
|-----|-----------|
| [ONBOARDING.md](ONBOARDING.md) | New-contributor setup: env vars, run/test commands per component, CI gates |
| [architecture/OVERVIEW.md](architecture/OVERVIEW.md) | Ground-truth system map: services, background tasks, request flows, data layer, chains/providers, key handling |
| [adr/](adr/README.md) | Architecture Decision Records — append-only, merge-as-acceptance; required link on MONEY-PATH/cross-stack PRs |
| [DECISIONS.md](DECISIONS.md) | Decision & lessons log — why things are the way they are; add to it when you learn something the hard way |
| [DATAROOM.md](DATAROOM.md) | Source-of-truth product brief (chains, TVL, fee split, integrations — every claim cited) |

## Runbooks (operational how-to)

- [deployment/railway.md](deployment/railway.md) — Railway service build/deploy config per service
- [deployment/monitoring.md](deployment/monitoring.md) — the five observability layers and what each is blind to
- [deployment/self-healing-loop.md](deployment/self-healing-loop.md) — bounded auto-recovery for failed deploys
- [deployment/bridge-rails-runbook.md](deployment/bridge-rails-runbook.md) — enabling/verifying cross-chain rails (CCTP, LayerZero, USDT0)
- [SECRET_ROTATION_RUNBOOK.md](SECRET_ROTATION_RUNBOOK.md) — secret rotation + git-history purge procedure
- [KMS_AWS_MIGRATION.md](KMS_AWS_MIGRATION.md) — local KEK → AWS KMS migration for key wrapping

## Reference (current-state facts)

**Agent surface**: [agent-clients.md](agent-clients.md) (MCP/SDK/REST/A2A),
[agents/control-plane.md](agents/control-plane.md) (policy schema for fund-moving calls),
[research/mcp-state-2026-08.md](research/mcp-state-2026-08.md),
[distribution/registry-listings.md](distribution/registry-listings.md)

**Features**: [features/README.md](features/README.md) (index),
[features/hyperliquid.md](features/hyperliquid.md),
[features/tempo.md](features/tempo.md) (gasless),
[features/openclaw_integration.md](features/openclaw_integration.md),
[rewards/DESIGN.md](rewards/DESIGN.md) (on-chain cashback, audited distributor),
[smart-accounts.md](smart-accounts.md) (ZeroDev Kernel),
[social-recovery.md](social-recovery.md) (DKIM email recovery)

**Integrations**: [integrations/atomiq-api.md](integrations/atomiq-api.md) (BTC bridge),
[integrations/ledger-wallet.md](integrations/ledger-wallet.md)

**Security/compliance**: [architecture/compliance-screening.md](architecture/compliance-screening.md),
[security/dependency-exceptions.md](security/dependency-exceptions.md)

**Economics (committed designs)**: [economics/SEASONS_TOKENOMICS.md](economics/SEASONS_TOKENOMICS.md),
[economics/REDEMPTION_AND_PARTNERS.md](economics/REDEMPTION_AND_PARTNERS.md)

**Design system**: [design/figma.md](design/figma.md), [design/proof-material.md](design/proof-material.md),
[design/serif-decision.md](design/serif-decision.md)

**Mobile**: [mobile/performance.md](mobile/performance.md)

## Plans (forward-looking — verify against code before relying on them)

[NEXT.md](NEXT.md) (queued work),
[plans/aegis-fork-extend.md](plans/aegis-fork-extend.md),
[plans/agent-leading-edge-roadmap.md](plans/agent-leading-edge-roadmap.md),
[plans/mcp-unification.md](plans/mcp-unification.md),
[plans/robinhood-chain-native.md](plans/robinhood-chain-native.md),
[plans/starknet-btc-neobank-plan.md](plans/starknet-btc-neobank-plan.md),
[plans/btcfi-expansion-plan.md](plans/btcfi-expansion-plan.md),
[support-tickets-plan.md](support-tickets-plan.md),
[pq-settlement-profile.md](pq-settlement-profile.md) (experimental),
[economics/COBRAND_CARD_AND_COALITION.md](economics/COBRAND_CARD_AND_COALITION.md),
[economics/REWARDS_MARKETPLACE.md](economics/REWARDS_MARKETPLACE.md),
[parity/cozy-card-scoping.md](parity/cozy-card-scoping.md),
[parity/competitive-improvements.md](parity/competitive-improvements.md),
[parity/chatdev-feature-parity.md](parity/chatdev-feature-parity.md)

## Research (market/competitor studies — point-in-time)

[research/institutional-knowledge-practices.md](research/institutional-knowledge-practices.md) (how other companies keep institutional knowledge + our adoption plan),
[NEOBANK_ROADMAP.md](NEOBANK_ROADMAP.md),
[research/llm-credits/](research/llm-credits/) (00-strategy → 04-metering),
[research/launch/erc8056-stock-token-interface-risk.md](research/launch/erc8056-stock-token-interface-risk.md),
[design/visual-study.md](design/visual-study.md),
[design/reference-breakdown-exa.md](design/reference-breakdown-exa.md),
[design/reference-breakdown-greptile.md](design/reference-breakdown-greptile.md)

## ⚠️ Known-stale

- [production-site-replacement-audit.md](production-site-replacement-audit.md) —
  describes AWS ALB/ECS deployment (May 2026). **Deploy target is Railway now**;
  kept for history only.

## Known gaps (want a doc? these are unclaimed)

Incident-response playbook / on-call handoff · git branching & release flow ·
DB schema reference · mobile iOS build/deploy guide · threat model & audit
report links · metrics/KPI dashboard links.
