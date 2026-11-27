# Neobank webapp <-> api-ts contract (facts read from source, round 2)

All bank webapp routes are mounted at `/webapp/bank/*` (api-ts `routes/bank.ts`). Success bodies are
`{ success: true, ...serviceResult }` (`routes/bank.ts:run`, line ~30). Errors from the bank services are
`{ success:false, error: CODE, error_code: CODE, message, missing? }` with HTTP status from
`services/bank/errors.ts` STATUS map. Zod failures are `{ error:'Validation Error', error_code:'VALIDATION_ERROR', fields }` (400).

## Part 1

### a. Where each money endpoint returns the transfer id
| Endpoint | Service return (file) | Transfer id |
|---|---|---|
| POST /transfers | `{ transfer }` (routes/bank/core.ts:138) | `transfer.id` |
| POST /fx/execute | `{ transfer, quote }` (BankFxService.ts:71) | `transfer.id` |
| POST /ramps/offramp | `{ rampTransfer, quote\|null }` (BankRampService.ts:80) | `rampTransfer.bankTransferId` (nullable; schema bankRemitRamps.ts:99) |
| POST /remittance/send | `{ remittance, claimToken?, claimLink?, claimPath?, quote? }` (BankRemittanceService.ts:62) | `remittance.bankTransferId` (nullable; bankRemitRamps.ts:161) |
| POST /orgs/:id/transfers | `{approvalRequired:false, transfer}` or `{approvalRequired:true, reason, request}` (BankApprovalService.ts:170-172) | `transfer.id` or none (approval pending) |
| POST /earn/deposit, /withdraw | `{ operation }` (routes/bank/earn.ts:72-99) | `operation.transferId` (nullable; bankEarnCredit.ts:46) |
| POST /credit/draw, /repay | `{ line, transferId\|null, txHash\|null, status }` (BankCreditService.ts:121-122) | `transferId` |
| POST /payments/invoices/pay | `{ invoice, payment, transferStatus }` (BankPaymentsService.ts:91-94) | `payment.transferId` (bankPaymentsPayroll.ts:70) |
| POST /payroll/runs/:id/execute, /retry | `{ run, items[] }` (BankPayrollService.ts:111-113) | per item `items[].transferId` (and `fxTransferId` when converted) (bankPaymentsPayroll.ts:291-292) |
| POST /payroll/ewa/.../advance | `{ stream\|..., advanceId, transferId\|null }` (BankStreamService.ts:63) | `transferId` |
| POST /escrows (fund) and every escrow action | `EscrowView {escrow, milestones, events}` (BankEscrowService.ts:40-44) | NONE at top level. Release/refund ids only in `milestones[].settlement[].transferId` (bankPaymentsPayroll.ts:137). Funding transfer id not returned. |
| POST /streams/:id/settle | `StreamView {stream, accruedMinor, unsettledMinor, advanceAvailableMinor}` (BankStreamService.ts:43-49) | NONE |
| POST /cards/settlements/retry | `{ attempted, settled, failed }` (BankCardService.ts:185) | NONE (counts only) |

Client: `transferIdOf.*` accessors in `webapp/src/lib/bankApi.ts` replace the old heuristic `findTransferId`.

### b. Earn / credit rate units
PERCENT, not fraction, not bps. `BankEarnService.ts:174` (`rate = apy * 100`, `apy: rate, netApy: rate`), positions `:561-567` reuse `netApy`.
Credit markets: `BankCreditService.ts:188-189` `borrowApy/supplyApy = fraction * 100` (percent). `lltvBps` is bps.
Existing UI bug fixed: Earn `pct()` multiplied by 100 again; Credit used `borrowApy * 100`.

### c. Fiat decimals
The API does NOT return decimals for ramp quotes or QR payloads. Server table `services/bank/ramps/rails.ts:34-43`
FIAT_DECIMALS: USD/EUR/GBP/MXN/BRL/COP/INR/NGN = 2, VND = 0 (default 2 in `BridgeProvider.ts:335`). `qr.ts` says amounts are minor units
of the rail currency (BRL/INR 2, VND 0). Client uses an ISO-4217 table (`fiatDecimals`, `currencyDecimals` in bankApi.ts): 0 for JPY/KRW/VND/CLP/..., 3 for BHD/KWD/..., 4 for CLF, else 2; stablecoins resolve via `/assets`.
RampProvider.ts:57-60 documents sourceDecimals/destDecimals as stablecoin = asset decimals.

