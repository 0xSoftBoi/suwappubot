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

The API derives a weekly inflow run-rate from the trailing 30-day tracked cash inflow and
projects three cases:

- **Survival:** 0.5× trailing inflow
- **Base:** 1.0× trailing inflow
- **Growth:** 2.0× trailing inflow

Starting cash and weekly operating burn are optional planning inputs. The admin UI stores
them in browser `localStorage` and sends them as query parameters:

```text
GET /admin/finance?cash_usd=50000&weekly_burn_usd=3000
```

They are deliberately not persisted in Suwappu's production database. Without both
inputs, ending-cash and runway fields remain unknown rather than inventing a number.

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
