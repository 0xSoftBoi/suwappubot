# Founder CFO Control Plane

The founder finance view is a **read-only operational control plane**, not an accounting
system and not a fund-movement surface.

## Surface

- UI: `/admin` → **Finance**
- API: `GET /admin/finance`
- Auth: existing `X-Admin-Key` middleware
- Default observation window: trailing 30 days
- Forecast horizon: 13 weeks

The endpoint never writes balances, moves funds, changes billing, or changes execution
logic.

## What is measured

The control plane reads existing production ledgers and execution records:

| Metric | Source | Meaning |
|---|---|---|
| Direct payment inflow | `x402_payments` | completed direct payment cash inflow |
| Prepaid-credit inflow | `agent_credit_topups` | cash received for agent credits; **not recognized revenue** |
| Agent-subscription inflow | `agent_subscriptions` | cash received for prepaid subscription windows |
| Swap fees accrued | `fee_transactions` | fee amount earned/recorded by the swap fee system |
| Swap fees collected | `fee_transactions.collected` | recorded fees marked collected |
| Swap volume/outcomes | `swap_transactions` | observed execution volume, status, provider and measured execution economics |
| Quote funnel | `swap_route_candidates` | distinct observed quotes and quotes linked to an executed swap |
| Enterprise API activity | `api_usage_events` | usage-event count for the observation window |

`tracked30dUsd` is therefore **tracked cash inflow**, not GAAP revenue.

## 13-week scenarios

The endpoint still returns the original trailing-run-rate survival/base/growth forecast
for compatibility, but the founder UI now centers a **driver-based** downside/base/upside
model.

Observed drivers:

- trailing swap volume,
- accrued fee capture,
- recorded fee collection ratio,
- non-fee cash receipts.

Optional founder planning drivers:

- starting cash,
- weekly fixed operating burn,
- variable cost in basis points of volume,
- weekly volume growth,
- weekly non-fee cash growth.

Example:

```text
GET /admin/finance?cash_usd=50000&weekly_burn_usd=3000&variable_cost_bps=5&volume_growth_pct=2&non_fee_growth_pct=1
```

The scenarios explicitly alter demand/cash conditions, fee capture, and cost pressure.
They are scenario projections, **not an ML forecast**. The admin UI stores founder inputs
in browser `localStorage`; the API does not persist them. If cash or burn is absent,
cash-out and ending-cash fields remain unknown rather than inventing a balance.

## Payment cycles and process mining

The control plane also turns existing operational data into exception-oriented finance
signals:

- recurring crypto subscriptions active, due, and overdue,
- paid human subscriptions expiring within 30 days,
- Stripe failed-payment events already written to the tamper-evident audit log,
- quote-to-execution conversion and quote drop-off,
- average route candidates per quote,
- p50/p95 swap creation-to-completion latency,
- repeated failed-swap signatures by provider,
- provider volume share and concentration risk.

This is a baseline process-mining layer over facts Suwappu already records. It does not
yet claim stage-by-stage conformance timing for the canonical execution lifecycle. That
requires a timestamped event for every lifecycle transition.

The founder UI adds a bounded **exception queue** for runway breach, provider
concentration, payment recovery, fee-collection divergence, and funnel breakage. These
are review triggers only: they cannot move funds, contact customers, change billing, or
change routing.

See [CFO Agenda 2026 → Suwappu](cfo-agenda-2026.md) for the full twelve-point operating
system mapping.

## Data-quality boundary

The view is intentionally explicit about what it does **not** yet know:

- Stripe settlements, refunds and chargebacks
- Railway, Vercel, RPC, provider and observability costs
- payroll, contractor, legal, compliance and tax outflows
- bank and treasury balances unless entered as the planning cash input

Until those feeds are connected and reconciled, the page is an operational decision
surface, not a complete cash-flow statement.

## Accounting semantics

Do not relabel prepaid credit topups as revenue. Do not treat subscription cash receipts
as a revenue-recognition schedule. Do not assume `gas_cost_usd` or `fee_cost_usd`
represent company-paid infrastructure expense; they describe execution economics and can
be user-borne.

The control plane should become more authoritative by adding reconciled source feeds, not
by weakening these distinctions.

## Verification

Backend forecast arithmetic has a focused unit test in
`api-ts/src/__tests__/financeForecast.test.ts`.

For a deploy, verify:

1. `GET /admin/finance` rejects missing/invalid admin credentials.
2. The Finance section loads from the production admin dashboard.
3. Empty planning inputs keep runway/ending-cash unknown.
4. Supplying cash and burn changes only the forecast response and does not create DB rows.
5. Provider success/volume values reconcile to `swap_transactions` for the same 30-day window.
