# Neobank idempotency status

Scope: money-moving POST/PUT/PATCH/DELETE in `api-ts/src/routes/bank/*.ts`. Rule: add an OPTIONAL `idempotencyKey` (body or `Idempotency-Key` header); absent = legacy behaviour plus `"idempotent": false`.

## Done

| Route | Moves money how | Idempotency before | After |
|---|---|---|---|
| `POST /agents/pay` | x402 pay: mandate daily-cap reservation, ledger debit to clearing, signed EIP-3009 authorization | none (MCP deduped in-process only) | KEY ADDED. `bank_agent_spend.idem_key/idem_hash/idem_result` + partial unique `(agent_id, idem_key)` (migration 0043, `database/bank_ddl/idempotency.py`). Key is re-checked under the per-mandate advisory lock inside `reserveSpend`, so a retry cannot reserve cap twice or sign a second authorization (`BankAgentPayService.ts` `reserveSpend`, `replayPay`). Same key + same terms returns the stored original result with `replayed:true`; different terms 409 CONFLICT; in-flight or ambiguous original 409 CONFLICT (not retried). A definitively failed attempt frees the key. No key: works as before, response `result.idempotent:false`. |

MCP: `bank_agent_pay` no longer sets `localDedupe` (`mcpTools.ts`); `handleBankTool` already forwarded `idempotency_key` as header and body, which the route now honours.

## Already keyed (required key today, verified by grep of route schemas; services derive stored-key lookups) - no change

`POST /transfers`, `/orgs/:orgId/transfers`, `/orgs/:orgId/treasury/sweep`, `/credit/*` (lines, draw, repay, withdraw-collateral, unsecured, receivables), `/earn/deposit|withdraw`, `/payments/invoices`, `/payments/invoices/pay`, `/escrows`, `/streams`, `/streams/:id/usage`, `/payroll/ewa/*/advance`, `/remittance/send`, `/agents/streams`, `/agents/streams/usage`, `/cards` (create).

## NOT YET REVIEWED (follow-up; no change made)

`POST /payroll/runs` (+approve/execute/retry; expected SAFE-BY-CONSTRUCTION via `payroll:{run}:{item}`, needs file:line confirmation), `/payroll/pools` + `/limits`, `/cards/settlements/retry`, `/remittance/claim/:token`, `/remittance/:id/cancel`, `/platform/transfers|fx|stablecoin/*`, `/ramps/offramp`, `/fx/execute`, escrow milestone actions, `/credit` etc. already keyed above.

## Addendum findings P1-P5 (seller-side paywall / ramp) - NOT STARTED

P1 re-serve secret, P2 validBefore cap vs reconcile delete, P3 finalise UPDATE state guard, P4 safe-block window, P5 `BankRampService` webhook status guard. Not implemented in this pass.

## Verification

`bun run check` passes; `check:openapi` in sync; `check:mcp` informational (28 hand-written schemas, unchanged baseline). Migration 0043 applied to `bank_proof_a` and `bank_proof_b` via `drizzle-kit migrate` (3 idem_* columns present on both).
