# Neobank verify-c fix status
1. DONE pool advancePayout reopen/idempotency (BankPayoutPoolService.ts, DDL dest_fp in 0041/verify_c.py)
2. DONE escrow remainder allocation + invariant (BankEscrowService.ts claim)
3. DONE pool collection key via nextAttemptKey
4. TODO card allowlist exact match
5. TODO EWA advance lock + unique transfer (unique index added in 0041)
