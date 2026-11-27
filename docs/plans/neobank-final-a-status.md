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

### payroll.ts
| handler | id | enforcement | verdict |
|---|---|---|---|
| POST /payees | accountId (body) | createPayee: getAccountById only rejects system accounts; paying another customer's account is the intended payee model | OK (by design) |
| POST /payees/:id/archive | payee | archivePayee WHERE owner ~L480 | OK |
| POST/GET runs, :id, approve, execute, retry, receipts | run | loadRun owner in WHERE (~L139) | OK |
| POST /runs | fundingAccountId, payeeIds | ledger.getAccount(owner); payees filtered by owner | OK |
| POST /runs, /schedules | poolId (body) | existence + asset/chain only, no operator/role check at create time; payer-limit enforcement happens at execution in BankPayoutPoolService (NOT traced here) | UNTRACED |
| POST /schedules/:id/status | schedule | WHERE owner ~L618 | OK |
| POST /schedules | payeeIds | payees filtered by owner | OK |
| GET /my-payouts | none (caller) | payees WHERE linkedOwner = caller; items by those payee ids | OK |
| GET /ewa/schedules/:id/:payeeId and POST .../advance | schedule, payee | scheduleAvail requires payee.linkedOwner == caller and payeeId in schedule items, schedule active (~L443) | OK |
| POST /ewa/streams/:id/advance | stream | BankStreamService (other builder's file) | UNTRACED |
| POST/GET /pools | account | createPool/listPools scoped to operator | UNTRACED (bodies not read) |
| GET /pools/:id, POST /pools/:id/limits | pool | requireOperator (BankPayoutPoolService ~L67) declared; call sites not read | UNTRACED (probable OK) |
| GET /pools/receivables | poolId | listReceivables: operator role filters pools by operator, payer role filters by payer (~L142-151) | OK |

### ramps.ts, remittance.ts
All id-taking handlers (kyc/:provider, external-accounts, virtual-accounts accountId, offramp fromAccountId/externalAccountId, transfers/:id, remittance send/claim/cancel/get, claim token preview): UNTRACED so far. Routes pass `owner` to the service; service enforcement not yet read.

Defects found so far: none. No FIXED rows yet.

## Item 2: retry shapes
- (a) card settlement: DONE. settleCapture used a fixed key `card_cap_<ptxn>`; a replay returned the existing failed/reversed transfer and the txn was marked `queued` with no send ever happening. Now: nextAttemptKey rotates only after a terminal failure (reversed, nothing sent), and failed/reversed result raises UPSTREAM so the txn stays `failed` for the next retry. A non-terminal replay returns the same transfer (no double send).
- (b) off-ramp: NOT STARTED.

## Item 3
- merchantId on simulate + real authorization path: DONE (AuthorizationRequest.merchantId optional, Stripe fills from merchant_data.network_id, SimulateInput + route schema accept merchantId).
- card_refund_pending field on transactions: NOT STARTED.

## Item 4
- a reveal-config: NOT STARTED
- b rails/quote decimals: NOT STARTED
- c offramp stage: NOT STARTED
- d my-payouts scheduleId + payeeId: DONE (Receipt optional fields, set only in myPayouts)

## Item 5: card budget cap units: NOT STARTED
