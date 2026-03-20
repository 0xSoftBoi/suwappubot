# Privy Evaluation — Wallet Infrastructure Comparison

**Status**: Proposed
**Date**: 2026-03-19
**Authors**: Engineering

## Context

Suwappu currently uses Turnkey for embedded wallet creation and management. Privy offers a bundled alternative (auth + wallets + payments). This evaluation compares both to determine if a migration or hybrid approach is worthwhile.

## Comparison Matrix

| Axis | Turnkey (current) | Privy |
|------|-------------------|-------|
| **Wallet creation** | Sub-org per user, TEE keys, export+backup | Embedded wallets, server-managed |
| **Auth** | Telegram initData → JWT (7-day) | Social login, passkeys, email OTP |
| **OAuth** | Custom `oauthIdentities` + Turnkey authenticators | Native providers (Google, Apple, Discord, etc.) |
| **x402** | Manual via `x402_service.py` | Native `useX402Fetch` hooks |
| **DeFi Earn** | Not available | Idle balance yield |
| **Multi-chain** | EVM + Solana (no TRON) | EVM + Solana |
| **Migration cost** | N/A | All wallets, auth middleware, DB schema |
| **Lock-in** | Moderate (standard key export) | Higher (bundles auth+wallet+payments) |
| **Pricing** | Per-wallet + per-signing operation | Per-MAU (monthly active user) |
| **Latency** | ~200ms wallet creation | TBD (spike required) |
| **Self-custody** | Full (TEE-backed, user-exportable) | Server-managed (Privy holds keys) |

## Key Files (Current Turnkey Integration)

- `api-ts/src/services/TurnkeyService.ts` — Wallet creation, signing, export
- `api-ts/src/middleware/flexAuth.ts` — Telegram + JWT auth flow
- `api-ts/src/db/schema/wallets.ts` — Wallet schema (address, encryptedKey, etc.)
- `api-ts/src/db/schema/oauth.ts` — OAuth identity schema
- `bot/utils/encryption.py` — KMS envelope encryption (kms_aesgcm_v2)

## Recommendation

**2-week spike** before any migration decision:

1. Add `POST /v1/agent/privy-test/wallet` endpoint using Privy SDK alongside Turnkey
2. Compare: wallet creation latency, signing latency, error rates
3. Test x402 payment flow with Privy's `useX402Fetch`
4. Evaluate UX for Telegram Mini App (does Privy's embedded wallet modal work inside Telegram WebView?)

### Decision Criteria

- **Proceed with migration** if: Privy latency is ≤ Turnkey, x402 hooks save >100 LOC, and Telegram WebView works cleanly
- **Stay with Turnkey** if: Privy wallet modal breaks in Telegram WebView, or self-custody requirements block server-managed keys
- **Hybrid approach** if: Privy auth is better but Turnkey wallets are preferred — use Privy for social login only, keep Turnkey for key management

### Migration Scope (if approved)

1. Auth middleware (`flexAuth.ts`) — swap Telegram initData validation for Privy session
2. Wallet service (`TurnkeyService.ts`) — replace with Privy embedded wallet SDK
3. DB schema — migrate wallet records, preserve addresses
4. Encryption — Privy handles key storage, remove `kms_aesgcm_v2` for new wallets
5. x402 service — replace manual verification with Privy hooks

**No full migration until spike validates.** Estimated migration effort: 3-4 weeks if spike is positive.
