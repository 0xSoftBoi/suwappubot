# Bug-class queue

## PR #994 automated-review consolidation (2026-09-08)

| Bug class | Bounded instances | Status | Regression evidence |
| --- | --- | --- | --- |
| Cross-session foreign-key lock inversion / long-lived transaction | Managed-agent execution identity validation followed by `execute_swap` in a second session | Fixed with `FOR NO KEY UPDATE NOWAIT`, off-loop validation, and transaction release before provider I/O | `test_execute_identity_guard_uses_fk_compatible_row_locks`; `test_concurrent_execute_orders_async_wallet_lock_before_db_guard` |
| Async lock cache lifecycle/ownership/scope confusion | Wallet lock eviction, `_wallet_lock_held` bypass, and separate `SwapEngine()` instances | Fixed by counting owners/waiters, binding bypass to the current task, and sharing lock registries across every engine instance in the process | waiter/bypass tests plus `test_swap_engine_instances_share_process_execution_lock_state` |
| Synchronous database transaction inside an async route | Managed-agent wallet provisioning and execution identity validation | Fixed by moving both bounded transactions through `run_in_db` | `test_provision_database_work_does_not_block_the_event_loop`; execution concurrency test asserts validation runs off-loop |
| External resource created before durable local publication | Turnkey account discovery, cross-stack null→attested-ID enrichment, managed-wallet publication, and Python registration | Fixed with eventual-consistency retries, recoverable partial identity, one-way Python enrichment, latest-metadata/token CAS, provider-address validation, and a lease held through Python finalization | `turnkeyAgentWalletRecovery.test.ts`; enrichment tests in `test_internal_agent_wallet.py`; publication/lease/provider-output tests in `agentWalletIdentity.test.ts` |
| Bounded polling reports a generic server failure | Concurrent wallet request while a valid provisioning lease remains active | Fixed with a bounded local wait followed by an explicit HTTP 409 retry response | active-lease conflict test in `agentWalletIdentity.test.ts` |
| Runtime/schema contract drift | Reserved managed-wallet metadata keys | Fixed in Zod description and generated OpenAPI `propertyNames.not.enum` | validator tests plus `bun run check:openapi` |
| Canonical identifier admits sentinel value | EVM zero address in TypeScript metadata/provider output and Python provisioning/execution | Fixed by rejecting the zero address at every boundary | zero-address tests in `agentWalletIdentity.test.ts` and `test_internal_agent_wallet.py` |
| Privileged call contract under-specified by mocks | Polymarket Turnkey chain type and signing hash/encoding arguments | Fixed by capturing and asserting every attestation/signing argument | `predictManagedWalletIdentity.test.ts` |
| Test mutates process-global async primitives | Managed execution lock ownership and concurrency regressions | Fixed with isolated `SwapEngine` state and module-singleton patching per test | lock tests in `test_internal_agent_wallet.py` |

Bounded candidate sweeps enumerated `with_for_update` occurrences, every
`already_locked` reference, every `SwapEngine()` production construction,
every managed-wallet metadata CAS, and every managed-wallet metadata
validator/export. The confirmed cross-session await/FK inversion was the
managed-agent execution path changed by this PR.
