# Payroll & Disbursement Engine ("Payflow") — Design

Status: **proposal** · Nov 2026 · Owner: TBD · MONEY-PATH (every phase needs `money-path-reviewer`)

## 0. The one-paragraph idea

Don't build "payroll". Build a **generic obligations → approvals → funding → settlement → ledger
engine** and ship payroll as the first *pack* on top of it. Payroll, contractor pay, DAO
contributor grants, affiliate/referral payouts, creator rev-share, AI-agent sub-contracting,
bounties, season/battle prizes, vendor AP and airdrops are all the same shape:

> *Someone owes a set of payees amounts computed by rules, on a schedule or on an event; a human
> or policy approves; a treasury funds it; a rail settles it; a ledger proves it; a document
> explains it.*

What Suwappu already has that Deel/Rippling/Gusto don't: **pay-in-anything / receive-in-anything
across 7+ chains** (the swap engine + CCTP/bridges), a **policy engine with kill switches**, a
**maker-checker approval system with step-up auth**, **KMS/Turnkey key custody with enclave
spend policies**, **OFAC screening**, and **Telegram + WhatsApp + Mini App** distribution to
payees who will never install an HR app. Payroll is mostly orchestration of things we've built.

---

## 1. What we reuse (grounded in current code)

| Need | Existing piece | Path | Gap to close |
|---|---|---|---|
| Tenant / company | `organizations`, `organization_members` | `api-ts/src/db/schema/organizations.ts` | `role` is a free varchar → needs real RBAC + multi-entity (legal entities under an org) |
| Org admin API | `/orgs`, members, api-keys, usage | `api-ts/src/routes/enterprise.ts` | add `/orgs/:id/payflow/*` route group |
| Admin UI shell | `Enterprise.tsx` (Mini App), `admin.ts` routes | `webapp/src/pages/Enterprise.tsx`, `api-ts/src/routes/admin.ts` | payroll dashboards (§6) |
| Maker-checker | `ApprovalService` + `approval_requests` + step-up challenges | `api-ts/src/services/ApprovalService.ts`, `schema/approvals.ts`, `schema/approvalStepUpChallenges.ts` | multi-step chains (N-of-M, amount-tiered) |
| Spend governance | `PolicyService.evaluate()` + `policy_decisions` + `policy_kill_switches` | `api-ts/src/services/PolicyService.ts`, `schema/policies.ts` | new intent type `disbursement.batch` |
| Enclave-level limits | Turnkey policies (allowlists, caps) | `bot/services/turnkey_policies.py` | payee-address allowlist synced from payee directory |
| Execution | `SwapEngine.execute_swap` (single choke point), `spending_limits.py` | `bot/services/swap_engine.py` | batched transfer executor (no swap when token matches) |
| Cross-chain USDC | CCTP relayers, LI.FI, Across, Wormhole | `bot/services/cctp_*.py`, `lifi_api.py`, `across_api.py` | route selection per payee preference |
| Recurring pulls | Base Spend Permissions executor | `api-ts/src/services/RecurringBillingService.ts` | reuse for *employer auto-funding* (pull from treasury Safe on schedule) |
| Gas sponsorship | paymaster, Tempo fee sponsor | `bot/services/paymaster.py`, `tempo_fee_sponsor.py` | payees receive with zero gas |
| Sanctions | OFAC list + compliance screening | `bot/services/ofac_list.py`, `compliance/compliance_service.py` | screen every payee at onboarding + every run |
| Audit trail | append-only `audit_logs` writer | `api-ts/src/services/audit.ts` | log every run state transition |
| Webhooks | durable dispatcher w/ retries | `bot/services/webhook_dispatcher.py` | generalise beyond approvals → `payflow.*` events |
| Event fan-out | `EventBus` (TS + py) | `api-ts/src/services/EventBus.ts`, `bot/services/event_bus.py` | payflow topics |
| Fiat billing | Stripe (`StripeService`, `webCheckouts`) | `api-ts/src/services/StripeService.ts` | charging *our* fee to the employer; fiat rails need a partner (§7) |
| Yield on idle float | Aave/Morpho treasury vault | `bot/services/treasury_vault_service.py` | park pre-funded payroll float until pay date |
| Tax docs | CSV/PDF export | `bot/services/tax_export.py` | payslips, 1099-NEC/K, year-end statements |
| Notifications | Telegram, WhatsApp templates, push, email | `bot/services/whatsapp_templates.py`, `push_service.py` | payslip + "you got paid" messages |
| Agent/API | A2A, MCP tools, agent routes, x402 | `api-ts/src/routes/{a2a,mcp,mcpTools,agent}.ts` | payflow MCP tools so agents can run/approve payouts within policy |
| Fiat-ish ramps | P2P escrow, providers | `bot/services/p2p_*.py` | off-ramp option for payees in unbanked corridors |
| Smart accounts | `SmartAccountService` | `api-ts/src/services/SmartAccountService.ts` | per-org treasury Safe/4337 account with session keys for the run executor |

