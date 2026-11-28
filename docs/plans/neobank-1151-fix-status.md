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
row 10 (server) -> FIXED (BankPayrollService.scheduleAvail + advanceScheduleWages result: added asset, symbol, chain, decimals of the schedule funding account)
row 16 (server) -> FIXED (BankOrgService.setCardBudget: merge-patch, omitted monthlyCapMinor/perTxCapMinor/categoryBudgets keep stored values, explicit null clears)
## Batch D checkpoint (bun run check clean after rows 2,3,9,10,16,17)
item 1 (org accounts presenter; decimals+symbol? decimals+balance via presentAccount; asset field doubles as symbol as for personal accounts) -> FIXED
item 2 (partial invoice) -> FIXED, option chosen: paymentRequest null + walletCheckout (scanner untouched)
item 3 (a)(b)(c) -> FIXED (Idempotency-Key header or body key on POST /payroll/schedules; EWA availability+advance carry asset/symbol/chain/decimals; org accounts carry decimals)
item 4 -> FIXED (recipient binding + log redaction); body-token claim route NOT DONE
item 5 -> FIXED (same as 10)
item 6 -> FIXED
item 7 (ramps quote/offramp) -> NOT STARTED
item 8 (cloudflare worker comment), 9 (escrow decimals) -> NOT STARTED
- [C2] row 18 → FIXED (components/bank/EscrowDetail.tsx: resolve parse returns null when decs null; actions blocked until decimals known)
- [C2] row 48 → FIXED (EscrowDetail.tsx: payer Release when !hasArbiter and funded/disputed; payee Refund also on disputed)
- [C2] row 35 → FIXED (components/bank/Amount.tsx: aria-label only via optional ariaLabel prop, so Field label names the input)
- [C2] row 32 → FIXED (routes/bank/BankSettings.tsx: constant 6 decimals, labelled USD equivalent)
- [C2] row 36 → FIXED (routes/bank/BankHome.tsx KIND + OpsAlert.cancelOwed removed in lib/bankApi.ts)
- [C2] row 22 → FIXED (new hooks/bank/useBankQuery.ts gates on hasBankCredential; useBankCore/useBankDomains/useTransferPoll use it)
- [C2] row 33 → FIXED (hooks/bank/useTransferPoll.ts stops polling on error)
- [C2] row 39 → FIXED (components/bank/CheapestChainHint.tsx 350ms debounce + keepPreviousData)
- [C2] row 23 → FIXED (routes/bank/Privacy.tsx cancel on unmount)
- [C2] row 38 → FIXED (routes/bank/Agents.tsx invalidates ['bank','directory'])
- [C2] row 34 + row 19 → FIXED (hooks/bank/useIdempotencyKey.ts: optional fingerprint persists key in sessionStorage via intentKey, reset on success, settle(err) clears on definitive 4xx; MoneyAction.tsx + IssueCard.tsx use it). Hook now also returns stable object + settle().

## Batch A (Send / claim / PayInvoice / Payments)
- row 3 -> FIXED (terminal/src/routes/bank/PayInvoice.tsx `walletOk`): wallet QR hidden once paidMinor > 0 unless `paymentRequest.remainingMinor === due`; explanation card shown. NOTE for batch D: to re-enable, set `paymentRequest.remainingMinor` (remaining balance string) on the public/authed invoice view when the request is built for the remaining balance (field added optionally to `PaymentRequest` in terminal/src/lib/bankApi.ts).
- row 6 -> FIXED (Send.tsx, fallback `${origin}/bank/claim/<claimToken>`; `claimLink` preferred when present).
- row 7 -> FIXED (Send.tsx Claim): Cash out tab shows a saved-external-account picker and sends `externalAccountId`; tab hidden with an explanation when the user has none.
- row 14 -> FIXED (Payments.tsx): Pay row and request use outstanding = amount - paid; blocked when nothing due.
- row 40 -> FIXED (PayInvoice.tsx): `q.refetch()` after the pay sheet closes.
- row 41 -> FIXED (Payments.tsx CreateInvoice): key from `intentKey(fingerprint)`.
- Claim decimals (same-class, Send.tsx:140) -> FIXED: from `useBankAssets()` by preview asset+chain.
- Claim "Open in Telegram" token carry -> FIXED (components/bank/BankShell.tsx NeedsTelegram -> `?start=claim_<token>`). NOTE batch C (owns BankShell): minimal additive edit made there (useLocation import + href); keep it when editing row 1.
- Idempotency across sheet close/reopen -> FIXED for my screens via new terminal/src/hooks/bank/intentKey.ts (sessionStorage, fingerprint + 30 min TTL, cleared on success) used by Send, PayInvoice, Payments invoice create/pay. NOTE batch C (row 19): MoneyAction/useIdempotencyKey is unchanged; other MoneyAction callers can use `intentKey` too.
- Claim has no idempotency key (server CAS single-use), nothing to persist.
## Batch D final
item 7 -> FIXED (POST /ramps/quote optional externalAccountId: quotes only the executing provider/rail, response adds provider, quoteId, expiresAt, receiveAmountMinor; POST /ramps/offramp optional minReceiveMinor -> CONFLICT if fresh quote pays less, checked before any provider transfer/fund move; BankRampService.ts, routes/bank/ramps.ts)
item 8 -> FIXED (cloudflare/suwappu-router.worker.js comment no longer claims a #1150 review)
item 9 -> FIXED (EscrowView adds symbol + decimals); stream EWA advance availability not touched
row 29, 56 (docs) -> NOT FIXED (no doc edits made in this pass)
checks: bun run check 0, check:openapi 0, check:mcp 0, check_env_schema 0, black database/ clean; DDL proof: python ensure_bank_tables on bank_proof_a OK, drizzle-kit migrate on bank_proof_b OK, idem_key/idem_hash present in both