### d. External-account fields (routes/bank/ramps.ts:30-37, BridgeProvider.ts:208-226)
POST body: `{ provider: 'bridge'|'due', accountType: 'us'|'iban'|'clabe', ownerName, bankName?, label?, account: Record<string,string<=64>>, address?: { street_line_1 (4-35), city, country (alpha-3), state?, postal_code? } }`.
`account` keys per type: us = `account_number` + `routing_number`; iban = `account_number` (the IBAN) + `country` (alpha-3) + optional `bic`; clabe = `account_number` (exactly 18 digits).
Virtual accounts: `{ provider, accountId, sourceCurrency: usd|eur|mxn|brl|cop|gbp }`.

### e. Escrow / payroll run shapes
`GET /escrows/:id` = `{ escrow, milestones[], events[] }` (EscrowView). escrow columns: bankPaymentsPayroll.ts:85-113; milestone columns :119-137 (status, deliveryProof, deliveredAt, deliverBy, autoReleaseAt, releasedMinor, refundedMinor, settlement[]).
Escrow actions: `deliver {proof}`, `confirm`, `dispute {reason}`, `resolve {releaseMinor, note?}`, `refund` at `/escrows/:id/milestones/:seq/<action>` (payments.ts:138-155). Roles enforced server-side (payer confirm/dispute, payee deliver, arbiter resolve/refund).
`GET /payroll/runs/:id` = RunPreview `{ run, items:[{item, payee:{id,name,method,currency}, conversion:{needed,to?}, routable, issue?}], totalMinor, fundingBalanceMinor, sufficientFunds, usesPool, approvalRequired }` (BankPayrollService.ts:65-73).

### f. Ledger direction and bill decimals
Ledger `direction` is `'debit' | 'credit'` (db/schema/bank.ts:130). Bills (`bank_org_bills`, bankBusiness.ts:193-215) carry `asset` + `chain` + `amountMinor`: decimals = `/assets` lookup of (asset, chain), never the org reporting currency.

### g. Public invoice
`GET /public/bank/invoices/:slug` (payments.ts:195-206; mounted app.ts:24 + `/public/bank` rate limit :239) returns `{ success:true, invoice: PublicInvoice }`:
`{ slug, status, amountMinor, paidMinor, asset, chain, lineItems[{description,quantity,unitAmountMinor}], memo, dueAt, paymentRequest: { family:'evm'|'solana', uri, qrPayload, payTo, payAmountMinor, asset, chain, reference } }`. Slug regex `^[A-Za-z0-9_-]{8,32}$`; drafts 404. Errors: `{success:false, error, message}`.
Webapp page: `/pay/:slug` (public route, no ProtectedRoute).
Note: `payAmountMinor` (what an external payer must send; EVM includes a unique tag) may differ from `amountMinor - paidMinor`.

### h. Typed error codes
Central `describeBankError(code, message)` in bankApi.ts covers every `BankErrorCode` in `services/bank/errors.ts`; `bankErrorText(e)` wraps thrown values. Server field is `error_code` (and `error`).

## Other facts used for Part 2
- Card issue body (cards.ts:20-47): `{ accountId, idempotencyKey, type: virtual|physical, provider?: stripe|rain, label?, rules?, orgId?, memberId?, teamId?, expenseCategory?, memo?, termsAccepted?, cardholder?: { name, email?, phoneNumber?, billing: {line1,line2?,city,state?,postalCode,country(2)}, individual?: {firstName,lastName,dob:{day,month,year}} }, shipping?: {...addr, name, speed?: standard|express|priority} }`.
- Reveal: `POST /cards/:id/reveal-key {nonce}` -> `{ ephemeralKeySecret, expiresAt, providerCardId, provider }` (BankCardService.ts:180). Needs Stripe.js `createEphemeralKeyNonce` + publishable key.
- Credit: unsecured `POST /credit/unsecured {accountId}` -> `{line}`; score `GET /credit/score?asset&chain` -> `{score}`; receivables `POST /credit/receivables/finance {accountId, invoiceId}` -> `{ line, advanceMinor }`.
- Streams create (payments.ts:48-59): `{ idempotencyKey, payerAccountId, payeeAccountId, kind: rate|metered, rateMinor?, periodSeconds?, unitPriceMinor?, capMinor, dustMinor?, ewaBps?, metadata? }`; usage `POST /streams/:id/usage {units}` (payee only).
- Payroll schedule create (payroll.ts:41-52): `{ fundingAccountId, name, frequency: weekly|biweekly|monthly, timezone, dayOfWeek?, dayOfMonth?, localTime? 'HH:MM', items:[{payeeId, amountMinor, memo?, ewaBps?}], poolId?, autoApprove? }`. EWA: `GET /payroll/ewa/schedules/:id/:payeeId`, `POST .../advance {amountMinor}`, `POST /payroll/ewa/streams/:id/advance {amountMinor}`.
- Approvals: policy `{ ruleType: transfer_over|new_payee|payroll_run, thresholdMinor?, requiredApprovals 1-10, approverRoles[], expiryHours 1-720 }`; request `POST /orgs/:id/approval-requests {action: payroll_run|new_payee, payload}`; decide `/approval-requests/:id/approve|reject {comment?}`; `POST /approval-requests/:id/token`; cancel `/cancel`. Payroll payload must be `{ runId, totalMinor }`.
- Bills (business.ts:55-57): vendor `{name, email?, payAddress?, payChain?, categoryId?}`; bill `{vendorId, reference?, amountMinor, asset, chain, dueDate, categoryId?}`; schedule `{payFromAccountId, scheduledFor}`.
- Card budgets: `PUT /orgs/:id/card-budgets {scope: member|team, scopeId, monthlyCapMinor?, perTxCapMinor?, categoryBudgets?}`.
- Privacy (chains.ts): meta-address generate returns keys ONCE (not stored); payout `{payeeMetaAddress, payoutRef, token?}`; scan `{chain, fromBlock, viewPrivateKey, spendPublicKey}` (sends a private view key to the server); compliance export `GET`.
- Fee model: `POST /chains/fee-model {asset, amountMinor|amount, chains[]}` -> `{ model }`.

