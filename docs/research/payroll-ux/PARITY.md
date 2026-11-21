# Payroll admin UX — parity spec (sourced)

Every row cites the research file that verifies it: **G** = `gusto-rippling.md`, **D** = `deel-verified.md` / `deel-remote-adp.md`, **R** = Remote (in `deel-remote-adp.md`), **A** = ADP, **C** = `crypto-payroll.md`. "Ours" is what the Payday prototype (`docs/plans/payday-prototype.html`) now implements. Items without a source are **not** parity claims.

## 1. Information architecture
| Area | Benchmark | Source | Ours |
|---|---|---|---|
| Left nav | Gusto areas: Payroll (Pay), People, Reports, Taxes & compliance, Time & attendance, Benefits, App directory, Company settings. Deel: Payroll → Payroll cycles, People, Contractors, Expenses, Reports (Analytics), Time off, Organization settings | G pass 2, D | Home · Pay · People · Approvals · Reports · Taxes & compliance · Settings |
| Notifications | Bell in top nav with **Tasks** + **Activity** tabs; approval requests show as a Home task | G | Bell with Tasks / Activity; approvals as tasks |
| Home | Upcoming payrolls with **run-by date** + **payday**; to-dos; Remote "Things To Do" | G, R | Upcoming payrolls card, to-dos, cash requirements |

## 2. Pay runs
| Capability | Benchmark | Source | Ours |
|---|---|---|---|
| Run wizard | Hours & Earnings → Time off / Benefits / Deductions → Review and Submit | G | 3 steps, same order |
| Grid | Spreadsheet view, search/sort/filter, **bulk edit**, per-row Actions | G | Editable grid with filter + bulk set |
| Review | Three summaries: what gets taxed & debited / what employees take home / what company pays | G | Same three blocks |
| Variance | Gross Pay Variance per employee vs previous run, drill into items; ADP AI anomaly detection | R, A, G (Rippling) | Variance column + flagged rows |
| Alerts | Pre-submit alerts that never change pay | G | Alert list on review |
| Statuses | Unprocessed → Submitted → Pending → Paid (edit only Unprocessed, cancel only Submitted); Deel "Awaiting approval"; Remote Finalized | G, D, R | Draft → Awaiting approval → Submitted → Paid |
| Calendar | Remote milestones (input cutoff → review → approval → pay day); Deel: Start, Submission, Publication, Approval | R, D | Payroll calendar list with milestones |
| Speeds | Next-day, 2-day, 4-day; Same-day + Instant (eligible) | G | Speed selector on review |
| Run types | Regular, Bonus (supplemental rate), Correction, Dismissal, past check date, contractor | G | Off-cycle menu with those types |
| AutoPilot | Runs 1 day before deadline, 24 h to change/cancel | G | AutoPilot toggle per schedule |
| Cancel/reverse | Cancel unprocessed; reverse processed | G | Cancel on submitted run |

## 3. Approvals & roles
| Capability | Benchmark | Source | Ours |
|---|---|---|---|
| Rules | Trigger on Amount and/or Country/entity; sequential approvers; Approve / Request changes + comment; auto approve | R | Rule builder + approval chain |
| Approver actions | Submit / Edit / Decline | G | Approve / Request changes |
| Stuck approvers | Warn when approver inactive/OOO | R | Warning chip |
| Roles | All access admin, Custom admin, People manager, Outside collaborator (Gusto); Org Admin, Group Admin, Integrations Admin, IT Developer Admin, custom (Deel); access levels by entity/country (Remote) | G, D, R | Role table with those types + scope |

## 4. People
| Capability | Benchmark | Source | Ours |
|---|---|---|---|
| Worker types | Employees, contractors (US + international), EOR | G, D | Employee / Contractor tabs, international flag |
| Payout | Split across multiple accounts | G | Split shown on profile |
| Withdrawal menu (worker) | Card, bank, instant card, Wise, PayPal, Payoneer, Revolut, Coinbase, stablecoin; speed + fee shown | D | Their view: method list with speed + fee |
| Crypto | Payee chooses asset/network; FX locked before confirm; gas sponsored (Deel) | C | Payee picks; gas sponsored |

## 5. Reports
Gusto standard: Reports by department, Workforce costing, Job costing, Labor cost allocation, Time off, Time-tracking hours, **Cash requirements**, Workers' comp audit, Pre-tax benefit accounts, Compensation change history, Pay history (G). Remote: Payroll Cost, Variance, General Ledger, Gross-to-Net, Payroll Run (R). Deel categories: Finance, Benefits, People, Payroll, Contracts, Productivity, Time Off (D). Export PDF/CSV/XLSX, saved custom reports (G). **Ours:** catalog of these with categories + custom builder entry.

## 6. Taxes & compliance
Gusto: forms & taxes filed for you, workers' comp, end of year, compliance hub, state registrations, tax notices, agency payments, tax credits (G). **Ours:** same sections, filings table. Needs a tax partner to be real (see `docs/plans/payroll-engine.md` §7).

## 7. Enterprise settings
SAML SSO, SCIM, signed webhooks, API, custom roles (R, D); GL sync QBO/Xero/NetSuite by department/location (G Rippling); multi-entity (R, D). **Ours:** Settings tabs: Entities, Roles, Pay schedules, Integrations, Security (SSO/SCIM), API & webhooks.

## Where we beat them (sourced complaints)
- Support on complex issues is the #1 complaint for Gusto and Deel (G, D).
- Withdrawal fees high (Deel 0.75–2.5%, Coinbase 1.5%) (D) — our internal + stablecoin rails are free.
- Analytics/exports weak (D).
- Rise payees pay gas and KYC stalls withdrawals (C) — we sponsor gas.

## Still unverified (don't build to these as "parity")
Gusto in-app left-nav exact labels; Rippling nav/home/profile; Deel home widgets and contractor approve→pay screen; audit-log UIs at all vendors.
