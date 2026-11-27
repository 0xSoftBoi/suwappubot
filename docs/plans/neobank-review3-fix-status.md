# Neobank review3 fix status

Migration: api-ts/drizzle/0036_bank_review3.sql + journal idx 35 + database/bank_ddl/review3.py (DONE; not yet applied to a DB).

1. DONE api-ts/src/services/bank/BankAgentPayService.ts - 'auth_unsettled' state set before header is sent, counted in daily cap, never released on 402/error; job `agent-pay-auth` (resolveUnsettledAuthorizations) reads authorizationState after validBefore+120s (used -> confirm, unused -> reverse); validBefore capped at 60s; strict wildcard host match (hostAllowed); asset/payTo/value checks already precede reserve+sign.
2. DONE BankApprovalService.ts - non-own-org destination accounts are payees (owner+account key); rolling 24h per actor and per org in transfer_over; whole evaluation+transfer under per-org pg advisory lock (withOrgTransferLock). Note: lock is org-level advisory lock, not the account row lock.
3. DONE routes/bank/platform.ts partnerId() - GET needs bank:platform:read|write, other methods bank:platform:write, no scopes refused; added both scopes to GRANTABLE_SCOPES in routes/enterprise.ts (key-creation path).
4. DONE BankPartnerService.ts - per-customer dedicated wallets via ensureOrgCustodyWallet(`pcust_<id>`), partner revenue on partner's own org wallet; BankTransferService.syncDeposit (~:812) refuses partner_customer accounts without metadata.dedicatedWallet (legacy shared-wallet accounts).
5. DONE platform.ts passes pid to mint/redeem; BankStablecoinService.guardPartner enforces accountInPartner before adapter call.
6. DONE BankStablecoinService.yieldShare scoped to partner_customer accounts of the calling partner (optional partnerId param; platform route always passes it).
7. NOT STARTED
8. NOT STARTED
9. NOT STARTED
10. NOT STARTED
11. NOT STARTED
12. NOT STARTED
13. DONE BankApprovalService.ts - currentDecisions() uses current membership/role in decide tally and in consumeApprovalToken.
14. NOT STARTED
Paywall replay: DONE BankAgentPayService.servePaidResource - nonce claimed in bank_agent_resource_sales under unique (chain, auth_nonce) before settle; replay/concurrent gets 402 payment_already_used; tx_hash unique already; seller credited via syncDeposit (onchain balance) only after settlement.

`bun run check`: my files clean; remaining errors are in BankPaymentsService.ts:334-335 (another fixer).
