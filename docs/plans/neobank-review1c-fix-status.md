A: DONE - db.ts withDbLock (by credit fixer): try-lock + jitter, 6-conn cap, LOCK_BUSY 503; Retry-After:2 added in routes/bank.ts; live 40-call proof passed
B: DONE - earnCreditChain.ts postExternalLeg: insert+postInTx in one tx (credit fixer); repair-on-existing (re-post 'settle', idempotent) added
C: DONE - BankEarnService.ts: confirmDepositOnce (conditional pending + shares in one tx), finalizeWithdraw guarded tx, undoDeposit requires confirmed reservation, patchOpHashIfPending aborts pre-broadcast
D: DONE - BankEarnService.ts auto-sweep uses availableBalance (row-locked) - floor
E: DONE - BankTransferService.ts syncDeposit: pending bank_earn_ops + bank_credit_ops (via lines) for wallet group block credit; partner guard kept
DDL: none needed, so no 0038 / journal / review1c.py