## Backend defects / gaps (for the api-ts owner)
1. Escrow create/fund returns no funding transfer id; milestone actions return only EscrowView. Stream settle returns no transfer id. Client can only show status, not track the transfer.
2. `/platform/*` handlers (platform.ts:52-58 `partnerId`) require an org API key (`apiKeyAuth.orgId`) and 403 for Telegram webapp sessions, so the Developers page (config, customers, usage) can never succeed from the Mini App. Needs a webapp-session partner path, or these should not be mounted on `/webapp/bank`.
3. Card reveal needs Stripe.js + a publishable key; no endpoint returns the publishable key, and `@stripe/stripe-js` is not a webapp dependency. Reveal cannot be completed in-app until that is exposed.
4. `POST /privacy/scan` takes `viewPrivateKey` over the wire to the server (server-side scanning of a view key). Acceptable only if the product accepts it; there is no client-side scan.
5. Ramp quotes and QR payloads carry currency codes but no decimals (only server-side FIAT_DECIMALS); `/ramps/rails` could return `decimals`.
6. Offramp `bankTransferId` is nullable and the response does not say when it is set; the UI polls the ramp transfer if null.
7. Response for `payInvoice` -> `payment` row shape is not typed in the service interface read (only `BankInvoicePayment`); `transferId` presence is assumed from the schema column (bankPaymentsPayroll.ts:70).

8. Receivables financing now requires the payer to have ACCEPTED the invoice, but no payer-side "accept invoice" route was visible in routes/bank/payments.ts when read (publish/void/pay only) and Invoice has no documented accepted flag. The webapp lists invoices with their real `status` and surfaces the server's refusal; it cannot build the accept action until the route and field exist.
9. `GET /payroll/my-payouts` (Receipt, BankPayrollService.ts:80-) carries no scheduleId/payeeId, so a worker cannot discover which schedule/payee to use for earned-wage access; the UI asks for the two ids.
10. Public invoice (`/public/bank/invoices/:slug`) has no asset decimals and `/assets` needs a session. Unauthenticated payers see Solana Pay decimals from the URI, but EVM amounts only as base units (signed-in users get formatted amounts). Fix: add `decimals` to PublicInvoice/PaymentRequest.
11. Approval policy `thresholdMinor` is in reporting-currency minor units (BankApprovalService.ts:277); card-budget cap units are not stated in the service signature (UI assumes reporting currency; unverified).
12. Card ephemeral-key reveal NOT built (see 3): no Stripe.js dependency, no publishable key endpoint. PAN is never rendered or stored.
13. Transient retries: client retries 429 and non-"not configured" 503 up to 3 times with the SAME idempotency key (lib/bankApi.ts `req`). Wallet-busy has no stable error code in errors.ts; if it uses WALLET_UNAVAILABLE (HTTP 409) it will NOT be retried.

