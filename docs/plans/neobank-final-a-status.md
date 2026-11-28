# Neobank final-A status

Line numbers are in services/bank/* as of this run (approximate, +-5 after edits).

## Item 1: route authorization table

### cards.ts (all TRACED)
| handler | id | enforcement | verdict |
|---|---|---|---|
| POST /cards | accountId | BankCardService.issueCard -> ledger.getAccount(owner) ~L673 | OK |
| GET /cards | accountId/memberId/orgId filters | listCards where owner = caller ~L767 | OK |
| GET /cards/:id | card | loadCard (owner in WHERE) ~L198 | OK |
| POST /cards/:id/freeze,unfreeze,cancel | card | setStatus -> loadCard ~L794 | OK |
| PUT /cards/:id/rules | card | updateRules -> loadCard ~L812 | OK |
| POST /cards/:id/simulate | card | simulate -> loadCard ~L825 | OK |
| POST /cards/:id/reveal-key | card | revealKey -> loadCard ~L859 | OK |
| GET /cards/:id/transactions, /authorizations | card | loadCard ~L869/875 | OK |
| POST /cards/authorizations/:authId/receipts | authorization | addReceipt joins bank_cards on owner ~L881 | OK |
| PATCH /cards/authorizations/:authId | authorization | setExpense joins bank_cards on owner ~L899 | OK |
| POST /cards/settlements/retry | none | retrySettlements joins bank_cards on owner ~L915 | OK |

### payroll.ts (all TRACED)
| handler | id | enforcement | verdict |
|---|---|---|---|
| POST /payees | accountId (body) | getAccountById rejects only system accounts; paying another customer's account is the payee model | OK (by design) |
| POST /payees/:id/archive | payee | archivePayee WHERE owner | OK |
| runs list/get/approve/execute/retry/receipts | run | loadRun owner in WHERE | OK |
| POST /runs, /schedules | fundingAccountId, payeeIds | ledger.getAccount(owner); payees filtered by owner | OK |
| POST /runs, /schedules | poolId | existence + asset/chain only; any payer may reference a pool, exposure bounded by per-payer limit enforced in BankPayoutPoolService.advancePayout (default limit 0) | OK (design) |
| POST /schedules/:id/status | schedule | WHERE owner | OK |
| GET /my-payouts | caller | payees WHERE linkedOwner = caller | OK |
| GET/POST /ewa/schedules/:id/:payeeId[/advance] | schedule, payee | scheduleAvail: payee.linkedOwner == caller AND payee in schedule items AND schedule active | OK |
| POST /ewa/streams/:id/advance | stream | BankStreamService (other builder's file) | UNTRACED |
| POST/GET /pools | account | createPool: getAccount(operator) + kind=pool; listPools by operator | OK |
| GET /pools/:id, POST /pools/:id/limits | pool | loadPool + requireOperator (BankPayoutPoolService L67) | OK |
| GET /pools/receivables | poolId | operator: pools filtered by operator; payer: filtered by payer | OK |

Note: payee.linkedOwner is payer-asserted (not verified by the worker); worst case is a worker seeing receipts for items the payer chose to link, and the advance pays payee.accountId the payer chose, from the payer's funds. Accepted.

### ramps.ts / remittance.ts (all TRACED)
| handler | id | enforcement | verdict |
|---|---|---|---|
| POST/GET /ramps/kyc | provider | requireCustomer(owner, provider) | OK |
| POST /ramps/virtual-accounts | accountId | ledger.getAccount(owner) + own KYC customer | OK |
| GET /ramps/virtual-accounts, external-accounts, transfers | none | WHERE owner | OK |
| POST /ramps/offramp | fromAccountId, externalAccountId | getAccount(owner); external account WHERE owner (BankRampService ~L320) | OK |
| GET /ramps/transfers/:id | ramp transfer | WHERE owner | OK |
| POST /remittance/quote, send | fromAccountId; payout externalAccountId | getAccount(owner); offramp checks external account owner | OK |
| POST /remittance/claim/:token | token, accountId, externalAccountId | token hash CAS single-use; getAccount(claimer); cash-out via offramp(owner=claimer) so external must be the claimer's | OK |
| POST /remittance/:id/cancel | remittance | sender check | OK |
| GET /remittance/:id, list | remittance | sender or recipient only; maskClaim | OK |
| GET /remittance/claim/:token (preview) | token (bearer) | returns status, amountMinor, asset, chain, currency, memo, expiresAt, autoEarn. No sender id/account/escrow/transfer ids. Sender display name NOT included (not in the data returned today). memo/autoEarn kept for client compatibility (removal would break the contract) | OK, note |

Totals: handlers traced 45; OK 44 (incl. by-design notes); FIXED 0 (no authz defect found); UNTRACED 1 (streams advance, other builder's file).

## Item 2: retry shapes
- (a) card settlement DONE. settleCapture used a fixed key `card_cap_<ptxn>`; an idempotent replay returned the existing failed/reversed transfer and the txn was marked `queued` although nothing was sent, and could never be re-sent. Now nextAttemptKey rotates only after a terminal failure (reversed, nothing sent); a failed/reversed result raises UPSTREAM so the txn stays `failed` for the next retry; non-terminal replay returns the same transfer (no double send). Credit draw is idempotent per providerTransactionId.
- (b) off-ramp DONE (BankRampService.offramp):
  - provider create ok + row insert fails: retry re-creates with the same provider idempotency key; no send happened. Safe.
  - provider ok + send errors: tapError now links an already-recorded bank transfer (never marks failed if the send exists), else marks the ramp row failed. Bank-transfer key `ramp:<cref>` is deterministic, so at most one send.
  - send ok + bankTransferId not recorded (crash): retry with same key resumes via sendFor(prior, depositAddress from metadata); same key returns the existing transfer, no second send.
  - send returned failed/reversed: ramp row now set to failed (was left live with bankTransferId set).
  - send without recorded provider transfer: impossible, the row is inserted before the send.
  - retry with changed amount/account/external account under the same key: CONFLICT (was silently returning the prior row).
  - Not changed: a failed row stays failed on retry (new key needed).

## Item 3
- merchantId on simulate + real authorization path DONE (AuthorizationRequest.merchantId optional; Stripe fills merchant_data.network_id; simulate body accepts merchantId). Rain provider does not supply one.
- Refund pending state DONE: GET /cards/:id/transactions refund rows get `refundState: 'AWAITING_REFUND_INFLOW'` and `creditEvent: 'card_refund_pending'` while the credit op (`cardref:<ptxn>`) is pending.

## Item 4
- a GET /cards/reveal-config DONE (STRIPE_PUBLISHABLE_KEY optional in EnvService, must start with pk_, else PROVIDER_NOT_CONFIGURED).
- b DONE: GET /ramps/rails rows add `currency`, `decimals`, plus top-level `fiatDecimals`; POST /ramps/quote adds `fiatCurrency`, `decimals`.
- c DONE: offramp response adds `stage` (funded | awaiting_funding | failed).
- d DONE: my-payouts rows add `scheduleId`, `payeeId` (caller's own payees only).

## Item 5 DONE
GET /cards/:id adds `capCurrency` and `capDecimals`; simulate adds the same.

## Checks
bun run check: clean. bun run check:openapi: in sync (no new Zod-validated route shape drift).
