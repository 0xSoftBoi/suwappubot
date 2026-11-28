# Neobank prod smoke (api.suwappu.bot, 2026-11-28)

| Step | HTTP | Result | Note |
|---|---|---|---|
| 1a GET /health | 200 | PASS | source_fingerprint aec2a8c13615, db connected |
| 1b GET /v1/agent/bank/assets (no key) | 401 | PASS | UNAUTHORIZED |
| 2 POST /v1/agent/register (bank-smoke-20261128) | 201 | PASS | agent 5507f879-29f6-4192-b569-c6088847fcf5 |
| 3 /assets /segments /accounts /transfers /ops/alerts /cards /payments/invoices /agents/directory | 200 | PASS | 20 assets / 6 chains; lists empty; directory empty |
| 3 /earn/vaults USDC base | 200 | PASS | 8 live Morpho vaults, APY 3.2-4.85% |
| 3 /credit/markets USDC base | 200 | PASS | live markets (cbBTC/USDC borrow 5.05%) |
| 3 /ramps/rails | 200 | PASS | rails listed, all "unconfigured: BRIDGE_API_KEY" |
| 3 POST /chains/fee-model | 200 | PASS | base recommended (652 micro-USD) |
| 4 POST /ramps/quote | 503 | PASS | PROVIDER_NOT_CONFIGURED BRIDGE_API_KEY |
| 4 POST /cards (fake accountId) | 404 | PASS* | NOT_FOUND Account not found; provider gate not hit before account lookup, nothing created |
| 4 GET /cards/reveal-config | 503 | PASS | PROVIDER_NOT_CONFIGURED STRIPE_PUBLISHABLE_KEY |
| 5 POST /v1/agent/wallets (evm) | 201 | PASS | Turnkey wallet 0xe5997Cc7E256EBd1Cce1Ea1230147a7B64e1a910 |
| 6 POST /bank/accounts checking USDC base | 200 | PASS | acct_08559058964a4aa9a4cd81f4d72a61fb, same address, balance 0 |
| 6 replay open-account (no idem key in schema; same body) | 200 | PASS | same account id returned, no duplicate |
| 6 GET /accounts, /accounts/:id, /statement | 200 | PASS | 1 row; statement empty |
| 6 GET /accounts/:id/reconcile | 200 | PASS | ledger 0 = onchain 0, in_sync |
| 7 POST /transfers to zero address | 400 | PASS | VALIDATION, zero address rejected; GET /transfers still empty (200) |
| 8 no key / garbage key | 401 / 401 | PASS | UNAUTHORIZED / INVALID_API_KEY |
| 8 unknown account id, real key | 404 | PASS | NOT_FOUND |
| 9 GET /health | 200 | PASS | fingerprint unchanged aec2a8c13615 |
| 9 prod logs | - | BLOCKED | no railway CLI / log access in this environment |

Requests used: 31 of 40. Created: agent 5507f879-29f6-4192-b569-c6088847fcf5 (bank-smoke-20261128), 1 evm wallet, 1 bank account.
