# Neobank verify-c fix status (on-disk state)
1. DONE BankPayoutPoolService.advancePayout (~:168-215): terms check incl. destFp/payer acct/amount/pool; void+no-payout row re-runs exposure check and reopens atomically in the locked tx; void+paid-transfer repaired to open; failed prior transfer rotates key via nextAttemptKey; payoutTransferId update also sets status 'open'. DDL: dest_fp column (drizzle/0041_bank_verify_c.sql, database/bank_ddl/verify_c.py, schema bankPaymentsPayroll.ts). No DB CHECK (failed-transfer void rows legitimately keep their transfer id); guard in code.
2. DONE BankEscrowService.claim (~:120-135, invariant ~:150): remainder = amount - released - refunded under lock; resolveDispute uses remainder:true; single-leg claims scale to remainder; per-milestone + per-escrow invariant check.
3. DONE BankPayoutPoolService.runJob: settleKey = nextAttemptKey(payer, poolsettle:{id}).
4. DONE cards/rules.ts: allowlist exact (or id: entries vs merchantId); blocklist substring.
5. DONE BankStreamService.advanceWages: stream row FOR UPDATE, fresh view, minus unpaid advance reservations, inside tx; unique index on bank_wage_advances.transfer_id.
