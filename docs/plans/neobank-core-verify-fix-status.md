# Neobank core verify fixes - status

1. MEDIUM syncDeposit skip -> FIXED. BankTransferService.ts syncDeposit: no group-wide skip; credit = onchain - group ledger - outgoing (submit leg posted) - incoming in-flight - pending earn withdraw - pending credit draw, floored at 0; idempotency key unchanged. New services/bank/opsAlerts.ts (job 'ops-alerts' flags metadata.needsOpsReview, logs; no DDL), GET /bank/ops/alerts in routes/bank/core.ts. Caveat: a stuck incoming dust transfer under-credits by its amount until it resolves; it cannot block deposits.
2. LOW submit-leg ack loss -> FIXED. BankTransferService.ts reserve failure now failAndReverse(t, msg, true).
3. LOW systemDebit unbound -> FIXED. systemDebit(reason, accountId); assertSpendable requires cap.accountId === acct.id; 4 mint sites updated (escrow, remittance x2, payout pool).
4. LOW advisory unlock -> FIXED. db.ts withDbLock release: unlock error logged, session terminated via pg_terminate_backend before release, never rethrown.
Verify: scratch SQL scenarios (pure arithmetic, local PG) + bun run check clean.
