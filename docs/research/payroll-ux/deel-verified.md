# Deel — business admin UI, verified from help-article step text (Nov 2026)

B = https://help.letsdeel.com/hc/en-gb/articles/ . G2 blocked us (403); app.demo.deel.com is login only.

## Sidebar & home
- Sidebar items named in steps: **People > Directory** ("All People view", "View as report", page menu "Edit worker details") B/4407745509393; **Payroll > Payroll cycles** B/18940617896593; **Payroll > Expenses & adjustments** B/33187268687249; **Finance > Billing** ("Billing is under Finance, not under Payroll") B/20301708484753; **Analytics** → Analytics overview, Dashboards, Reports, Salary insights B/41219624525969.
- Home: gear icon top-right → **Organization settings** B/34213615532817; **"All tasks" card** where approvers see review queues (Approve/Deny, pending count, approvers still needed) B/4413917954833.
- Org settings > All Settings groups: Entities; Human Resources > Settings > Contract (tab "Invoicing policies"); Security > Roles and permissions; Audit Logs > Payroll Calendar Logs. B/34213615532817 B/36911618239377 B/34060994869265 B/34654118966801

## Contractor pay flow — Finance > Billing > Invoices tab (B/20301708484753)
1. Tick invoices → count + estimated total + "Clear selection" → **Pay selected** (lower right).
2. **Pay your team** review: invoice types, "Bill to entity", total, applied balances/billing credits, "Total due".
3. **Select payment method** → "Change method" panel (saved methods with currency + provider fee) → **Update** → **Continue**.
4. **Confirm payment** dialog (Confirm / Cancel).
5. "Payment confirmed — Your payment is now processing" (Review details ✓, Payment confirmation ✓) → **Track payment**, **Share receipt**, **Download CSV**, **Download PDF**.
- Bulk download invoices zip. One-off payment from People > Directory → contract; approved before invoice; 30-day due; payout after invoice paid. B/4407745509393
- Editing an issued invoice: original Pending → **Credited**, credit note **Processed** + new invoice. Issue date ~5 days before client pays. B/18511222029585
- Invoicing policies: Create (name, description, cycle monthly/weekly/bi-weekly/semi-monthly); assigned at contract step "Payments and Dates"; statuses ACTIVE / AWAITING SIGNATURES; "Contracts Without Policies" view; bulk assign via Bulk edit workers. B/36911618239377
- Payment-item approvals: Approve / Deny / Reject; group toggle "Require approval for payment items" (Additional items only / All items); all approvers must approve, one rejection denies; Org Admins can always approve. B/4413917954833

## Funding (B/4407745380241)
Pay-in currency → paid out in local currency; forward rate locked once currency selected; no FX if same currency. Provider fees: cards US/EU $0.30 + 2.9%, other cards $0.30 + 3.9%, ACH $5, SEPA $5. 20+ funding currencies. Org Admins set preferred payment methods per group (B/37998881614225).

## Global payroll
- Statuses: Awaiting Report Submission → **Awaiting approval** → **Awaiting funding** (Deel pays) or **Awaiting payments** (client pays locally) → **Processing Funding** → **Done**; resubmitted = Pending Approval; Rejected. B/9766778603281
- Approve: Payroll cycles → **Review** on cycle "Approval is due today" → "Review payroll package" (G2N .csv, payslips .zip) → **Approve Payroll** or **Report issues** ("Reject payroll package", "Add Issue", "Submit Issues") → **Payment tab** with **Payment Tracker** ("Mark as Paid"). B/18940617896593
- Pay: Payment tab → **Pay Funding** → method; badge Awaiting Funding → Done. B/9079111332625
- Calendar: **View Payroll Calendar** (monthly/yearly), milestones Start Date, Payroll Approval, Timesheet Cut Off; **Edit Payroll Calendar** (Open bulk edit, Starts from, Set final cycle); some edits need Deel approval. B/34654118966801
- **Payroll automations** (Org Settings > Entities > entity > Payroll tab): Automatic payroll submission + Automatic payroll approval, each with a variance-threshold %; exceeded → ≥2 selected admins notified. B/42921304820497

## Approval policies (B/34213615532817)
Org settings > Entities > entity > **Payroll Policies** > **Create a policy** → 3 steps: **1 Policy information** (payroll group, name, flow type Payroll submission / Payroll package approval), **2 Approvers** (Level 1, 2, 3…; By role or By specific user; optional Substitute Approver; same level parallel and all must approve; levels sequential), **3 Notification** (email toggle) → **Create**. Expense policies: Payroll > Expenses & adjustments tabs Module activation / Categories / Approval policies. B/33187268687249

## Roles
Organization Admin, IT Developer Admin, Integrations Admin - People, Integrations Admin - Bookkeeper; group manager roles Viewer (non-sensitive), Viewer (sensitive), Approver. B/37998881614225 B/4413917954833 Custom: Security > Roles and permissions > Roles tab > **Create role** → "Create your own" or "Use template"; name, permissions, access scope. B/34060994869265

## Analytics
Overview with pinned Favorite Reports / Dashboards (Edit, Add, Apply, drag reorder). Reports list columns Name, Owner, Type, Data model, Created; filters Favorites / Created by you / categories; **Create report** → Report Builder (data-model cards: Global G2N, Terminations, Taxes, Bank Details, HR Audits, 25+) → columns, filters, sort, name → access you / team / org. B/41219624525969 B/51143596016401

## Withdrawals (worker)
Deel Card, bank transfer, Instant Card Transfer, Coinbase, PayPal, Payoneer, Revolut, Wise, Deel Wallet, stablecoin; Pix, Alipay, DolarApp, AstroPay by country. B/14391453263505

## UNVERIFIED
Home widgets beyond "All tasks"; full sidebar list; contractor auto-pay; full funding-method list (crypto, wire); EOR approval specifics; worker app screens.
