# CFO Agenda 2026 → Suwappu Operating System

Status: active implementation  
Owner: founder / finance control plane  
Primary UI: `/admin` → Finance  
Primary API: `GET /admin/finance`

Source inspiration: Oracle NetSuite, *The CFO Agenda 2026: 12 Ways to Flourish Now*.
This document adapts the twelve ideas to Suwappu's actual business and technical model;
it is not a claim that Suwappu uses NetSuite or reproduces NetSuite functionality.

## Design rule

Suwappu is not a retailer or manufacturer. Its "supply chain" is route providers, RPCs,
chains, payment rails, cloud infrastructure, market-data vendors, LLMs, custody/signing
providers, and the human approval/control path. Its "inventory" is liquidity/capital
availability and provider capacity. Its "collections" are subscription renewals, prepaid
credit funding, card failures, and fee collection.

The adaptation therefore measures the economic process that actually exists rather than
copying generic ERP terminology.

## The 12-point implementation matrix

| # | CFO Agenda idea | Suwappu adaptation | Current implementation | Next authority step |
|---|---|---|---|---|
| 1 | Industry-specific AI agents | A founder/CFO agent specialized for crypto execution economics, payment rails, provider risk, and capital allocation | **Partial.** Finance control plane produces deterministic admin-scoped answers and exception signals | Add an optional model layer only after source-grounded finance data is complete; model gets read-only tools, never execution authority |
| 2 | Integrate applications + data with permissioned AI/MCP | One permission-aware internal context layer across execution, billing, infrastructure, support, compliance, and treasury | **Partial.** Admin API already joins multiple operational ledgers; public MCP is intentionally excluded from company finance | Add private/admin connector surface with least-privilege scopes and audit logging; never reuse public MCP auth |
| 3 | Personalized self-service | Customer account surfaces that explain billing, balances, execution status, failures, and next actions without support tickets | **Partial.** Billing portal/invoices, dashboard, natural-language trading and status surfaces exist | Add account-specific “why did this fail / what do I do next?” explanations and support deflection measurement |
| 4 | Predictive cash-flow analytics | Rolling 13-week model driven by observed volume, fee capture, collection rate, non-fee cash receipts, fixed burn, and variable cost | **Implemented as driver forecast.** Inputs and scenarios are explicit and inspectable | Connect reconciled treasury, Stripe settlements/refunds, and infrastructure invoices; only then consider statistical forecasting |
| 5 | Accelerate collections / payment cycles | Identify overdue recurring crypto charges, upcoming renewals, expiring paid plans, and Stripe payment failures | **Implemented for detection.** Control plane surfaces due/overdue/failure counts | Add admin-approved dunning/recovery workflows, retry-success tracking, and churn/recovery attribution |
| 6 | Dynamic scenario analysis | Downside/base/upside cases over volume, non-fee cash growth, fee capture, fixed burn, variable costs, and starting cash | **Implemented.** Founder assumptions remain local to the admin browser | Add named saved scenarios with approval/audit only if persistence becomes operationally useful |
| 7 | Natural-language query for reports | Ask “what is runway?”, “why are swaps failing?”, “what is our provider concentration?” | **Implemented without external LLM.** Deterministic NLQ runs over already-authorized loaded data | Add model-assisted NLQ only when it can cite exact internal metrics and cannot expand data access |
| 8 | Advanced data modeling for growth | Driver decomposition across volume, fees, payment mix, API usage, execution quality, and provider performance | **Partial.** Unit economics + driver forecast are live | Add cohorts: human vs agent, chain, route, plan, acquisition source, retention, and contribution margin once cost data is authoritative |
| 9 | Process mining | Mine actual quote → route candidates → execution → settlement instead of assuming the intended workflow | **Implemented baseline.** Conversion, route depth, p50/p95 settlement latency, top failure signatures | Add lifecycle-event timestamps from canonical execution ADR so stage dwell time and rework are measured directly |
| 10 | Supply-chain resilience | Treat route/RPC/cloud/payment/signing providers as operational supply chain | **Implemented baseline.** Volume-share concentration and HHI-like dependency signal | Join uptime, latency, cost, geographic/chain dependence, and fallback coverage into vendor scorecards |
| 11 | Invest in finance talent | For a founder-led company, turn recurring finance judgment into documented operating cadence and machine-checkable definitions | **Partial.** Metric semantics and finance runbook are documented | Establish weekly cash/risk review, monthly close checklist, metric owners, and evidence packet; hire/accounting support when transaction complexity justifies it |
| 12 | Data governance + compliance | Finance/AI outputs must have source lineage, least privilege, audit trails, data-quality flags, and explicit authority limits | **Strong existing base, still incomplete.** Admin auth, tamper-evident audit log, policy controls, source-quality warnings | Add finance-query audit events, data classification, retention policy, SOC 2 evidence mapping, and reconciled external-source provenance |

