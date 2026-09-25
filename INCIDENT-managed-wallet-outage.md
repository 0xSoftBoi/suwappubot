# INCIDENT: Managed Wallet + Swap Execution Fully Blocked

**Date:** 2026-09-25
**Severity:** Critical — all money-moving API endpoints are non-functional
**Status:** Blocked on prod env config (requires founder action)

## Summary

Every swap path on `api.suwappu.bot` is currently dead. Wallet creation fails
(Turnkey not configured), and all swap endpoints require a managed wallet that
cannot be created. This is a complete outage of the agent swap API.

## Chain of failures

### 1. Wallet creation broken (root cause)
`POST /v1/agent/wallets` → `TurnkeyService.createAgentWallet()`
→ fails at `api-ts/src/services/TurnkeyService.ts:393`
→ `TURNKEY_API_PUBLIC_KEY`, `TURNKEY_API_PRIVATE_KEY`, `TURNKEY_ORGANIZATION_ID`
   are not set on prod api-ts
→ Returns `400: "Turnkey credentials not configured"`

### 2. All swap paths gated behind managed wallet
| Endpoint | Check | Result without managed wallet |
|----------|-------|-------------------------------|
| `POST /v1/agent/swap` | `checkEvmWalletOwnership` (agent.ts:1014) | `403 POLICY_VIOLATION` |
| `POST /v1/agent/swap/execute` | `WALLET_NOT_FOUND` (agent.ts:2535) | `400` |
| `POST /v1/agent/wallet/policy` | (agent.ts:3201) | `400` |
| `GET /v1/agent/wallet/policies` | (agent.ts:3246) | `400` |
| `DELETE /v1/agent/wallet/policy/:id` | (agent.ts:3270) | `400` |
| `GET /v1/agent/portfolio?wallet_address=` | (agent.ts:2329) | `403` |

### 3. Docs promise a flow that doesn't exist in code
`skills/suwappu/SKILL.md:104` documents:
> "### A. Self-signed (default, recommended for most agents)"
> `curl ... -d '{"quote_id":"...","wallet_address":"0xYourWallet"}'`

The code at `agent.ts:1014` rejects any `wallet_address` that isn't the agent's
managed wallet. The self-signed flow with an arbitrary wallet is not implemented.

## SECURITY FINDING: Ownership check is bypassable

`checkEvmWalletOwnership` (agent.ts:114-118) reads the "owned" address from
`agent.metadata.wallet_address`. However, `PATCH /v1/agent/me` (agent.ts:581)
accepts arbitrary `metadata` via `UpdateAgentSchema` (validators.ts:124-127),
which is `z.record(z.string(), z.unknown())` with no restrictions.

**Any agent can:**
1. `PATCH /v1/agent/me` with `{"metadata": {"wallet_address": "0xVictimAddress"}}`
2. `POST /v1/agent/swap` with that same address → passes ownership check

The managed-wallet policy enforcement is theater. It blocks legitimate use
(arbitrary self-custody wallets) while being trivially bypassable by anyone
who reads the code.

## Required fixes

### Immediate (founder action, cannot be done from here)
1. Set on prod api-ts (Railway):
   - `TURNKEY_API_PUBLIC_KEY`
   - `TURNKEY_API_PRIVATE_KEY`
   - `TURNKEY_ORGANIZATION_ID`
2. Redeploy api-ts

### Code fixes (can be done in repo)
1. **Fix `PATCH /v1/agent/me`**: Strip or reject `wallet_address` from user-supplied
   metadata. The managed wallet address must only be set by the `/v1/agent/wallets`
   endpoint after Turnkey provisioning. Suggested: add a denylist in `UpdateAgentSchema`
   or sanitize in the PATCH handler.
2. **Decide on self-signed policy**: Either
   - (a) Implement the documented self-signed flow (remove/relax the ownership check
     for `/v1/agent/swap`, keeping it for `/v1/agent/swap/execute`), OR
   - (b) Update `skills/suwappu/SKILL.md` to remove the self-signed section and
     document managed-only.
   Current state (docs say A, code enforces B, enforcement is bypassable) is the
   worst of all options.
3. **Add a health check**: `/v1/agent/wallets` should return `503` with a clear
   "wallet service unavailable" (not `400 VALIDATION_ERROR`) when Turnkey is not
   configured, so monitoring can alert on it.

## Blast radius
- All new agents: cannot create wallets, cannot swap
- Existing agents with managed wallets: unaffected (if any exist)
- Quote/portfolio-read paths: unaffected
- The $5 USDC dogfood wallet: funds safe, swap blocked pending fix

## Verification
- `POST /v1/agent/wallets` → `400 Turnkey credentials not configured` (2026-09-25)
- `POST /v1/agent/swap` with self-custody wallet → `403 POLICY_VIOLATION` (2026-09-25)
- Code references verified against `hackathon/tokyo2026` branch
