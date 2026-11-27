# Suwappu Bank live run (local PostgreSQL + forked Base)

## What is real vs local

- Real: api-ts server booted from source (`bun run src/index.ts`) against local PostgreSQL 16 (`suwappu_drizzle_first`, port 5433), migrations applied with `drizzle-kit migrate` (0034 included; journal at id 35). All HTTP calls go through the real Hono routes (`/webapp/bank/*`, `/v1/agent/bank/*`) with real auth middleware, no bypass flags.
- Auth: webapp requests carry `X-Telegram-Init-Data` signed by `lib.ts` with a throwaway `TELEGRAM_BOT_TOKEN` exactly as `TelegramAuthService` verifies it (HMAC WebAppData, 5 min max age, fresh per request). Agent via real `POST /v1/agent/register` (bearer `suwappu_sk_*`).
- Local: chain is a Hardhat 2 node forking Base mainnet (chainId 8453, RPC `https://mainnet.base.org`, reached through the sandbox proxy), listening on :8545 and wired in via `BASE_RPC_URL`. foundry/anvil could not be installed (github.com release download blocked by egress policy, 403), so Hardhat was used instead. The bank asset registry is hardcoded (`services/bank/assets.ts`), so the real Base USDC contract at 0x8335...2913 is used and balances are injected with `hardhat_setStorageAt` (mapping slot 9) plus `hardhat_setBalance` for gas.
- Local: signer. Turnkey has no credentials here, so signing falls through `withSigningFallback` to `PYTHON_API_URL/internal/sign-transaction`. The Python service cannot run here (no fastapi), so `signer.ts` is a stand-in that signs EIP-1559 txs with throwaway keys keyed by `wallets.id`. Wallet rows (users, wallets with `wallet_provider='turnkey'`, fake sub-org id) are inserted directly in SQL because the Python provisioning path is unavailable.
- Setup scripts live in `/tmp/claude-0/-home-user-suwappubot/56f114d7-35df-54d5-b0c2-8208538647f9/scratchpad/live/` (env.sh, lib.ts, signer.ts, hh/).

## Status

| Step | Result | Notes |
|---|---|---|
| 3a accounts, statement, concurrent sync-deposit | PASS | 4 concurrent syncs over 2 accounts of one wallet: one credit of 100000000 (one deposit transfer, ledger net 0). 200s. |
| 3b A to B transfer, receipt-verified, 5x idempotent replay | PASS | submitted (ledger debit A/credit clearing) then confirmed by reconciler only after 10 confirmations (Base depth; local chain needed evm_mine x12, expected behaviour). 5 concurrent same-key: 1 row, 1 tx; different body same key: 409 CONFLICT. All transfers net 0. |
| 3c 10 concurrent transfers, nonce, reconcile | PASS | 10 distinct tx hashes, wallet nonce 12 (consecutive), 10 confirmed; ledger 79000000 = onchain 79000000; reconcile in_sync delta 0; no unbalanced transfer. |
| 3d overdraft, bad recipients, cross-owner 4xx | NOT RUN | |
| 3e kill -9 mid-flight and pre-broadcast | NOT RUN | |
| 3f holds block and release | NOT RUN | |
| 3g invoice / payroll / stream / remittance / org approval / FX | NOT RUN | |
| 3h jobs run, two instances no double tick | NOT RUN | |
| 4 check:openapi, bun run check | NOT RUN | |

## Bugs found

None yet.
