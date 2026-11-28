# PR #1151 batch D fix status (api-ts / docs / edge)
row 2 -> FIXED (api-ts/src/routes/bank/business.ts GET+POST /orgs/:orgId/accounts now map presentAccount: decimals/balance)
row 3 (server) -> FIXED (BankPaymentsService.getPublicInvoice: paymentRequest=null + walletCheckout='unavailable_after_partial' when paidMinor>0; 'available' otherwise; scanner NOT changed)
- [C2] row 1 → FIXED (terminal/src/components/bank/BankShell.tsx root: h-[100dvh] overflow-y-auto, safe-area insets; BankUI.tsx Sheet max-h-85dvh + safe-area + overscroll-contain)
- [C2] row 50 → FIXED (lib/bankApi.ts parseToMinor normalises ".5" / "5.")
- [C2] row 43 → FIXED (BankUI.tsx Sheet focuses dialog on open, restores opener on close)
- [C2] row 54 → FIXED (lib/bankApi.ts header comment)
- [C2] row 57 → FIXED (lib/bankAuth.ts isLocalHost, used by bankApi.ts)
- [C2] central amount refusal → FIXED (lib/bankApi.ts isKnownDecimals; parseToMinor/formatMinor return null/'—' unless decimals is a known integer 0..36). Call-site sweep pending.
row 17 (server) -> FIXED (POST /payroll/schedules accepts idempotencyKey body or Idempotency-Key header; BankPayrollService.createSchedule hash+replay/CONFLICT; drizzle/0046_bank_schedule_idempotency.sql + database/bank_ddl/schedule_idempotency.py + schema idem_key/idem_hash unique index)
- [B] row 2 -> FIXED (BusinessExtra.tsx OrgTransfer: aDec integer-only, AmountInput/review use it, warning shown when absent). NOTE for D: org accounts still need `decimals` via presentAccount (business.ts) or the transfer stays blocked.
- [B] row 5 -> FIXED (Payroll.tsx RunDetail: PayrollPreview shape, totalMinor, per-payee rows, retry totals failed only, decimals from assets by run.asset/chain, actions disabled if unknown).
- [B] row 8 -> FIXED (BusinessExtra.tsx BillsPanel: Cancel for unpaid/failed/scheduled/pending_approval; Schedule only unpaid/failed).
- [B] row 10 -> FIXED (PayrollExtra.tsx MyPayouts: selector removed; uses avail.data.asset/chain/decimals; blocked with message when absent). NOTE for D: scheduleAdvanceAvailable must return asset, chain, decimals (bankApi.ts type already has them optional).
- [B] row 11 -> FIXED (Developers.tsx: Save config and Add customer removed; explanatory card, read sections kept).
- [B] row 16 -> FIXED (BusinessExtra.tsx CardBudgets: untouched caps keep saved value, cleared box clears, categoryBudgets resent; server PUT replaces whole row).
- [B] row 17 -> FIXED client (PayrollExtra.tsx passes MoneyAction key; bankApi.ts createSchedule(b, key) sends it as Idempotency-Key header). NOTE for D: server must read the Idempotency-Key header on POST /payroll/schedules and dedupe.
- [B] row 37 -> FIXED (BusinessExtra.tsx OrgTransfer clears toAcct when From changes).
- [B] row 55 -> FIXED (BusinessExtra.tsx PoliciesEditor limited to owner/admin/approver).
- [B] same-class: Payroll run-detail decimals now by run asset/chain -> FIXED. BillsPanel org-accounts dash -> depends on D (row 2). PayrollExtra.tsx:100 symbol-only lookup -> removed with selector.
- [B] bankApi.ts edits: createSchedule key param, scheduleAdvanceAvailable optional asset/chain/decimals, setCardBudget categoryBudgets.
row 9 (server) -> FIXED (BankRemittanceService.send: recipient kind 'claim' now accepts optional telegramId/username, stored in metadata.claimFor; claim() refuses other claimers with FORBIDDEN before the single-use CAS; open links keep bearer semantics, TTL unchanged. app.ts: claim tokens in the request path redacted from hono logger, slow-request log and Sentry paths). NOT DONE: body-token claim route (client keeps path token; terminal nginx handles its own log masking).

## C1 (Cards / RevealCard / Earn / Credit / CreditExtra)
- row 4 → FIXED (terminal/src/routes/bank/Cards.tsx Rules + Cards() mount): Rules mounts only with server capDecimals, keyed on them, no account-decimals fallback; caps/activeWindows are rewritten only when edited, else round-tripped as stored.
- row 12 → FIXED (Cards.tsx shortfall; bankApi.ts Card.shortfall): lock + outstanding amount from server `card.shortfall`.
- row 24 → FIXED (components/bank/RevealCard.tsx loadStripeJs): dead script removed on error.
- reveal providerCardId → FIXED (RevealCard.tsx): elements use reveal-key's providerCardId, abort on mismatch with detail's.
- row 13 → NOT FIXED here (terminal/nginx.conf is C2).
- row 15 → FIXED (components/bank/CreditExtra.tsx eligible = payeeAccountId).
- row 44 → FIXED (CreditExtra.tsx status list open/overdue/partially_paid).
- row 53 → FIXED (CreditExtra.tsx duplicate ErrorBox removed).
- row 45 → FIXED (Credit.tsx OpenLine account filter chain + loanAsset).
- row 28 → FIXED (Earn.tsx effect resets sweepVault on accountId).
- same-class Cards `?? 0` → FIXED (Cards.tsx).
- same-class Credit `?? 6` loan decimals guess → FIXED (Credit.tsx useLoanDecimals, null blocks Review).
- Earn APY / credit LTV/health units → VERIFIED correct vs server (apy/netApy/borrowApy/utilizationPct percent; ltvBps/lltvBps bps/100; healthFactorBps /10000; aprBps/100); no change.
- Credit refusal `reason` → FIXED (bankApi.ts BankApiError.reason, describeBankError(code,msg,reason), CREDIT_REASON_TEXT).
- row 34 (IssueCard) → not in C1 ownership; left to C2.