## What the control plane now answers

The Finance surface is deliberately centered on decisions:

- **Liquidity:** tracked cash receipts, explicit cost assumptions, 13-week ending cash,
  and first cash-out week.
- **Unit economics:** fee capture, fee collection, swap volume, execution success, and
  measured routing improvement.
- **Payment cycles:** recurring billing due/overdue, near-term expirations, and Stripe
  failure events already captured in the tamper-evident audit log.
- **Process mining:** quote-to-execution conversion, route-candidate depth, settlement
  p50/p95, and repeated failure signatures.
- **Resilience:** provider share and concentration risk.
- **NLQ:** deterministic questions over the already-loaded admin dataset, with no external
  model receiving company finance data.

## Forecast semantics

The driver model is a scenario engine, **not** an ML forecast.

Observed inputs:

1. trailing swap volume,
2. accrued fee capture,
3. recorded fee collection ratio,
4. non-fee cash receipts.

Founder planning inputs:

1. starting cash,
2. weekly fixed operating burn,
3. variable cost in basis points of volume,
4. weekly volume growth,
5. weekly non-fee cash growth.

Scenarios alter initial demand/cash conditions, fee capture, and fixed-cost pressure. Every
weekly point preserves its component drivers so the result can be explained and challenged.

## Process-mining boundary

Current process mining uses data already present in the execution system. It can measure
quote linkage, candidate depth, terminal success/failure, and row-created → completion
latency. It **cannot yet** claim precise dwell time for every canonical execution stage.

The long-term source of truth is the canonical execution lifecycle described by
`docs/adr/0006-canonical-execution-lifecycle.md`. Once each stage transition has a timestamped
event, process mining should move from aggregate proxies to stage-level conformance and
rework analysis.

## Finance-data authority ladder

**Level 0 — Operational proxy**
- execution records
- fee ledgers
- prepaid funding
- subscription state

**Level 1 — Cash source reconciliation**
- Stripe settlements/refunds/chargebacks
- on-chain treasury receipts
- bank/treasury balances

**Level 2 — Cost source reconciliation**
- Railway/Vercel/cloud
- RPC/market-data/provider invoices
- payroll/contractors
- legal/compliance/tax

**Level 3 — Accounting authority**
- chart of accounts
- recognized revenue schedules
- accruals/prepaids
- close adjustments
- reconciled statements

The UI must not label a lower level as a higher one.

## Operating cadence

### Weekly
- cash runway / scenario deltas
- payment failures and renewals at risk
- provider concentration and failed-route signatures
- largest execution-quality regressions
- infrastructure-cost anomalies once source feeds are connected

### Monthly
- reconcile cash sources
- reconcile provider/cloud spend
- contribution-margin cohorts
- subscription retention/recovery
- audit-chain verification and finance data-quality review
- close evidence packet

### Triggered review
Open a founder exception when any of these becomes true:

- base scenario breaches zero inside 13 weeks,
- one provider exceeds 50% of routed volume,
- p95 settlement latency doubles versus the prior comparable window,
- payment failure or overdue-renewal count rises materially,
- fee collection diverges from fee accrual,
- a finance source becomes stale or unreconciled.

These are review triggers, not autonomous authority to move money.
