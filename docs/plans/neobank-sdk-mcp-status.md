# Neobank SDK + MCP status

## Part 1 - TypeScript SDK (DONE, `cd packages/sdk && bun run build` clean)
`client.bank.*` in packages/sdk/src/bank.ts; types in packages/sdk/src/types.ts "Bank" section (add-only); `SuwappuBankError` (typed `code`, `retryable`, `missing`) in client.ts; `SuwappuError.retryAfter` added.
Retry: 429 and 503 LOCK_BUSY, same idempotency key, Retry-After honoured, bounded (`client.bank.retry`). Only reads and keyed calls retry.
Methods: accounts 5, transfers 3, assets 1, fx 2, earn 7, credit 13, ramps 12, remittance 9, cards 11, payments.invoices 8 / escrows 8 / streams 8, payroll 19, business (orgs 12, members 5, approvals 9, treasury 7, bills 9, books 7), agents 10, platform 12, chains 1, privacy 4, segments 4, ops 1.
Not covered: sync-deposit, ramps qr, cards reveal-key/receipts/settlements, payroll EWA, platform stablecoin/network/events, privacy scan/compliance-export, books csv export, public endpoints. Response payloads other than account/transfer/statement/reconcile are typed `BankRecord` (service return types not mirrored).
Routes without an idempotency key in their zod schema (agents/pay, claim, payroll runs, etc.) take none and are not auto-retried.

## Part 3 - MCP: NOT STARTED
## Part 2 - Python: NOT STARTED
