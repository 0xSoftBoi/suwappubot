# INCIDENT: Managed-wallet swaps non-functional; agent wallet metadata forgeable

**Date:** 2026-09-25 (revised 2026-09-26)
**Severity:** Critical: no agent can execute a managed-wallet swap
**Status:** Code fixes on `hackathon/tokyo2026-trust-layer` (PR #1017). **Not merged, not deployed.** Prod config still needed (below).

Every claim below is labelled with its evidence:
- **[prod]** observed against production
- **[local]** reproduced locally against the branch code
- **[code]** read from source only

## Summary

The original report said "wallet creation is broken; existing managed-wallet agents are unaffected". The second half is wrong. Wallet creation is broken in prod, and **managed-wallet swap execution was broken for every agent, not only new ones**. Separately, server-trusted wallet keys in agent metadata could be forged by the agent. The forged keys reached the custodial signing path, but the same execution bugs very likely masked that.

## What was broken

### 1. Wallet creation: Turnkey not configured on prod api-ts [prod]
- `POST /v1/agent/wallets` returns `400 "Turnkey credentials not configured"`.
- `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY` and `TURNKEY_ORGANIZATION_ID` are unset on the api-ts Railway service.

### 2. `POST /v1/agent/swap/execute` could never succeed [code + local]
- **Missing engine object.** `api/routes/internal.py` imported a module-level `swap_engine` that doesn't exist, so every call returned 400 before reaching the engine.
- **Datetime mismatch.** After that import, a naive quote timestamp is compared with aware UTC, which fails on every call.
- **Wrong signing wallet.** `provision-wallet` ignored the agent's Turnkey wallet and minted a separate Python wallet. Even a working pipeline would have signed from an address the agent never saw or funded.
- **Unstable user ID.** The agent's User `telegram_id` came from Python's `hash()`, which is salted per process, so every restart provisioned a duplicate User. The range `0..2^31` also overlapped real Telegram user IDs.
- **Broken EIP-1559 signing.** Turnkey signing of typed (EIP-1559/2930) transactions imported a module that doesn't exist in `eth-account 0.13.7`. It also sent the 32-byte signing hash instead of the unsigned transaction. This affected **all** Turnkey wallets, not only agents.
- **Unsafe legacy signing.** The legacy Turnkey path defaulted a missing `chainId` to 1, which signs a replayable mainnet transaction. It also encoded hex-string fields incorrectly.

Not yet checked: prod logs, to confirm the 400s actually occurred for existing agents.

### 3. Self-signed `/swap` is documented but rejected [prod]
- `POST /v1/agent/swap` with a self-custody wallet returns `403 POLICY_VIOLATION`.
- `skills/suwappu/SKILL.md` documents that flow as the default.

## Security finding: forgeable wallet keys in agent metadata [code]

`/swap`, `/portfolio` and `/swap/execute` trust `metadata.wallet_address`, `internal_user_id` and `internal_wallet_id`. The agent could write those keys through:
- **`PATCH /v1/agent/me`**, which accepted arbitrary metadata;
- **`POST /v1/agent/register`**, which had no sanitization at all.

What that allowed:
- **On `/swap` (low impact):** a forged `wallet_address` skips a policy check. `/swap` returns unsigned transaction data, so it doesn't move funds by itself.
- **On `/swap/execute` (high impact):** forged `internal_*` IDs are forwarded to Python, which signs with that wallet's custodial key. The only ownership check was `wallet.user_id == user_id`, and both values came from the forged metadata. So in principle an agent could trigger swaps from another user's custodial wallet, bot users included.
- **Why it was very likely unexploitable in prod:** execution failed before signing (section 2).

Not proven: that no funds moved. Action: search prod logs for `/internal/agent/execute-swap` calls that reached `execute_swap`. Also look for agents whose `internal_wallet_id` is not an `agent_<uuid8>` Turnkey wallet; the backfill dry run lists these.

## Fixes (PR #1017, each commit tagged `[MONEY-PATH]` and money-path reviewed)
| Commit | Fix |
|---|---|
| `ab6c698`, `943d2d5` | Strip reserved wallet keys from `PATCH /me` while preserving the stored ones. Sanitize `/register`. |
| `dbf7f73` | Atomic jsonb metadata writes. Removes the lost-update race between `PATCH /me` and `/wallets`. |
| `bcd32d8`, `893ab03` | `execute-swap` binds `internal_*` IDs to the agent (full UUID, `agent_<uuid8>` rows, Turnkey provider). `/wallets` clears stale `internal_*` IDs. |
| `0649ad7` | Sign with the agent's own Turnkey wallet. Stable, negative sha256-derived user ID. Fix the `swap_engine` import and the timestamp. Remove unguarded duplicate routes from `main.py`. |
| `c00edb7`, `3bd5ab6` | Correct Turnkey serialization for typed and legacy transactions. Refuse to sign without `chainId`. |
| `c6b1774` | `bun run backfill:agent-wallets` re-points existing agents at their Turnkey wallet. Metadata SQL works whether the column is text, json or jsonb. |
| `df79584` | `POST /wallets` is idempotent and never rotates an existing wallet. |

## Still required
1. **Prod config.** Set the same `TURNKEY_*` keypair and org on **both** api-ts and python-api. Agent sub-orgs name the api-ts key as their root user. Then redeploy.
2. **Merge and deploy**, then check boot via `scripts/status.py` and the import-error log scan.
3. **Backfill.** Dry run, review the skipped list, then `--apply`.
4. **Live proof.** One small testnet or dust swap through a Turnkey wallet, confirmed on-chain. Until then, everything above is code-complete, not functionally verified.
5. **Product decision.** Either restore self-signed `/swap` (unsigned transactions only, `/swap/execute` stays managed-only) or go managed-only and update `SKILL.md`.
6. **Monitoring.** `/v1/agent/wallets` should return `503` rather than `400 VALIDATION_ERROR` when Turnkey is unconfigured, so alerts fire.

## Blast radius (corrected)
- **New agents:** cannot create wallets. [prod]
- **All agents:** managed-wallet `/swap/execute` fails. [code + local]
- **Self-custody agents:** `/swap` returns 403. [prod]
- **Telegram bot users with Turnkey wallets:** EIP-1559 signing fails, and it fails closed. [code] Which provider prod bot wallets use is not confirmed.
- **Quote and portfolio reads:** unaffected.
- **The $5 USDC dogfood wallet:** funds safe. Swaps are blocked until the fixes above are deployed.
