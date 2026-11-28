# Neobank SDK + MCP status

## Part 1 - TypeScript SDK (DONE, `cd packages/sdk && bun run build` clean)
`client.bank.*` in packages/sdk/src/bank.ts; types in packages/sdk/src/types.ts "Bank" section (add-only); `SuwappuBankError` (typed `code`, `retryable`, `missing`) in client.ts; `SuwappuError.retryAfter` added.
Retry: 429 and 503 LOCK_BUSY, same idempotency key, Retry-After honoured, bounded (`client.bank.retry`). Only reads and keyed calls retry.
Methods: accounts 5, transfers 3, assets 1, fx 2, earn 7, credit 13, ramps 12, remittance 9, cards 11, payments.invoices 8 / escrows 8 / streams 8, payroll 19, business (orgs 12, members 5, approvals 9, treasury 7, bills 9, books 7), agents 10, platform 12, chains 1, privacy 4, segments 4, ops 1.
Not covered: sync-deposit, ramps qr, cards reveal-key/receipts/settlements, payroll EWA, platform stablecoin/network/events, privacy scan/compliance-export, books csv export, public endpoints. Response payloads other than account/transfer/statement/reconcile are typed `BankRecord` (service return types not mirrored).
Routes without an idempotency key in their zod schema (agents/pay, claim, payroll runs, etc.) take none and are not auto-retried.

## Part 3 - MCP (DONE; `bun run check`, `check:openapi`, `check:mcp` pass; tools/list on a local boot against bank_proof_a shows 20 bank_* tools)
Definitions: BANK_TOOL_SPECS in api-ts/src/routes/mcpTools.ts (snake_case args). Dispatch: handleBankTool in api-ts/src/routes/mcp.ts calls the SAME Hono app as /v1/agent/bank (`bankAgentRoutes.request`) with the caller's credentials, so owner, zod, idempotency, policy/mandate/limit checks and error codes are the route's. Errors return the typed `error_code`, `retryable`, `retry_after_seconds`.
Money-moving tools (transfer, fx_execute, earn_deposit/withdraw, credit_draw/repay, pay_invoice, remit_send, agent_pay): idempotency_key required, destructiveHint=true. bank_agent_pay: route has no idempotency key, so mcp.ts dedupes (agent,key,args) in-process (process-local; follow-up: add key to BankAgentPayService).
## Part 2 - Python: NOT STARTED
