# Neobank paywall fix status

1 HIGH FIXED: `validatePaymentForResource` (x402Codec.ts) runs before any claim insert in `servePaidResource` (EOA sig vs server domain, to/value/window/chain/asset). Reconcile (`reconcilePendingSales`, `findSettlementTx`) needs AuthorizationUsed + Transfer(from->payTo>=price) in one tx. Definite facilitator verify refusals (`definite: true` in FacilitatorService) delete the claim.
2 MEDIUM FIXED: sha256(header) stored in `payer` as `<addr>#<hash>`; re-serve requires the same value (no DDL).
3 MEDIUM FIXED: no unverified rows; ORDER BY created_at; unprocessable rows -> terminal `rejected:<id>` after 1h; `/x402/bank/*` ipRateLimit(240) at app.ts:240.
4 LOW FIXED: `/privacy/announcements` capped at 10,000 blocks, hex fromBlock only, nextCursor = next fromBlock.
Note: ERC-1271 payers unsupported (no verifier in repo).

## Follow-up P1-P4 (seller paywall)
P2 FIXED: `validatePaymentForResource` caps validBefore-now at maxTimeoutSeconds(120)+30s (x402Codec.ts); claim stores `valid_before`+`head_block` (migration 0045, `database/bank_ddl/sales_recovery.py`); `reconcilePendingSales` releases/rejects only once the SAFE block time > validBefore+60s (legacy rows: created+1h15m); FacilitatorService verify refusal matching nonce/authorization-used is no longer `definite` (claim kept, reconcile finds the tx -> `unserved`).
P1 FIXED: upstream failure after settlement returns a random 32-byte token (body + `X-Retrieval-Token`), only sha256 stored (`retrieval_hash`); re-serve needs header-hash AND token, token consumed on the flip. Reconcile-created `unserved` sales: `POST /x402/bank/pay/:slug/recover` {chain,nonce} -> 5-min challenge; +{signature} (EIP-191) must recover to the authorization `from` -> token. `recoverPaidResource` in BankAgentPayService.ts.
P3 FIXED: finalise UPDATE requires `tx_hash = pending:<nonce>`; 0 rows -> re-read, continue only if the row is already `unserved:<this tx>`, else 402.
P4 FIXED: `safeBlockOf` shared by log search and `readAuthUsed(…, atBlock)`; search starts at stored head_block-100 (up to 200 chunks); incomplete search never rejects (stays pending); ops-alerts job logs paywall claims pending >3h.
Open: check:mcp lists near_resolve_asset/perps_markets (not from this change).
