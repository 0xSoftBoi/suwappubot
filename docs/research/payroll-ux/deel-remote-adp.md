# Deel / Remote / ADP — enterprise payroll UX research (Nov 2026)

Confidence: Remote = high (own help center). Deel = medium/low (help center not surfaced; blogs, dev docs, third parties). ADP = thin. Items marked UNVERIFIED must not be treated as confirmed.

## Parity requirements (summary)
1. **Payroll calendar with named milestones** (Remote): Input Cut-off → Payroll input review → processing → Payroll Output delivery → Approval date → payment files → Finalized → customer pays → Pay Day; bank-holiday adjustment; year calendar must be approved to be "Active".
2. **Run review screen**: "At a glance" (Approved Changes: joiners/leavers/salary/time off; Pay Breakdown; Documents), Gross Pay Variance per employee with per-pay-item breakdown, gross-to-net download, pending expenses/time-off counts before cutoff.
3. **Approval actions**: Approve / Request Changes (+comment); statuses Awaiting approval → Finalized; run-level rules by Amount and/or Country; sequential approvers.
4. **Role-based approvers** with information access level (Direct Reports, Legal Entity, Employment Country, Entire Company…) and "Override review requests"; warn on stuck/inactive approvers.
5. **Contractor/off-cycle**: Deel two-step approve (single / "Approve all") → pay; one-off invoices due ≤30 days; monthly bulk funding invoice.
6. **Worker withdrawal menu** with per-method speed + fee shown up front; crypto first-class.
7. **Reports**: Payroll Cost, Variance, General Ledger, Gross-to-Net, Payroll Run; ADP adds pay preview + AI anomaly detection on variances + AI "what changed" summaries.
8. **Enterprise**: SAML SSO, SCIM, signed webhooks, API, custom role permissions.
9. **Gaps to beat**: slow support on complex tickets, high withdrawal fees, weak analytics/exports.

