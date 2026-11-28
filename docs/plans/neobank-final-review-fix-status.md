# Neobank final-review fix status

`bun run check` passes after all five items. No DDL added (metadata JSON only).

## 1 receivable_collection hold (MEDIUM) - DONE 
BankCreditService.ts ~:1153. Hold per line = least(owed + 1 rounding slack, invoice paid_minor - (amount_minor - face_minor) - sum(receivable_settled collectedMinor events)).
Never exceeds money received for this invoice since financing and not yet collected. numeric math, no overflow; one term per line, so lines on one account only add their own invoices' proceeds.

## 2 settlement account binding (MEDIUM) - DONE
BankCreditService.ts ~:1117 finance refuses if bank_invoices.payee_account_id != advance account; line metadata records payeeAccountId + dueAt (~:1140).
No code path updates payee_account_id on an invoice (only status/paid/scan fields), so it is immutable. Delinquency: the ltv/delinquency job (~:1299) marks an active receivable line delinquent when its invoice is past due_at and unpaid (blocks new credit). Off-reference onchain payments to the wallet are ordinary deposits and cannot be attributed; not pretended otherwise.

## 4 per-tx limit with fee (LOW) - DONE
BankTransferService.ts ~:805 passes amount + feeLeg.amountMinor to enforceSpendControls (per-tx limit and agent policy). Daily limit/balance unchanged (already include fee).

## 5 fee after principal reversal (LOW) - DONE
Fee already releases only when principal is `confirmed` (set at chain confirmation depth, BankTransferService advance ~:365). New compensateReversedPrincipalFees (~:294), run before the settle loop in confirmPending: a confirmed fee whose principal is `reversed` gets one reverse-phase ledger posting + status reversed + metadata.feeCompensated in one transaction (unique (transfer, phase) makes it idempotent). UNSECURED_CAP_UNITS comment fixed (~:66).

## 3 ramp stale provider transfer (LOW) - DONE
Bridge documents DELETE /transfers/{id} (awaiting_funds only): https://apidocs.bridge.xyz/api-reference/transfers/delete-a-transfer (also in apidocs llms.txt; not in neobank-provider-apis.md).
RampProvider.cancelTransfer? (optional, ramps/RampProvider.ts) ; BridgeProvider.cancelTransfer (DELETE). BankRampService cancelStaleProviderTransfer called when the send definitively fails (both failure paths); on cancel failure/no cancel sets metadata.cancelOwed. Webhook for a failed non-deposit ramp row no longer revives it: records metadata.staleProviderTransfer, no settle/credit. opsAlerts.ts adds kind 'ramp_transfer' to GET /bank/ops/alerts.
Item-1 proof (bank_proof_a, rolled back): scratchpad/hold_item1.sql. Found+fixed a paren bug in the hold SQL via this run.
