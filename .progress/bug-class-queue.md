# Bug-class queue

## PR #994 automated-review consolidation (2026-09-08)

| Bug class | Bounded instances | Status | Regression evidence |
| --- | --- | --- | --- |
| Cross-session foreign-key lock inversion | Managed-agent execution locks `users`/`wallets` while `execute_swap` inserts `swap_transactions` in a second session | Fixed with `FOR NO KEY UPDATE NOWAIT` and behavioral lock-option coverage | `test_execute_identity_guard_uses_fk_compatible_row_locks` |
| Async lock cache lifecycle/ownership confusion | Wallet lock eviction and `_wallet_lock_held` bypass | Fixed by counting owners/waiters and binding bypass to the current task | `test_engine_does_not_evict_a_wallet_lock_with_queued_waiters`; `test_engine_rejects_already_locked_bypass_from_another_task` |
| Synchronous database transaction inside an async route | Managed-agent wallet provisioning | Fixed by moving the complete transaction through `run_in_db` | `test_provision_database_work_does_not_block_the_event_loop` |
| External resource created before durable local publication | Turnkey account discovery and managed-wallet metadata lease publication | Fixed with eventual-consistency retries, recoverable partial identity, and latest-metadata/token CAS | `turnkeyAgentWalletRecovery.test.ts`; concurrent caller-metadata test in `agentWalletIdentity.test.ts` |
| Runtime/schema contract drift | Reserved managed-wallet metadata keys | Fixed in Zod description and generated OpenAPI `propertyNames.not.enum` | validator tests plus `bun run check:openapi` |
| Canonical identifier admits sentinel value | EVM zero address in managed metadata | Fixed by rejecting the zero address | zero-address test in `agentWalletIdentity.test.ts` |
| Privileged call contract under-specified by mocks | Polymarket Turnkey signing hash/encoding arguments | Fixed by capturing and asserting every signing argument | `predictManagedWalletIdentity.test.ts` |

Bounded candidate sweeps enumerated `with_for_update` occurrences, every
`already_locked` reference, every managed-wallet metadata CAS, and every
managed-wallet metadata validator/export. The confirmed cross-session await/FK
inversion was the managed-agent execution path changed by this PR.