## Status
- Part 1 (a-h): DONE in webapp/src/lib/bankApi.ts (transferIdOf.*, units, fiatDecimals, describeBankError(code,message), types) and consumers (Convert, Credit, Earn, Ramps, Send, Payments, MoneyAction).
- `/pay/:slug`: public route in App.tsx -> pages/bank/PayInvoice.tsx; share link = `invoicePayLink(slug)`.
- Part 2 built: card issuing with cardholder + physical shipping (components/bank/IssueCard.tsx); escrow deliver/confirm/dispute/resolve/refund role-aware (components/bank/EscrowDetail.tsx); approvals inbox + token + payroll approval request `{runId,totalMinor}` + policies editor + card budgets + bills/vendors (pages/bank/BusinessExtra.tsx); streams create/usage/EWA (components/bank/StreamsPanel.tsx); payroll schedules + my pay + EWA (pages/bank/PayrollExtra.tsx); unsecured line + receivables (components/bank/CreditExtra.tsx); Privacy (/bank/privacy); Developers (/bank/developers: handle publish with account selection, partner config/customers/usage); cheapest-chain hint in Send.
- Part 2 NOT built: card reveal (defect 3), invoice accept (defect 8), org transfer form with approval token (no UI; client `bank.orgTransfer` + `transferIdOf.orgTransfer` exist), Payroll approve-with-token input.

## Round 2 status (current)
Part 1: a APPLIED (transferIdOf.*), b APPLIED (percent), c APPLIED (fiatDecimals/currencyDecimals), d APPLIED as contract (type + fields documented; Banks tab form unchanged unless it already used account_number/routing_number: NOT re-audited), e APPLIED (EscrowView/PayrollPreview), f APPLIED (LedgerDirection, bill decimals from /assets), g APPLIED (/pay/:slug public, share link = invoicePayLink), h APPLIED (describeBankError(code,message) incl. LOCK_BUSY; bankErrorText used by ErrorBox).
Part 2: card issuing+cardholder+shipping BUILT; card reveal NOT BUILT (defect 3); escrow deliver/confirm/dispute/resolve/refund BUILT; approvals inbox/token/payroll request/policies BUILT; streams create/usage/EWA BUILT; payroll schedules + my pay + EWA BUILT; unsecured line + receivables BUILT; payer accept BUILT on Payments > Invoices (payer role) using ASSUMED body `{invoiceId}` for POST /credit/receivables/accept (not on /pay/:slug because the public view has no invoice id); bills/vendors BUILT; card budgets BUILT; Privacy BUILT; Developers BUILT (platform part will 403 for Telegram sessions); cheapest-chain hint BUILT; org-transfer form NOT BUILT; invite email now required BUILT; same-key retry on 429/503 BUILT.
Verification: 390x844 screenshots with intercepted responses (script in scratchpad webapp-verify/verify.cjs) of BankHome, Send confirm, Earn vaults, Cards rules, Credit line, /pay/:slug, RAMP_UNAVAILABLE state; no horizontal overflow (scrollWidth == 390 on all).

## Round 3 status
1. Transfer ids tracked: BUILT (escrow fundingTransferId on create via TransferTracker + per-milestone TransferLine in EscrowDetail; stream Settle now confirm sheet + tracker; payInvoice uses top-level transferId)
2. /pay/:slug: BUILT (symbol/decimals/chainName, acceptance row, Accept banner only if invoice is in viewer's payer list, POST /payments/invoices/:id/accept)
3. Receivables financing acceptance + refusal explanations: NOT STARTED
4. Card reveal: BUILT (components/bank/RevealCard.tsx; Stripe.js loaded on tap; needs card.providerCardId from GET /cards/:id, else shows unavailable)
5. Ramps decimals/stage/per-rail external-account form: NOT STARTED
6. Payroll my-pay ids + approve-with-token: NOT STARTED
7. Business org transfer + approval flow, thresholdCurrency, invite by email/Telegram: NOT STARTED
8. Developers: BUILT (org picker for owner/admin; platform config/usage/customers with ?orgId=; API keys list/create with scopes/revoke via /enterprise/orgs/:orgId/api-keys, secret shown once with copy)
9. Privacy local scanning: NOT STARTED
10. Cards: BUILT (capCurrency/capDecimals via GET /cards/:id; refund state; shortfall note inferred from frozen + failed settlement since no explicit field; merchantAllow editor with exact-match/id: copy)
11. BankHome ops alerts banner: NOT STARTED
12. Cosmetic fixes (vault name ellipsis, account dropdown clip): NOT STARTED

Build after items 1,2,4,8,10: passes. Remaining: 3,5,6,7,9,11,12 NOT STARTED; deep-link cold-open of /bank/claim/:token and /pay/:slug NOT CHECKED.