## 1. Navigation
- Remote: Payroll (per-country runs), Workflows → Approvals, Company Settings → User roles & permissions, "Things To Do", Team Expenses Dashboard, Time Off dashboard. [1](https://support.remote.com/hc/en-us/articles/39314386787597) [2](https://support.remote.com/hc/en-us/articles/24705291282317-Time-off-dashboard-for-Customers)
- ADP WFN: Overview, Payroll, Employees, Deductions, Reports, Dashboard, Self-service. [3](https://www.adp.com/what-we-offer/products/adp-workforce-now/payroll.aspx)
- Deel: UNVERIFIED.

## 2. Home
- Remote: "Things To Do"; email + dashboard notice when Payroll Output ready. [4](https://support.remote.com/hc/en-us/articles/28278288344461)
- ADP: payroll dashboard, pay preview (earnings/taxes/deductions/net), ADP Assist AI. [3]

## 3. Payroll cycle
- Remote calendar steps & labels "Payroll Input", "Payroll Output", "Request Changes", "Approve", "Finalized", Documents tab. [4]
- Late approval pushes extra pay to next run; off-cycle requests by the 27th. [5](https://support.remote.com/hc/en-us/articles/4411723871885)
- Review: At a glance, Gross Pay Variance, gross-to-net download, statutory payments status; events read-only in run (fix at source or comment to Payroll Ops); EOR customers view-only, Payroll customers approve; view-only users ask an editor to fund statutory payments. [6](https://support.remote.com/hc/en-us/articles/15412163453837)
- Deel Global Payroll: submit inputs → review final package → approve, auto-submit/auto-approve options. [7](https://www.deel.com/solutions/payroll-engine/) [8](https://www.deel.com/blog/deel-global-payroll-onboarding-process/)
- Deel contractor off-cycle: approve (single / "Approve all" / View Invoice) → pay via contractor page, payroll page or mass pay; due ≤30 days. [9](https://developer.deel.com/docs/ic-off-cycle-payments)
- Deel funding: one bulk monthly invoice. [10](https://www.deel.com/en-gb/for-finance-managers/)
- ADP: Payroll Register / Preview Payroll → Approve/Submit (third-party, UNVERIFIED) [11](https://www.acciyo.com/how-to-process-payroll-in-adp/); official: continuous calc, AI anomaly detection, AI change summaries. [3]

## 4. Multi-entity / country / currency
- Remote access levels: Legal Entity, Billing Legal Entities, Employment Country; statutory card filtered by entity. [1] [6]
- Deel: unified multi-country reports, 130+ countries (marketing). [12](https://deel.com/blog/global-payroll-reporting-for-enterprise)
- ADP: US+Canada, links to ADP Global Payroll. [3]
- FX display/funding methods: UNVERIFIED.

## 5. Approvals / roles / audit
- Remote: Workflows → Approvals → Add new approval → Payroll approval; conditions Amount (e.g. >150,000 USD) and/or Country; approvers users or roles (Payroll Manager, Finance Owner), sequential, in-app+email; Approve/Request changes; auto approve/reject; edit/deactivate/delete; stalls on inactive/OOO/no-access approvers or overlapping workflows; Payroll plan only. [13](https://support.remote.com/hc/en-us/articles/40153435636621)
- Remote roles: HR Manager, Finance Approver, Expense Approver, Department Heads; multi-role users switch via profile menu; any role member completes step. [1]
- Deel (third-party, UNVERIFIED): Organization Admin, IT Developer Admin, Integrations Admin; custom roles at Organization Settings → Access Management → Roles & Permissions; multi-level approval policies. [14](https://nhimg.org/deel-security-guide) API: create organization role. [15](https://developer.deel.com/api/reference/endpoints/organizations/create-organization-role)
- Audit logs: UNVERIFIED.

## 6. Worker side — Deel withdrawal methods [16](https://www.deel.com/blog/contractor-payment-withdrawal-options-on-deel/)
| Method | Speed | Fee |
|---|---|---|
| Deel Card | Instant | — |
| Instant Card Transfer | Instant–hours | 2% non-US (min $5/max $15)+FX; 0.75% US (min $5/max $25) |
| Stablecoin wallet | Instant | Free to Deel balance |
| Wise | ≤1 business day | No Deel fee |
| Coinbase | Minutes–1 day | 1.5% |
| PayPal | ≤1 day | 2.5% (min $0.25) |
| Payoneer | ≤1 day | 1% |
| Revolut | ≤1 day | None |
| Local bank | 1–5 days | None |
| SWIFT | 5–7 days | Intermediary fees |
BVNK (USDC/USDT) listed. Crypto payroll via Coinbase since 2022. [17](https://techcrunch.com/2022/02/17/remote-hiring-startup-deel-gives-businesses-the-option-to-run-their-payroll-in-crypto)
ADP self-service with plain-language pay explanations. [3]

## 7. Reports
- Remote: Payroll Cost, Variance, General Ledger, Gross-to-Net, Payroll Run. [18](https://remote.com/blog/whats-new-remote-product-updates-may-july-2026)
- Deel generic catalog (blog, UNVERIFIED as UI): payroll summary/detail, tax liability, employee summary, retirement, PTO, workers' comp, register, certified payroll; "Awaiting Report Submission" + "Review and Submit". [12]

## 8. Compliance UI
- Mostly UNVERIFIED. ADP flags missing tax IDs, guides jurisdiction registration. [3]

## 9. Enterprise
- Deel: Okta lists SAML/OIDC/SCIM [19](https://www.okta.com/integrations/deel/); Deel dev docs say SCIM not native, needs API [20](https://developer.deel.com/api/common-use-cases/sync-deel-users-to-identity-providers) (conflict).
- Remote: SAML SSO config API, signed webhooks `X-Remote-Signature` [21](https://developer.remote.com/docs/sso-configuration) [22](https://hookdeck.com/webhooks/platforms/guide-to-remote-webhooks-features-and-best-practices.md); SCIM Okta guide [23](https://support.remote.com/hc/en-us/articles/47725731101197-Remote-SCIM-Configuration-Guide-for-Okta).

## 10. Reviewer sentiment (Deel)
Top complaint support on complex issues; high withdrawal fees; limited regional options; want better analytics/exports; dashboard mostly called intuitive. [24](https://capterra.com/p/205015/Deel/reviews/) [25](https://g2.com/products/deel/reviews/deel-review-9200216)
