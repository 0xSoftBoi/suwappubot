# Neobank review1b (core / earn / credit) fix status (bun run check: clean at last run)

1. DONE - holds.ts (assertHoldCovers; 'pending-transfer' provider counts pending transfers with no 'submit' reserve; assertAvailable validates consumesHold), BankTransferService.ts insertTransferGuarded (dup check -> assertAvailable under source row lock -> insert). No route forwards consumesHold.
2. DONE - BankCreditService.ts reserveDraw: line FOR UPDATE, used = principal + accrued + pending draws (bank_credit_ops rows) + this draw, reserve row inserted in same tx; poolDraw.
3. DONE - openUnsecuredLine: active-line check, delinquency refusal, exposure cap; partial unique index ux_bank_credit_lines_unsecured_active (0037).
4. PARTIAL - payer acceptance (bank_invoice_acceptances, POST /credit/receivables/accept), distinct payer required, score-based total-advance limit under advisory lock, partial unique index on receivable_id, BankPaymentsService.voidInvoice blocks financed invoices. Remaining: no invoice-edit endpoint audited; accept->finance status race not re-checked inside insert tx.
5. DONE - bank_credit_ops (unique line_id+op_key); applyPoolDelta applies once under line row lock in one tx; legacy metadata.applied still honoured.
6. PARTIAL - repayForRefund no longer credits pool from `external`; books a pending cardref op, applied only when a confirmed transfer into the pool account carries metadata.cardRefundTxn. Remaining: nothing yet produces that confirming transfer.
7. DONE - chain.ts: no retry on raw send, all broadcast errors ambiguous, "already known" = accepted.
8. DONE - BankTransferService failAndReverse(noBroadcast)/finalizeTransfer requireNoHash under row lock; BankFxService claim token.
9. DONE (done early, now owned by second builder) - db.ts withDbLock try-lock + jittered backoff, 20s, LOCK_BUSY (503), in-memory per-key queue, 6-connection cap; advance() treats LOCK_BUSY like CONFLICT.
10. DONE (both halves) - earnCreditChain.postExternalLeg and BankCreditService.settleExternalOp: op row/status + ledger post in one tx.
11. NOT STARTED (second builder)
12. NOT STARTED (second builder)
13. NOT STARTED (second builder)
14. NOT STARTED
15. DONE - reserveRepay caps at owed - pending repays under lock, op row reserved before transfer; settleReceivable always derives a deterministic ref (never the amount); excess is never moved (capped).
16. NOT STARTED

Debit coverage: transfer / same-wallet / FX reserve -> insertTransferGuarded (assertAvailable); escrow funding -> BankEscrowService:321; agent-pay -> BankAgentPayService:175 (consumes own hold); earnCreditChain:324 -> :340. Exempt/uncovered: credit settleExternalOp 'out' (on-chain repay; only assertSpendable before broadcast), card settlement (debits external only), clearing/fx system legs (internal).
