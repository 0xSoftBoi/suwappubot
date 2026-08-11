# Scale

Why this matters for Gekko: the roadmap's build items are sized in days-to-weeks for a small team, but a neobank handling real money and regulated partnerships eventually needs headcount and process that a trading-bot team doesn't. This doc scopes what "scaling up" looks like without prescribing premature hiring — most of Gekko v1 should stay lean and automation-first, per CLAUDE.md's conductor/delegation philosophy applied to the org itself.

## Hiring

### What it is
The functions Gekko needs staffed as it grows beyond what the existing Suwappu engineering team can absorb — support, compliance, risk, and eventually dedicated product/growth roles.

### How it works / benchmarks
- Early-stage neobanks typically stay engineering-heavy and support-light until card volume forces dedicated support/ops hires (verify staffing ratios, varies enormously by company).

### Gekko approach
Do not hire ahead of volume. Sequence hires against triggers: first dedicated support hire when automated deflection (`18-operations.md`) can't keep median response times under target; first compliance/risk hire before card launch (non-negotiable, regulatory requirement); first dedicated fraud-ops hire once card spend crosses a meaningful volume threshold.

### Target / definition
- Definition: headcount added per operational trigger crossed, not calendar time.
- Target: no fixed headcount plan for v1; review quarterly against volume triggers.

## Engineering

### What it is
How the existing Suwappu engineering org (Python bot/API, TypeScript api-ts, webapp, mobile) scales to support Gekko's additional surfaces without fragmenting into disconnected codebases.

### How it works / benchmarks
- N/A — internal engineering scaling question, not an industry-benchmark item.

### Gekko approach
Reuse existing infrastructure aggressively per CLAUDE.md: shared types in `packages/shared/`, existing fee/referral/XP engines extended rather than rebuilt, existing background-service pattern (`api/main.py` lifespan tasks) extended for new ops (liquidation monitoring, yield rebalancing) rather than standing up new services. New surfaces (card, credit) should be new modules within `api-ts`/`bot/services`, not new repos.

### Target / definition
- Definition: % of Gekko features built as extensions of existing services vs. net-new infrastructure.
- Target: keep net-new infra to card/credit integration layers only; everything else extends existing code.

## Sales

### What it is
For a consumer neobank, "sales" is mostly growth/marketing rather than a traditional enterprise sales motion — though a B2B treasury or payroll product (if pursued per `20-product-expansion.md`) would need one.

### How it works / benchmarks
- Consumer neobank growth is typically referral- and community-driven at this stage rather than paid-sales-driven (verify, consistent with the CAC discussion in `15-unit-economics.md`).

### Gekko approach
No dedicated sales function for v1 — growth runs through the existing referral/XP system and cross-sell from the Suwappu trading base. Revisit only if a B2B product (treasury/payroll) is greenlit, which would need a small dedicated BD/sales motion distinct from consumer growth.

### Target / definition
- Definition: not applicable to consumer product v1.
- Target: none set.

## Partnerships

### What it is
Managing the regulated-partner relationships the roadmap explicitly requires — card issuer/processor, sponsor bank, fiat ramp providers — as Gekko scales transaction volume through them.

### How it works / benchmarks
- Partner-dependent fintechs typically need dedicated partnership management once volume is material enough that a partner's pricing/terms/reliability materially affects unit economics (verify, standard fintech pattern).

### Gekko approach
Folds into Sponsor Bank Management (`18-operations.md`) at launch; graduate to a dedicated partnerships function once Gekko is running multiple regulated integrations simultaneously (card + ramp + potentially payroll ACH) and renegotiating terms becomes a recurring need rather than a one-time integration.

### Target / definition
- Definition: number of active regulated-partner relationships requiring ongoing management.
- Target: dedicated partnerships hire triggered at 3+ concurrent regulated integrations.

## Operations

### What it is
The general scaling of the operational functions detailed in `18-operations.md` — support, disputes, treasury ops, fraud ops — as transaction and user volume grow.

### How it works / benchmarks
- See `18-operations.md` for per-function benchmarks; the scaling question here is when automation stops being sufficient.

### Gekko approach
Instrument every operational function with a clear automation-vs-human-escalation ratio from day one (per `18-operations.md` targets); trigger headcount additions specifically when that ratio degrades below target for two consecutive months, not on a fixed schedule.

### Target / definition
- Definition: consecutive months below automation-deflection target before a hiring trigger fires.
- Target: 2 consecutive months below target = automatic hiring review.

## Risk & Compliance

### What it is
The BSA/AML, KYC, sanctions-screening, and general regulatory-compliance function required by any product touching fiat rails or a sponsor bank — non-negotiable and must be in place before, not after, card/ramp launch.

### How it works / benchmarks
- Sponsor banks and card processors mandate a compliance program (BSA/AML, OFAC screening, transaction monitoring) as a condition of the partnership itself — this isn't optional or deferrable (verify exact requirements per partner, but the requirement itself is universal).

### Gekko approach
This is the one function on this page that must be staffed or contracted (compliance-as-a-service vendor) before launch, not scaled into reactively — unlike support/fraud ops which can start automation-first. Budget for either a dedicated compliance hire or a compliance vendor (many card-processor partners offer bundled compliance tooling) as a launch prerequisite, not a Phase 2 item.

### Target / definition
- Definition: documented, partner-approved BSA/AML program in place.
- Target: 100% complete before any fiat/card feature goes live — this is a hard gate, not a target to trend toward.

## International

### What it is
Expansion beyond the initial launch jurisdiction — additional currencies, additional card-network/sponsor-bank coverage, and localization.

### How it works / benchmarks
- Regulated card/banking partnerships are jurisdiction-specific; Gnosis Pay covers EEA/UK, other partners cover different regions (per roadmap doc) — international expansion is gated by partner coverage, not just product readiness.

### Gekko approach
Launch in the jurisdiction(s) the chosen card/sponsor-bank partner already covers (roadmap names Gnosis Pay for EEA/UK); expand only in step with partner coverage rather than building region-specific infrastructure speculatively. Non-custodial DeFi features (savings, credit) are inherently more portable across jurisdictions than the card, so lead international expansion with those.

### Target / definition
- Definition: number of jurisdictions with live card + fiat ramp coverage.
- Target: none set for v1; expand only as partner coverage expands.

## M&A

### What it is
Acquiring smaller crypto-native fintech products, teams, or licenses (e.g., a compliance shell, a smaller card program) to accelerate scale rather than building/partnering from scratch.

### How it works / benchmarks
- Not applicable at Gekko's current stage — M&A is typically a growth-stage lever, not a launch-stage one.

### Gekko approach
Out of scope until Gekko has proven the core product-market fit and unit economics in `15-unit-economics.md`. Flag as a future lever only for acquiring compliance/licensing infrastructure (e.g., an existing MSB license or sponsor-bank relationship) if that materially accelerates the roadmap's regulated-partner items.

### Target / definition
- Definition: not applicable for v1.
- Target: none set; revisit at Series A+ maturity (if applicable).
