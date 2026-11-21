# Rippling — payroll admin UI (Nov 2026)

Main source: PCMag's full review [pcmag.com/reviews/rippling](https://www.pcmag.com/reviews/rippling), read end to end. It describes the real screens; it may lag the current UI. Plus Rippling developer docs and product pages. help.rippling.com needs login; G2 403; the product tour is email-gated.

## Navigation & home
- Dashboard with a **left vertical pane**: **Tools** (Reports, Tasks, Documents, Custom Workflow Builder), **HR Management**, **Insurance & Benefits**, **IT Management**, **Finance** (incl. Payroll), **Settings**. [pcmag]
- Home body: **to-do list** "outlining work that needs attention" + **app tiles** (Payroll, Time Off, Time & Attendance, Custom Fields…) — apps are "separate-but-integrated apps, rather than menu items in a toolbar". Alt: "Rippling's Dashboard with tiles showing integrated apps". [pcmag]
- Sidebar path confirmed by docs: "From the sidebar, select **Tools > Approvals**". [dev docs](https://developer.rippling.com/documentation/rippling-platform/approvals/multiple-policies.md)
- **Data Manager**: central hub for field structure and custom fields. [pcmag]

## Pay run flow [pcmag]
1. **Payroll app landing:** list of upcoming pay runs; **top horizontal toolbar** → payroll settings, reimbursements, deductions & garnishments, accounting integrations, reports & tax documents; current payroll's **approval deadline** and **status**; lists of **Paid**, **Archived**, **Failed** payrolls.
2. **Payroll type** drop-down for non-regular runs: **Off-cycle**, **Termination**, **Correction**, + pay date range.
3. **Salaried employees** page: earnings table (salary, bonus…), tabs **Deductions** and **Settings** (direct deposit vs check); name opens profile in new window; add/custom earning types (PTO Hours = rate, hours, amount → wide scroll); edits apply to **this payroll only or all payrolls**.
4. **Hourly employees** page: hours from Rippling Time & Attendance, QuickBooks Time / Toggl, CSV import, or manual.
5. **Contractors** page ("**Next: Contractors**"): 1099 payments, reimbursements, more earning types.
6. **Preview Payroll:** header pay period, pay date, approval deadline; totals for direct deposits, employer & employee taxes, **total debit + debit date**; per-employee table **compared against either of the last two runs**; row link to pay stub; all underlying data viewable; link to **Cash Requirements Report** (by department, employee).
7. **Approve** → told how long you have to adjust; can **cancel** payroll.
- Entities on the same schedule processed as **separate groups** (PCMag calls this an extra step vs competitors). Multiple pay schedules per period; unlimited runs; multiple pay rates per employee; mid-period and future-dated salary changes; optional cash balance for overnight payroll.
- Marketing alt text: "Run payroll" screen pulling Benefits, Time and Attendance, Expense Management, Time Off; "payroll dashboard comparing employee gross pay across pay runs, with an AI prompt bubble asking what changed"; multi-currency commission pay run. [rippling payroll](https://www.rippling.com/products/payroll)
- Global: instant gross-to-net; changes up to 3 days before payday. [global payroll](https://www.rippling.com/products/payroll/global-payroll) Setup: 15-step checklist, each step unlocks the next (funding account, bank verification). [signup blog](https://www.rippling.com/blog/how-to-sign-up-for-rippling-payroll) Onboarding imports from prior provider (ADP, Gusto, Zenefits…). [pcmag]

## Approvals
- **Approvals app**: manage approval policies, see pending, review past requests; Payroll is an approvable type alongside hiring, offboarding, transitions, headcount, spend, time tracking, app integrations. [getting-started](https://developer.rippling.com/documentation/rippling-platform/approvals/getting-started.md)
- Conditions = attribute + operator + value; AND narrows, OR branches; requesters/approvers chosen via **Supergroups**. [getting-started]
- Multiple policies apply in set order → one request with multiple steps; an approver in several steps approves once. Reorder: Tools > Approvals → **Approval policies** tab → **Adjust priority** → drag → **Save changes**. [multiple-policies]
- Re-route when approver on vacation [permissions](https://www.rippling.com/platform/permissions); immutable audit logs per payroll action [review blog](https://www.rippling.com/blog/rippling-payroll-review).

## Permissions
- Profiles = **Scope** × **Access** (app data, e.g. Payroll) × **Actions** (view, edit, approve); attached to attributes via Supergroups; preview of access gained/lost. [permissions] "Granular down to the page and function level". [pcmag]

## Reports
- **New Report** → directory of **recipes** (by function, product, integration, use case) → variables (Employee, Payroll) + grouping (department, location) → **Start Building Report** → left pane customization (date range, columns) + filters → run, modify, share, save, download. Powerful, learning curve. [pcmag]
- Analytics: charts, pivots, calculated fields, AI-generated dashboards. [analytics](https://www.rippling.com/platform/analytics)

## Contractors / global
- Domestic contractors in their own run with 1099 columns. [pcmag]
- Global contractors: 180+ countries, 50+ currencies, 15+ payout options (Wise, Revolut, stablecoin, debit card); auto invoices, routed approvals; contractor dashboard (submit invoices, payment status, available funds). [global contractors](https://www.rippling.com/products/global/global-contractors)

## Employee side
- Employee detail: **Personal information**, **Documents**, **Payroll** (→ **Paystubs**, **Withholding**, **Settings**). "Limited mobile apps" is a con. [pcmag]

## UNVERIFIED
Exact current button labels; whether PCMag's flow is current; pay-run status enum beyond Paid/Archived/Failed; permission editor labels; mobile screens; payroll toolbar tab names.