**Conclusion:** ~60% of the platform surface exists. What's missing is the *domain layer*
(payees, comp, runs, ledger), the *batch executor*, the *document layer*, *fiat rails*, and the
*regulated-jurisdiction pieces* (tax calc, filings, EOR) which we integrate, never build.

---

## 2. Architecture: kernel + modules + packs

```
                ┌──────────────────────── Surfaces ────────────────────────┐
                │ Admin web (webapp Enterprise) · Payee Mini App · TG/WA bot│
                │ REST /orgs/:id/payflow · MCP tools · A2A · Webhooks · CSV │
                └───────────────────────────┬──────────────────────────────┘
                                            │
┌───────────────────────────── Packs (config, not code) ─────────────────────────────┐
│ payroll-w2 · contractor · dao-grants · affiliate · creator-revshare · agent-subcontract│
│ bounty · prizes · vendor-ap · airdrop · per-diem · commission                         │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │ declares: payee fields, earning types,
                                            │ rule set, schedule, approval chain, docs
┌──────────────────────────────── Modules (pluggable) ──────────────────────────────────┐
│ M1 Directory   M2 Compensation  M3 Inputs (time/usage/events)  M4 Calc engine          │
│ M5 Tax&Comply  M6 Approvals     M7 Treasury&Funding            M8 Settlement rails     │
│ M9 Ledger      M10 Documents    M11 Notifications              M12 Integrations (HRIS/GL)│
└───────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │
┌──────────────────────────────── Kernel (small, stable) ───────────────────────────────┐
│ Tenancy+RBAC · Run state machine · Double-entry ledger · Idempotency · Audit · Events  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**Rules of the kernel**
1. Kernel knows nothing about "salary" or "tax". It knows *payees, line items, runs, accounts, postings*.
2. Every module talks to the kernel through typed interfaces (`Effect` `Context.Tag`s in api-ts).
3. A **pack** is a JSON/YAML manifest + optional calc plugin. New use case = new pack, zero schema change.
4. Money only moves in M8, only after M6 says yes and `PolicyService` says allow, only against a
   run in state `APPROVED`, only with an idempotency key per line item.

### Where code lives

| Layer | Service | Why |
|---|---|---|
| Kernel, M1–M7, M9–M12 domain + API | **api-ts** (`src/payflow/*`, Drizzle) | it already owns orgs, approvals, policies, audit, enterprise routes |
| M8 settlement executor | **python-worker** (`bot/services/payflow_executor.py`) | signing, KMS, Turnkey, swap engine, CCTP, paymaster all live in Python |
| Handoff | Postgres outbox table `payflow_settlement_jobs` + `EventBus` | no new infra; same pattern as `agent_webhook_deliveries` |

Schema changes: Drizzle in `api-ts/src/db/schema/payflow.ts` **and** additive SQLAlchemy model +
`_ensure_schema()` entries for the tables the worker touches (`db-migrate` agent; see
`docs/development/migrations.md`).

---

## 3. Data model (kernel + core modules)

```ts
// api-ts/src/db/schema/payflow.ts  (sketch — all amounts NUMERIC(38,18) as string, never float)

legal_entities        id, org_id, name, country, tax_ids(jsonb, encrypted), base_currency,
                      treasury_account_id, status
payees                id, org_id, entity_id, kind('employee'|'contractor'|'agent'|'vendor'|'wallet'|'member'),
                      external_ref, display_name, email, telegram_user_id, whatsapp_e164,
                      user_id?(link to suwappu users), kyc_status, sanctions_status, status,
                      custom(jsonb — pack-defined fields, validated by pack schema)
payee_payout_methods  id, payee_id, rail('evm'|'solana'|'sui'|'btc'|'ach'|'sepa'|'wire'|'p2p'|'card'),
                      chain, address/account_ref(encrypted), asset, split_bps, priority, verified_at,
                      cooldown_until   -- changes trigger 48h cooldown + step-up (anti-ATO)
comp_plans            id, org_id, payee_id, pack, effective_from, effective_to,
                      components(jsonb: [{type:'salary',amount,period}, {type:'hourly',rate},
                      {type:'commission',rule_ref}, {type:'token_grant',vesting}]), currency
pay_schedules         id, org_id, entity_id, cadence(cron|'semimonthly'|'biweekly'|'event'),
                      period_anchor, pay_date_offset, funding_lead_days, timezone
inputs                id, org_id, payee_id, period_id, source('manual'|'csv'|'timesheet'|'hris'|
                      'usage_meter'|'event'), type, quantity, amount, ref, locked_by_run_id
pay_periods           id, schedule_id, start, end, pay_date, status
runs                  id, org_id, entity_id, pack, period_id?, kind('regular'|'off_cycle'|
                      'correction'|'reversal'|'event'), state(§4), totals(jsonb), fx_snapshot_id,
                      created_by, approved_at, funded_at, settled_at, idempotency_key
run_items             id, run_id, payee_id, gross, deductions(jsonb), employer_costs(jsonb), net,
                      currency, calc_trace(jsonb — every rule applied, for explainability), state
run_item_legs         id, run_item_id, payout_method_id, asset_out, chain_out, amount_out,
                      route(jsonb quote), settlement_job_id, tx_hash, status, fail_reason
ledger_accounts       id, org_id, entity_id, code, type('asset'|'liability'|'expense'|'equity'|'revenue'),
                      currency, external_gl_code
ledger_entries        id, org_id, run_id?, memo, posted_at, reversal_of?
ledger_postings       id, entry_id, account_id, amount(+/-), currency   -- Σ per entry = 0 (CHECK via trigger)
fx_snapshots          id, taken_at, rates(jsonb), source
documents             id, org_id, payee_id?, run_id?, type('payslip'|'1099'|'invoice'|'remittance'|
                      'statement'|'contract'), storage_key(R2), hash, issued_at
payflow_settlement_jobs  outbox → python worker (id, run_item_leg_id, payload, attempts, locked_at, status)
payflow_events        append-only domain events (also mirrored to audit_logs)
```

Reused as-is: `approval_requests`, `policies`, `policy_decisions`, `policy_kill_switches`,
`audit_logs`, `organizations`, `organization_members`, `users`, `wallets`.

---

## 4. The run state machine (the heart of it)

```
DRAFT ─► CALCULATING ─► CALCULATED ─► IN_REVIEW ─► APPROVED ─► FUNDING ─► FUNDED
  ▲            │              │            │  ▲         │          │         │
  └─ edit ─────┘ (errors)     └─ recalc ◄──┘  └─reject  │      fund_fail     ▼
                                                        │          │     SETTLING ─► SETTLED ─► CLOSED
                                               cancel ◄─┘          ▼         │  partial
                                                                CANCELLED    ▼
                                                                    PARTIALLY_SETTLED ─► retry/reissue
                                                                             │
                                                         REVERSAL run (new run, linked) ◄─ post-close fixes
```

Invariants:
- **Locking:** entering `CALCULATING` locks `inputs` for the period (`locked_by_run_id`). Late inputs go to the next run or an off-cycle.
- **Immutability:** after `APPROVED` the item set and amounts are frozen; any change = cancel + new run (with a diff shown to approvers).
- **Approval binds to a hash** of `(run_items, totals, fx_snapshot_id)` → approvers can't be bait-and-switched. Extends `ApprovalService` payload.
- **Funding gate:** `FUNDED` only when treasury balance ≥ Σ net + fees + gas buffer, verified on-chain (multicall3) — not by a DB number.
- **Policy gate:** `PolicyService.evaluate({intent:'disbursement.batch', total, max_item, new_payees, chains})` runs at `APPROVED→FUNDING` *and* per leg in the executor. Kill switches halt mid-run.
- **Settlement idempotency:** key = `run_item_leg_id`; worker checks for an existing tx hash / nonce before re-sending (same discipline as `execution_reconciler.py`, `withdraw_reconciler.py`).
- **Ledger posts at every money transition** (accrual at APPROVED, cash at SETTLED, reversal entries never deletes).

---

## 5. Modules in detail

### M1 Directory
Payees from manual add, CSV, invite link (payee self-onboards via Mini App or a Telegram deep link
`t.me/suwappubot?start=pay_<token>`), HRIS sync (M12), or *any Suwappu user by @handle/ENS*.
Each payee: KYC tier (none / light / full via partner), sanctions screen (existing OFAC + chain
analytics), payout methods with split support ("70% USDC on Base, 30% SOL on Solana").
Payout-method changes: step-up (passkey/2FA — `twofa.py`, `passkeyCredentials`), 48h cooldown,
notify on old channel. This is the #1 payroll fraud vector (redirect-the-paycheck ATO).

### M2 Compensation
Versioned comp plans with effective dating. Component types: salary, hourly, daily, commission,
bonus, reimbursement, allowance, token grant w/ vesting cliff, revenue share %, per-unit (usage).
Retro changes auto-generate correction items in the next run.

### M3 Inputs
Manual grid, CSV import with column mapping + dry-run validation, timesheet API, **usage meters**
(the agnostic bit: affiliate volume from `referrals`, agent task completions from A2A, creator
views, bounty merges via GitHub webhook, season points from `PointsService`). An input is just
`(payee, period, type, qty/amount, source_ref)`.

### M4 Calculation engine
- Deterministic, pure function: `calc(pack, comp_plans, inputs, fx, tax_provider) → run_items + calc_trace`.
- Rules = small typed DSL (JSON-logic style) per pack: `gross = Σ components`; `deductions` from
  tax provider + pack rules (benefits, garnishments, advances); `net = gross − deductions`.
- Every item stores a **calc trace** (rule → inputs → output) so payees and auditors see *why*.
- Preview/"what-if" mode for admins (change a rate, see the delta) — same function, no persistence.
- Rounding policy per currency; decimal math only (no JS floats; use `decimal.js` / Python `Decimal`).

### M5 Tax & compliance (integrate, don't build)
- **Gross-to-net + filings for W-2 employees:** partner embedded-payroll API (candidates: Check,
  Gusto Embedded, Symmetry Tax Engine + own filing). We send gross + jurisdictions, get withholdings
  + employer taxes back, they file and remit to agencies via fiat.
- **International employees:** EOR partner API (Deel / Remote / Oyster). We orchestrate, they employ.
- **Contractors:** no withholding; collect W-9/W-8BEN in onboarding, generate 1099-NEC (US) via
  partner (Track1099/Tax1099 API) or self-generate; VAT invoices for EU contractors.
- **Crypto-specific:** FMV at payment time recorded per leg (from `fx_snapshots` + `price_service.py`)
  → employer and payee cost-basis reports (extend `tax_export.py`). IRS treats crypto wages as wages
  at FMV — the trace makes this auditable.
- Sanctions + travel-rule metadata on legs ≥ thresholds.

### M6 Approvals
Reuse `ApprovalService`. Add: approval **chains** per pack (`preparer → finance → CFO if total >
$X`), N-of-M, approver ≠ preparer (SoD), step-up on final approve, expiry, delegation while OOO,
approvals from Telegram/WhatsApp buttons (already supported by `approval_notifier.py`), and
optional **on-chain co-sign** (Safe multisig) for treasuries that want it.

### M7 Treasury & funding
- Per-entity treasury account: Safe or 4337 smart account (`SmartAccountService`) or Turnkey wallet.
- Funding modes: (a) pre-funded float, (b) just-in-time pull via Spend Permissions
  (`RecurringBillingService` pattern), (c) fiat-in via partner (ACH/wire → USDC, e.g. Bridge/Circle Mint),
  (d) swap-to-fund from any treasury asset via `SwapEngine` (pay ETH-treasury → USDC payroll).
- Funding forecast: next 3 runs' cash needs vs balance → alerts N days ahead.
- Idle float earns yield (`treasury_vault_service.py`), auto-withdrawn T-1 before pay date. Opt-in, clearly disclosed.

### M8 Settlement rails (python worker)
Rail adapters behind one interface `quote(leg) / send(leg) / status(leg)`:
| Rail | Implementation | Notes |
|---|---|---|
| Same-chain token transfer | batched ERC-20 transfers via Multicall/Disperse, SPL batch on Solana | cheapest path, no swap |
| Cross-chain / cross-asset | existing swap engine + CCTP/LI.FI/Across | payee picks asset+chain; employer pays one asset |
| Streaming | Sablier/Superfluid adapter (new) | real-time salary, vesting grants |
| Fiat ACH/SEPA/wire | partner (Bridge, Modern Treasury, Column, Increase; Monerium for SEPA) | regulated; never build |
| Card | Gnosis Pay / Immersve top-up (per NEOBANK_ROADMAP) | payee spends instantly |
| P2P off-ramp | existing P2P escrow providers | unbanked corridors |
| Internal | credit a Suwappu user's in-app wallet | zero fee, instant, keeps funds in ecosystem |
Gas paid by paymaster; payee receives exact `amount_out` where rail supports exact-out.
Failure handling: per-leg retry with backoff → reroute to fallback method → mark `FAILED` → funds
stay in treasury, item reissued in next off-cycle. Never double-send (§4).

### M9 Ledger
True double-entry, multi-currency. Chart of accounts template per pack (e.g. Wages Expense,
Employer Tax Expense, Payroll Liabilities, Treasury USDC, Clearing, FX Gain/Loss, Fees). Every run
reconciles: Σ settled tx (on-chain, verified via RPC/Blockscout) = Σ cash postings. Daily
reconciler job flags drift. Exports + live sync to GL (M12).

### M10 Documents
Payslips (PDF, branded per org), remittance advice, contractor invoices (auto-generated self-billing),
1099/year-end statements, crypto FMV statements, signed contracts (e-sign partner later).
Stored in R2 (Cloudflare connected), content-hashed, optionally anchored on-chain (hash in a cheap
Base tx) for tamper evidence — free differentiator.

### M11 Notifications
"You've been paid $3,200 → 3,200 USDC on Base (tx…)" via Telegram/WhatsApp/email/push; payslip
link; admin alerts (funding shortfall, failed legs, approval pending, payout-method changed).
Templates per pack, per locale.

### M12 Integrations
- **HRIS** (people, comp, terminations): unified API via Merge.dev or Finch → covers 50+ HRIS.
- **Accounting/GL**: QuickBooks, Xero, NetSuite (journal entries per run; mapping UI for accounts).
- **Time tracking**: Harvest, Toggl, Deputy via webhook/CSV.
- **Identity**: SSO (SAML/OIDC via WorkOS), SCIM provisioning for admins.
- **Outbound**: webhooks (`payflow.run.approved`, `.settled`, `.item.failed`, `payee.method_changed`) via generalised `webhook_dispatcher.py`; signed (HMAC) and replayable.

---

## 6. Surfaces: flows & dashboards

### Personas
| Persona | Surface | Core jobs |
|---|---|---|
| Org owner / CFO | Admin web | fund treasury, set policies, final approve, reports |
| Payroll admin / ops | Admin web + TG | manage payees, import inputs, run payroll, fix failures |
| Approver | TG/WA buttons, web | review diff, approve with step-up |
| Payee | Mini App, TG, WA, email link | onboard, set payout method, see payslips, get paid |
| Auditor / accountant | read-only web, exports | ledger, docs, audit log |
| AI agent | MCP / A2A / REST | create event runs within policy, query status |
| Suwappu internal admin | `admin.ts` | tenant health, failed settlements, fee revenue, risk |

### Key flows
1. **Company onboarding** — create org → KYB (partner) → create legal entity → deploy/attach treasury
   account → pick pack(s) → set approval chain + policy limits → invite admins (SSO optional) → fund.
2. **Payee onboarding** — invite (email/TG/WA/link/CSV) → payee opens Mini App → light KYC (or full
   for fiat rails) → tax form (W-9/W-8BEN) → payout method(s) + split → sanctions screen → `ACTIVE`.
3. **Regular run** — schedule opens period → inputs flow in → T-N: auto-`CALCULATE` → admin reviews
   exceptions (new payees, >X% variance vs last run, failed screens) → submit → approval chain →
   funding check (auto-pull if configured) → settle on pay date → notifications + payslips → ledger
   close → GL sync.
4. **Off-cycle / bonus / event run** — ad-hoc or triggered by event (bounty merged, agent task done,
   season ended). Event runs can **auto-approve within policy** (e.g. ≤$500/item, ≤$5k/day, known
   payees) — this is what makes it agnostic for agent and rewards use cases.
5. **Correction / reversal** — new linked run; ledger reversing entries; payee notified with diff.
6. **Failure recovery** — failed legs board → retry / switch method / reissue next run / cancel.
7. **Termination** — final pay calc, stop future runs, revoke payee access after last payslip window.

### Admin dashboard (web; extend `webapp/src/pages/Enterprise.tsx` → Payflow section)
- **Home:** next pay date countdown, funding coverage gauge (balance vs next 3 runs), runs needing
  action, failed legs, pending approvals, payee onboarding funnel.
- **Runs:** list + detail (items grid, variance vs last run highlighted, calc trace drill-down,
  approval timeline, settlement progress per leg with tx links).
- **People:** payee directory, status, KYC/sanctions badges, payout methods (masked), comp history.
- **Treasury:** balances per entity/chain/asset, funding history, forecast chart, yield on float.
- **Policies & approvals:** limits, chains, kill switches (reuse PolicyService UI if exists).
- **Reports:** payroll register, cost by department/entity, tax liabilities, FMV report, ledger,
  GL export, audit log.
- **Settings:** entities, schedules, packs, integrations, webhooks, API keys, branding.

### Payee app (Mini App page `Payflow.tsx` + bot commands)
Next payday + estimated net, payslip history with calc trace in plain language, payout method
manager (with cooldown UX), split slider, tax docs download, "convert my pay" (one tap into swap),
"earn on idle pay" (savings vault), off-ramp. Bot: `/pay` summary, push on payment.

### Suwappu internal admin
Tenants, volume, fee revenue, settlement failure rate by rail/chain, stuck jobs, risk flags
(rapid payout-method changes, new payee + large first payment), partner health.

---

## 7. Enterprise parity checklist

Benchmarks: Rippling, Deel, Gusto, Remote (payroll/EOR); Request Finance, Toku, Bitwage, Rise
(crypto payroll); Tipalti/Bill.com (payables).

| Capability | Parity bar | Ours | Build / Integrate |
|---|---|---|---|
| Multi-entity, multi-country | yes | orgs only | **Build** legal_entities |
| RBAC + SoD | granular roles | varchar role | **Build** role/permission matrix |
| SSO / SCIM | SAML, OIDC, SCIM | none | **Integrate** WorkOS |
| Audit log | immutable, exportable | `audit_logs` | extend |
| Maker-checker approvals | chains, N-of-M | single approval | **Build** on ApprovalService |
| Gross-to-net tax (US) | federal/state/local | none | **Integrate** Check / Gusto Embedded / Symmetry |
| Tax filing & remittance | quarterly/annual | none | **Integrate** same partner |
| EOR international | 100+ countries | none | **Integrate** Deel/Remote API |
| Contractor compliance | W-9/W-8, 1099, VAT invoices | none | Build forms + integrate 1099 e-file |
| Benefits & deductions | 401k, health, garnishments | none | Integrate via payroll partner; deductions engine in M4 |
| Time & attendance | native or integration | none | Integrate |
| Fiat payouts ACH/SEPA/wire/local | 150+ countries | none | **Integrate** Bridge / Modern Treasury / Monerium / local partners |
| Crypto payouts any chain/asset | rare (Toku, Rise) | **strong** (swap engine, 7+ chains) | **Differentiator** |
| Streaming pay / EWA | rare | none | Build Sablier/Superfluid adapter; earned-wage access via streams |
| Payslips & docs | yes | tax_export only | **Build** M10 |
| GL sync | QBO, Xero, NetSuite | none | **Integrate** (direct or Merge accounting) |
| HRIS sync | 50+ | none | **Integrate** Merge/Finch |
| Reporting | register, cost, liabilities | none | **Build** |
| Off-cycle, corrections, reversals | yes | n/a | **Build** (state machine) |
| Fraud controls | method-change cooldown, anomaly | 2FA, passkeys, OFAC | Build anomaly rules on PolicyService |
| KYC/KYB | yes | partial | **Integrate** Persona/Sumsub |
| Data protection | SOC 2 Type II, encryption, retention | KMS envelope encryption | Encrypt PII columns w/ existing KMS; SOC 2 program (Vanta/Drata) |
| SLA / status / support | yes | health monitor, support tickets | extend |
| API + webhooks | full | strong base | Build payflow endpoints + SDK types in `packages/sdk` |
| AI agent control | none of the incumbents | **MCP/A2A/policy** | **Differentiator** |

### The regulatory line (same discipline as `NEOBANK_ROADMAP.md`)
- **We can build:** directory, calc orchestration, approvals, ledger, crypto settlement, docs,
  contractor & DAO & agent & rewards payouts, streaming.
- **Must partner:** US/intl tax withholding & filing, EOR, fiat money movement (money-transmission
  licences), card issuance, full KYC/KYB. We are the *orchestrator + crypto rail*; partners are the
  regulated rails. Don't let this silently shrink scope — partners are part of the product.

---

## 8. Packs (proof of agnosticism)

| Pack | Payee kind | Inputs | Schedule | Approval | Rail default | Docs |
|---|---|---|---|---|---|---|
| `payroll-w2` | employee | salary/hours | biweekly | preparer→CFO | fiat via partner (+ optional crypto split) | payslip, W-2 (partner) |
| `contractor` | contractor | invoices/hours | monthly or on invoice | manager→finance | USDC any chain / fiat | invoice, 1099 |
| `dao-grants` | member/wallet | milestones | event | Safe multisig | token transfer / stream | remittance |
| `affiliate` | user | `referrals` volume | weekly | auto ≤ policy | internal wallet / USDC | statement |
| `creator-revshare` | user | usage meter | monthly | auto ≤ policy | USDC | statement |
| `agent-subcontract` | agent | A2A task receipts | event | auto ≤ agent spend profile | x402/USDC | receipt |
| `bounty` | wallet/user | GitHub/issue event | event | maintainer | USDC | receipt |
| `prizes` | user | battle/season results | event | ops | internal wallet | — |
| `vendor-ap` | vendor | bills | due-date | AP chain | fiat/USDC | remittance |
| `airdrop` | wallet | CSV/snapshot | one-off | 2-of-N | batch transfer | — |

A pack manifest:
```yaml
id: affiliate
payee_kind: user
payee_schema: { required: [user_id] }
inputs: [{ type: referral_volume, source: usage_meter, meter: referrals.volume_usd }]
components: [{ type: revshare, rate_bps_from: comp_plan.rate_bps, base: referral_volume }]
schedule: { cadence: "0 12 * * MON", pay_date_offset: 0 }
approval: { mode: auto, policy: { max_item_usd: 500, max_run_usd: 20000 } }
rail_default: internal
documents: [statement]
ledger_template: revshare_v1
```
Internal dogfood: migrate **referral payouts, season/battle prize payouts and fee-sweeper
distributions** onto Payflow first → the engine is proven on our own money before customers.

---

## 9. API surface (sketch)

```
POST   /orgs/:org/payflow/entities                 GET .../entities
POST   /orgs/:org/payflow/payees  (bulk ok)        GET/PATCH .../payees/:id
POST   /orgs/:org/payflow/payees/:id/methods       (step-up required)
POST   /orgs/:org/payflow/comp-plans               GET .../comp-plans?payee=
POST   /orgs/:org/payflow/inputs  (bulk, CSV)      POST .../inputs/import (dry_run=true)
POST   /orgs/:org/payflow/runs                     GET .../runs, .../runs/:id
POST   /orgs/:org/payflow/runs/:id/calculate|submit|approve|reject|fund|cancel|retry
POST   /orgs/:org/payflow/runs/:id/preview         (what-if, no persistence)
GET    /orgs/:org/payflow/treasury                 GET .../treasury/forecast
GET    /orgs/:org/payflow/ledger?from=&to=         GET .../reports/:type
GET    /orgs/:org/payflow/documents/:id
POST   /orgs/:org/payflow/webhooks
GET    /payflow/me  (payee self-serve: payslips, methods, next pay)
MCP:   payflow_create_event_run, payflow_run_status, payflow_list_payees, payflow_preview
```
All mutating endpoints: `Idempotency-Key` header required; RBAC permission check; audit write.
Types in `packages/sdk/src/types.ts` (affects api-ts, webapp, mobile).

---

## 10. Pricing hooks (how this makes money)
- Per-payee-per-month SaaS (Stripe subscription on `organizations.stripeSubscriptionId` — exists).
- Settlement fee bps on crypto legs (reuse `fee_config`/`fee_transactions`); 0 on internal rail.
- FX/swap spread already earned by the swap engine when payee asset ≠ funding asset.
- Yield share on float (disclosed).
- Partner rev-share on fiat/EOR/tax.

---

## 11. Phased build

| Phase | Scope | Exit criteria (live, not CI) |
|---|---|---|
| **P0 Kernel** (2 wk) | `payflow.ts` schema + SQLAlchemy mirror, run state machine, ledger w/ zero-sum trigger, idempotency, audit, events, RBAC matrix | create→calc→approve a run on dev with ledger balancing |
| **P1 Crypto contractor + internal dogfood** (3 wk) | M1 (no KYC partner), M2 basic, M3 manual/CSV, M4 simple, M6 chains, M7 pre-funded Safe, M8 same-chain batch + cross-chain via swap engine, M11 TG/WA, basic M10 receipts; migrate referral payouts | real payout to 3 test payees on Base + Solana on testnet, then $1 mainnet; referral payouts running on Payflow |
| **P2 Dashboards** (2 wk) | Admin web (home/runs/people/treasury/reports), payee Mini App page, internal admin | screenshot-verified on prod URL |
| **P3 Agnostic packs** (2 wk) | pack manifests + DSL, usage meters, event runs w/ auto-approve-in-policy, MCP tools, webhooks | affiliate + prizes + agent-subcontract packs live |
| **P4 Fiat + compliance** (4–6 wk, partner-gated) | KYB/KYC partner, fiat payout partner, 1099/W-8 forms, FMV reports, GL sync (QBO/Xero) | one real ACH/SEPA payout; QBO journal posted |
| **P5 Full payroll parity** (partner-gated) | embedded US payroll tax partner, EOR, benefits/deductions, HRIS sync, SSO/SCIM, streaming pay, SOC 2 program | first W-2 run via partner |

Each phase: builders tag `MONEY-PATH`, `money-path-reviewer` + `security-auditor` gate, `scripts/verify.sh`,
live end-to-end payout as proof (CLAUDE.md standing rule #2).

---

## 12. Open decisions (need a human)
1. **First wedge:** crypto-native contractor/DAO payroll (fast, no partners) vs. W-2 payroll (slow, partner-gated). Recommendation: **contractor + internal dogfood first**.
2. **Tax partner** for US W-2 (Check vs Gusto Embedded vs Symmetry) — price + API maturity call.
3. **Fiat partner** (Bridge vs Modern Treasury vs Column) — corridor coverage vs cost.
4. **Custody model per org:** customer-owned Safe (non-custodial, we hold a session key) vs Turnkey org wallet (smoother UX, more custodial obligations). Recommendation: Safe default, Turnkey option.
5. **Yield on float:** opt-in default off? (regulatory + disclosure).
6. **Brand:** "Suwappu Payflow" vs separate product name for B2B buyers.
