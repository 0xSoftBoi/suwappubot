# Payroll admin UX — parity spec v2 (screen-level, sourced)

Sources: **G** `gusto-verified.md` · **R** `rippling-verified.md` · **D** `deel-verified.md` · **Rm** Remote in `deel-remote-adp.md` · **C** `crypto-payroll.md`. Each file cites the exact help article or review for every label. "Ours" = `docs/plans/payday-prototype.html` v4.

## 1. Shell
| Element | What the leaders actually ship | Src | Ours |
|---|---|---|---|
| Left nav | Gusto: Home, Pay, People, Reports (+ Billing, Settings via name menu). Rippling: Tools (Reports, Tasks, Documents, Workflow builder), HR, Benefits, IT, Finance (Payroll), Settings. Deel: People > Directory, Payroll > Payroll cycles / Expenses & adjustments, Finance > Billing, Analytics (overview, dashboards, reports) | G R D | Home · Payroll (Run payroll, Payroll cycles, Contractors) · People › Directory · Finance › Billing · Approvals · Analytics › Reports · Taxes & compliance · Org settings |
| Home | Gusto **Tasks** widget (top 3, "View all tasks") + **Recent activity** ("View all updates"); Deel **All tasks** card; Rippling to-do list + app tiles | G D R | Tasks (top 3 + View all) · Recent activity · upcoming payroll tile |
| Top bar | Bell → Notifications Center **Tasks / Activity**; help icon; name menu → Settings; Deel gear → Organization settings | G D | Bell (Tasks/Activity), help, gear → Org settings |

## 2. Run payroll
| Step | Leaders | Src | Ours |
|---|---|---|---|
| Entry | Pay → payroll tile with **Payroll deadline** + **Payday** → **Run payroll**; **Skip payroll**; Rippling type drop-down Off-cycle / Termination / Correction | G R | Same tile + Skip + type menu |
| Grid | Spreadsheet: **Columns** button, Regular hours / Overtime hours / Double overtime, one-time earnings (bonus, commission, correction, custom), reimbursements, personal note; Rippling tabs Earnings / Deductions / Settings and "this payroll only vs all payrolls" | G R | Spreadsheet with Columns toggle, those columns, Earnings / Deductions tabs |
| Groups | Rippling separates Salaried → Hourly → Contractors ("Next: Contractors"); PCMag flags as extra friction | R | Single grid with Salaried / Hourly filter (beat it) |
| Review | **Review summary**: **Flagged pay changes or trends** with **Edit / Dismiss**; **What will get taxed and debited / What your employees worked and take home / What your company will pay**; withdrawal amount. Rippling Preview compares to **either of last two runs** + Cash Requirements link | G R | Exactly these, plus compare-to selector |
| Submit | **Submit payroll** or **Request approval** (locks payroll) | G | Same |
| Confirmation | **See the full summary · Export payroll details · Download cash requirement report · Cancel this payroll** | G | Same |
| Speeds/cutoff | 4-day / 2-day / next-day / same-day; 4 pm PT run-by; cancel before debit | G | Same |
| Automation | Gusto **Payroll on AutoPilot**; Deel **Automatic payroll submission / approval** with **variance threshold %** | G D | AutoPilot + variance guardrail |

## 3. Payroll cycles & calendar
Deel statuses **Awaiting approval → Awaiting funding → Processing funding → Done** (+ Rejected); Gusto Unprocessed → Submitted → Paid; Rippling lists Paid / Archived / Failed; calendar milestones Start Date, Timesheet Cut Off, Payroll Approval (D); **View activity log** from pay history (G). **Ours:** cycles table with those statuses, calendar, history tabs Paid / Failed, activity log.

## 4. Approvals
| | Leaders | Src | Ours |
|---|---|---|---|
| App | Rippling **Tools > Approvals**: pending, **Approval policies** tab, past requests; **Adjust priority** drag order | R | Tabs Pending · Approval policies · History, Adjust priority |
| Policy builder | Deel **Create a policy**: 1 Policy information (group, name, flow type Payroll submission / Payroll package approval) · 2 Approvers (Levels; By role / specific user; Substitute; same level parallel, levels sequential) · 3 Notification | D | Same 3-step wizard |
| Conditions | Rippling attribute + operator + value, AND/OR; Remote amount/country | R Rm | Condition rows |
| Review actions | Gusto **Submit payroll / Edit payroll / Decline request**; Deel **Approve Payroll / Report issues** | G D | Approve · Report issues · Decline |

## 5. Contractors / Billing (Deel pattern)
Finance › Billing › **Invoices** tab → checkboxes → **Pay selected** → **Pay your team** (Bill to entity, credits, Total due) → **Select payment method** (provider fee per method) → **Confirm payment** → "Payment confirmed" with **Track payment / Share receipt / Download CSV / PDF** (D). Gusto international shows **exchange rate, fee, estimated delivery** before submit; crypto wallet payouts in **USDC** (G). Fees: card $0.30+2.9%, ACH $5, SEPA $5 (D). **Ours:** exactly this flow; USDC funding at $0.

## 6. People
Deel **Directory** ("All People view", Edit worker details, bulk edit); Rippling profile **Personal information / Documents / Payroll (Paystubs, Withholding, Settings)**; Gusto **Work** tab + **Additional › Documents, Notes** (G R D). **Ours:** Directory + profile tabs Personal · Work & pay · Payroll · Documents.

## 7. Reports / Analytics
Gusto list: Payroll journal, Payroll summary, Cash requirements, General ledger, Agency payments, Contractor payments, Year-to-date, Time off, Workers, Payroll data export, Custom report… (G). Rippling **New Report → recipes → Start Building Report** (R). Deel Analytics overview with favorites; Report Builder by data model; access you / team / org (D). **Ours:** catalog + builder modal (data model → columns → filters → access).

## 8. Settings
Deel Org settings: Entities (Payroll tab: Payroll Policies, Payroll Automations), Security › Roles and permissions (**Create role**, template), Audit logs (D). Gusto roles Primary owner, Full access, Limited, Custom, People Manager (G). Rippling Scope × Access × Actions via Supergroups (R). **Ours:** Entities · Roles & permissions · Payment methods · Integrations · Security · Audit logs.

## Where the leaders are weak (sourced)
Rippling: salaried / hourly / contractors run separately (R). Gusto: approvals don't cover contractor payrolls (G). Deel: provider fees on card funding 2.9–3.9% (D); worker fees up to 2.5% (D). Rise: payee pays gas (C). Support quality is the top complaint for Gusto and Deel.

## Still unverified
Full Gusto left-menu order; Deel home widgets besides All tasks; current Rippling labels (PCMag may lag); EOR approval specifics; mobile screens.
