# Neobank final-C status (client-contract gaps)

Status as of this write. api-ts `bun run check` exit 0 after items 1-3 (background run).

## 1. Cards: providerCardId + shortfall — DONE (pending re-check)
- `api-ts/src/services/bank/BankCardService.ts`: `CardShortfallView` (L181), `openShortfallsByCard` (L320), list mapping (L814), get mapping (L822). View mapping only.
- `providerCardId` was already returned (card rows are returned whole). `shortfall` = {amountMinor (outstanding = amount - repaid), asset (card currency), since (ISO), reason 'CAPTURE_EXCEEDED_AVAILABLE'}, only when a `bank_card_shortfalls` row is open.
- FINDING (not changed, behaviour-preserving): the raw card row also returns `expMonth`/`expYear` (and `cardholderId`). No PAN/CVC exists anywhere in the row. Expiry month/year IS returned today; stripping it is a behaviour change left to the conductor.
- `routes/bank/cards.ts` needed no change.

## 2. Refusal reason codes — DONE (pending re-check)
- Existing mechanism had only `missing`/`cause` in `bankErr` extra (no `details`). Added optional `reason` beside `missing`: `services/bank/errors.ts` L63-72; serialized in `routes/bank.ts` L29 (central handler).
- `services/bank/BankCreditService.ts`: reason attached to financeReceivable / openUnsecuredLine refusals (RELATED_PARTIES, EXPOSURE_CAP, DELINQUENT_LINE, NOT_ACCEPTED, SETTLEMENT_ACCOUNT_MISMATCH, ALREADY_FINANCED, INVOICE_STATE, NO_PRICE, LENDER_POOL_UNFUNDED at ~L505). Conditions unchanged.

## 3. /privacy/announcements toBlock — DONE (pending re-check)
- Before: omitted toBlock meant head, so any span > 10,000 was rejected with VALIDATION; no toBlock in response.
- Now `services/bank/BankPrivacyService.ts` L154-155: omitted -> min(fromBlock + span - 1, head); `latest` keeps strict behaviour. Response adds `toBlock` (hex) at L159/L171; `nextCursor` unchanged. `routes/bank/chains.ts` unchanged.

## 4. SDK types + agents.pay idempotency key — DONE
- `packages/sdk/src/types.ts` Bank section (before "end Bank section"): BankCardShortfall, BankCardViewExtras, BankCreditRefusalReason, BankPrivacyAnnouncementsPage, BankAgentPayIdempotency, BankPaywallUpstreamFailedBody/RecoverArgs/RecoverResult; `idempotencyKey?` on BankAgentPayArgs.
- `packages/sdk/src/bank.ts` agents.pay and `packages/sdk-python/src/suwappu/bank.py` agents.pay: optional key -> Idempotency-Key header (existing same-key retry rule); unkeyed unchanged.

## Checks
api-ts `bun run check` 0; `check:openapi` in sync; `check:mcp` exit 0; sdk `bun run build` 0; bank.py parses, `import suwappu` ok.
