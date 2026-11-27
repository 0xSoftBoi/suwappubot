# Neobank paywall fix status

1 HIGH FIXED: `validatePaymentForResource` (x402Codec.ts) runs before any claim insert in `servePaidResource` (EOA sig vs server domain, to/value/window/chain/asset). Reconcile (`reconcilePendingSales`, `findSettlementTx`) needs AuthorizationUsed + Transfer(from->payTo>=price) in one tx. Definite facilitator verify refusals (`definite: true` in FacilitatorService) delete the claim.
2 MEDIUM FIXED: sha256(header) stored in `payer` as `<addr>#<hash>`; re-serve requires the same value (no DDL).
3 MEDIUM FIXED: no unverified rows; ORDER BY created_at; unprocessable rows -> terminal `rejected:<id>` after 1h; `/x402/bank/*` ipRateLimit(240) at app.ts:240.
4 LOW FIXED: `/privacy/announcements` capped at 10,000 blocks, hex fromBlock only, nextCursor = next fromBlock.
Note: ERC-1271 payers unsupported (no verifier in repo).
