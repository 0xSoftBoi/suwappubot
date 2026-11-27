# Neobank idempotency status

Scope: money-moving POST/PUT/PATCH/DELETE in `api-ts/src/routes/bank/*.ts`. Rule: add an OPTIONAL `idempotencyKey` (body or `Idempotency-Key` header); absent = legacy behaviour plus `"idempotent": false`.

## Done

| Route | Moves money how | Idempotency before | After |
|---|---|---|---|
| `POST /agents/pay` | x402 pay: mandate daily-cap reservation, ledger debit to clearing, signed EIP-3009 authorization | none (MCP deduped in-process only) | KEY ADDED. `bank_agent_spend.idem_key/idem_hash/idem_result` + partial unique `(agent_id, idem_key)` (migration 0043, `database/bank_ddl/idempotency.py`). Key is re-checked under the per-mandate advisory lock inside `reserveSpend`, so a retry cannot reserve cap twice or sign a second authorization (`BankAgentPayService.ts` `reserveSpend`, `replayPay`). Same key + same terms returns the stored original result with `replayed:true`; different terms 409 CONFLICT; in-flight or ambiguous original 409 CONFLICT (not retried). A definitively failed attempt frees the key. No key: works as before, response `result.idempotent:false`. |

MCP: for a 409 "in progress / outcome pending" on the same key the tool now returns `retryable:true`, `retry_after_seconds:5` (routes/mcp.ts handleBankTool); different-terms 409 stays non-retryable. `bank_agent_pay` no longer sets `localDedupe` (`mcpTools.ts`); `handleBankTool` already forwarded `idempotency_key` as header and body, which the route now honours.

## NEEDS KEY -> KEY ADDED (second pass)

| Route | Moves money how | Before | After |
|---|---|---|---|
| `POST /payroll/runs` | creates a draft payroll obligation (funds move only on approve+execute) | none; a retry created a second draft run | optional `idempotencyKey` (body or header); `bank_payroll_runs.idem_key/idem_hash` + partial unique `(owner_type, owner_id, idem_key)` (migration 0044, `database/bank_ddl/idempotency2.py`); same key+terms returns original run, different terms 409; no key works as before with `idempotent:false` (`BankPayrollService.ts` createRun, `insertRun`) |

## SAFE-BY-CONSTRUCTION (service key derivation read)

| Route | Evidence |
|---|---|
| `POST /payroll/runs/:id/approve` | status CAS `draft -> approved` WHERE status='draft', BankPayrollService.ts approveRun (~:512-523); repeat returns the run |
| `POST /payroll/runs/:id/execute` | state guard approved/executing + item keys `payroll:{run}:{item}[:fx][:r{attempts}]` (itemKey, BankPayrollService.ts:209-214) |
| `POST /payroll/runs/:id/retry` | only failed items reset; attempt suffix rotates only for failed items (same itemKey, :209-214) |
| `POST /payroll/pools/:id/limits` | absolute set (jsonb merge of a fixed value), not an increment, BankPayoutPoolService.ts:127 |
| `POST /payroll/pools` | creates a pool config row, no funds move (money moves via itemKey-anchored receivables, BankPayoutPoolService.ts:168-175) |
| `POST /cards/settlements/retry` | re-drives existing pending/failed card transactions (BankCardService.ts:946-953); keys `card_cap_{providerTxnId}` (:511) and `card_ref_{providerTxnId}` (:544) |
| `POST /remittance/claim/:token` | CAS awaiting_claim->pending by token hash (BankRemittanceService.ts:256), transfer key `remit:{id}:claim` (:268), cashout key `remit-{id}-cashout` (:275) |
| `POST /remittance/:id/cancel` | CAS awaiting_claim (BankRemittanceService.ts:375-382), key `remit:{id}:refund` (:385) |
| `POST /escrows/:id/milestones/:seq/{deliver,confirm,dispute,resolve,refund}` | milestone state-machine guard + CAS on status (BankEscrowService.ts:125-152), amount bounded by remaining, keys `escrow:{id}:{milestone}:{kind}:{attempt}` (:195) |

## ALREADY KEYED (caller key required, service-enforced)

Spot-checked in the service (unique index + terms comparison):
- Org transfer `/orgs/:orgId/transfers`: BankApprovalService.ts:293 -> BankTransferService.ts:775-776 (requestHash CONFLICT), unique `ux_bank_transfers_idem` (db/schema/bank.ts:115).
- Treasury sweep `/orgs/:orgId/treasury/sweep`: per-account key `${key}:${accountId}` (BankTreasuryService.ts:175) -> earn deposit, BankEarnService.ts:431 terms check, `ux_bank_earn_ops_idem` (db/schema/bankEarnCredit.ts:53).
- Credit draw `/credit/draw`: BankCreditService.ts:315 insert, :328 terms CONFLICT, `ux_bank_transfers_idem`.
- Earn deposit `/earn/deposit`: BankEarnService.ts:431 (terms), :456 insert, `ux_bank_earn_ops_idem`.
Also traced: `/fx/execute` and platform fx (BankFxService.ts:197-203 terms CONFLICT + ux_bank_transfers_idem), `/ramps/offramp` (key `ramp:{cref}` derived from owner+key, BankRampService.ts:333-338), platform transfers (BankPartnerService.ts:229 -> BankTransferService).
Platform `stablecoin/mint|redeem`: key required but only forwarded to the issuer adapter (BankStablecoinService.ts:82-83); no local unique index, the issuer is trusted to dedupe. Flagged, not changed.
Schema-level only, not traced: `/transfers`, `/credit/*` other than draw, `/earn/withdraw`, invoices/pay, escrows create, streams create/usage, EWA advance, remittance send, agent streams, card create.

## P5 (done)

`BankRampService.ts` processEvent transfer webhook (~:502-518): the status UPDATE now refuses rows that are `failed` and not a deposit; 0 rows -> re-read and take the stale-flag branch.

## P1-P4

Owned by another builder; not touched here.

## Verification

`bun run check` passes; `check:openapi` in sync; `check:mcp` informational (28 hand-written schemas, unchanged baseline). Migrations 0043 and 0044 applied to `bank_proof_a` and `bank_proof_b` via `drizzle-kit migrate`. Last `bun run check`: only error is in BankAgentPayService.ts:642 (another builder's in-progress P1-P4 edit, arity mismatch), none in files touched here.
