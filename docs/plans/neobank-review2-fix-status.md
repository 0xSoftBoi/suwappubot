# Neobank review-2 fix status

1. DONE - services/bank/systemDebit.ts (WeakSet-minted `SystemDebit` capability, `assertSpendable`); guard in BankTransferService.transfer (after source-active check) and BankFxService.prepare; escrow executeMoves, remittance claim/refund, payout-pool payout pass `systemDebit(...)`; routes/bank/schemas.ts:8 no longer allows escrow/pool. Card settlement debits a user checking/credit/treasury account (issueCard allow-lists kinds), so it needs no capability.
   Entry points checked (all refuse escrow/pool source): POST /bank/transfers (transfer), /fx quote+execute (FxService.prepare), earn deposit/withdraw (loadOwnedChecking now rejects escrow), credit collateral/borrow account (loadBorrowAccount rejects escrow), credit repay (transfer), cards link (kind allow-list), payroll funding x2, streams (payer account), org/approval transfers, partner transfers + partner fx, agent pay (mandate + account), payables payFrom, invoice pay, ramp offramp, remittance send/quote, treasury sweep account.
2. NOT STARTED
3. DONE - BankEscrowService.ts claim (only `intent` blocks; attempt = all entries), executeMoves uses nextAttemptKey, confirmRelease/refund allowed from `disputed` when no arbiter (payer release / payee refund), runJob retries parked arbiter-less milestones after 1h.
4. NOT STARTED
5. NOT STARTED (nextAttemptKey helper exists in paymentsCommon.ts)
6. NOT STARTED
7. NOT STARTED
8. NOT STARTED
9. DONE - BankRemittanceService.ts claim and refund keys via nextAttemptKey; 'reversed' treated as failed.
Migration 0035 / journal / database/bank_ddl/review2.py: NOT STARTED
