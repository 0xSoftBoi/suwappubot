# Neobank review-2 fix status

1. DONE - services/bank/systemDebit.ts (WeakSet-minted `SystemDebit`, `assertSpendable`); guard in BankTransferService.transfer and BankFxService.prepare; escrow executeMoves, remittance claim/refund, payout-pool payout pass `systemDebit(...)`; routes/bank/schemas.ts:8 no longer allows escrow/pool. Card settlement debits user checking/credit/treasury accounts only (issueCard allow-list), no capability needed.
   Entry points checked (all refuse escrow/pool source): POST /bank/transfers, /fx quote+execute, earn deposit/withdraw (loadOwnedChecking), credit collateral/borrow (loadBorrowAccount) + repay (transfer), cards link (allow-list), payroll funding x2, streams, org/approval transfers, partner transfers + fx, agent pay (mandate + account), payables payFrom, invoice pay, ramp offramp, remittance send/quote, treasury sweep account.
2. DONE - BankPaymentsService.ts creditOnchain: unique `receipt_key` (payeeAccount:chain:txref[:logIndex]) on bank_invoice_payments; one tx settles one invoice; partial payments credit the received amount once (partially_paid).
3. DONE - BankEscrowService.ts claim/executeMoves/runJob (failed movements non-blocking, attempt = all entries, nextAttemptKey, no-arbiter payer release / payee refund from disputed, 1h auto-retry).
4. DONE - BankCardService.ts: hold TTL 35d floor, remainder-only hold sums, provider closed/reversed/expired release, bank_card_shortfalls + card freeze + 'card_shortfall' hold provider blocks debits, authorizations declined and unfreeze refused while open; retry consumes the shortfall hold and marks it repaid.
5. DONE - BankPayrollService.ts currentKeyState: before rotating, checks bank transfer(s) and ramp transfer under current key; hold / mark paid / rotate.
6. DONE - BankPaymentsService.ts createInvoice: tagged total unique among live invoices of the account.
7. DONE - createInvoice refuses EVM invoice without head (UPSTREAM 'RETRYABLE'); scan cursor monotonic (greatest) and null-cursor legacy invoices skipped with a warning.
8. DONE - bank_card_holds.captured_minor; partial capture keeps remainder held; multi-capture accumulates; incremental auth grows hold (Stripe event amount).
9. DONE - BankRemittanceService.ts claim/refund keys via nextAttemptKey.
Migration: api-ts/drizzle/0035_bank_review2.sql, journal entry appended last (idx 37, file number 0035 sits after 0036/0037 to avoid clobbering), database/bank_ddl/review2.py. Applied twice (idempotent) to suwappu_python_first: no errors.
