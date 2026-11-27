# Neobank review3 fix status

Migration: api-ts/drizzle/0036_bank_review3.sql + journal idx 35 + database/bank_ddl/review3.py (DONE; not yet applied to a DB).

1. DONE api-ts/src/services/bank/BankAgentPayService.ts - 'auth_unsettled' state set before header is sent, counted in daily cap, never released on 402/error; job `agent-pay-auth` (resolveUnsettledAuthorizations) reads authorizationState after validBefore+120s (used -> confirm, unused -> reverse); validBefore capped at 60s; strict wildcard host match (hostAllowed); asset/payTo/value checks already precede reserve+sign.
2. DONE BankApprovalService.ts - non-own-org destination accounts are payees (owner+account key); rolling 24h per actor and per org in transfer_over; whole evaluation+transfer under per-org pg advisory lock (withOrgTransferLock). Note: lock is org-level advisory lock, not the account row lock.
3. DONE routes/bank/platform.ts partnerId() - GET needs bank:platform:read|write, other methods bank:platform:write, no scopes refused; added both scopes to GRANTABLE_SCOPES in routes/enterprise.ts (key-creation path).
4. DONE BankPartnerService.ts - per-customer dedicated wallets via ensureOrgCustodyWallet(`pcust_<id>`), partner revenue on partner's own org wallet; BankTransferService.syncDeposit (~:812) refuses partner_customer accounts without metadata.dedicatedWallet (legacy shared-wallet accounts).
5. DONE platform.ts passes pid to mint/redeem; BankStablecoinService.guardPartner enforces accountInPartner before adapter call.
6. DONE BankStablecoinService.yieldShare scoped to partner_customer accounts of the calling partner (optional partnerId param; platform route always passes it).
7. PARTIAL BankPartnerService.ts withFeeFirst - fee charged first (no error after principal moved), refunded from partner revenue if principal fails; NOT a single ledger tx (needs BankTransferService two-leg change, off-limits); retry of same idempotency key after a refunded failure reuses the original fee transfer.
8. DONE BankPaymentNetworkService.publish - setWhere owner condition + returning, CONFLICT when no row; handle is already the primary key (unique).
9. DONE verifyDocument requires signer bound to a rail address; tempo exception removed; resolve returns verified:false + reason instead of a usable result.
10. DONE services/bank/segments.ts setAccountSegment - blocks while credit/earn/card positions open, agent accounts cannot leave 'agent', audit row (bank_org_audit) per change.
11. DONE BankOrgService createInvite/acceptInvite - invite bound to invitee (email or telegramId, stored in invite email column as 'tg:<id>'); acceptor's users.telegramId/recoveryEmail must match; single-use claim already existed. createInvite now requires email or telegramId (route schema only exposes email).
12. DONE routes/ssrfGuard.ts - additive: 198.18.0.0/15, 192.0.0.0/24, NAT64 64:ff9b::/96 (+64:ff9b:1::/48), 6to4, Teredo embedded IPv4 classified.
13. DONE BankApprovalService.ts - currentDecisions() uses current membership/role in decide tally and in consumeApprovalToken.
14. DONE publish requires explicit accountIds (default none), domain fixed to new env BANK_PAY_DOMAIN (EnvService.ts); platform.ts Publish schema updated (domain now ignored/optional).
Paywall replay: DONE BankAgentPayService.servePaidResource - nonce claimed in bank_agent_resource_sales under unique (chain, auth_nonce) before settle; replay/concurrent gets 402 payment_already_used; tx_hash unique already; seller credited via syncDeposit (onchain balance) only after settlement.

`bun run check`: clean (0 errors) at last run.
