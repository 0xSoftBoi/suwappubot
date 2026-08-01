# Suwappu Agent Control Plane — Integrator Guide

## 1. Overview

The control plane gates every fund-moving agent call (`/v1/agent/swap`, `/v1/agent/swap/execute`, `/v1/agent/execute`, MCP `execute_swap`) through a shared evaluator before a transaction is ever built or broadcast.

- **Policies** (`api-ts/src/db/schema/policies.ts`, evaluated by `api-ts/src/services/PolicyService.ts`) are per-org or per-agent rows with fields including: `maxTxUsd`, `maxSlippageBps`, `maxGasUsd`, `allowedChains`/`blockedChains`, `allowedTokens`/`blockedTokens`, `destinationAllowlist`, `allowedContracts`, `dailyCapUsd`, `sessionCapUsd`, `maxTxPerHour`, `requireApprovalAboveUsd`, `approvalMode` (`'above_limit'` default | `'always_ask'` | `'autonomous'`), `expiresAt`, `priority`, `enabled`.
- **Grants**: a policy row scoped to an org or a specific `agentId`; `expiresAt` makes it a time-boxed grant — expired rows are treated as not configured. `allowedContracts` restricts which router/contract addresses a trade may call into.
- **Kill switches** — three scopes (`global`, `org`, `agent`) in `policyKillSwitches`. Any active match short-circuits to `block`, checked before ordinary policy rows. Kill-switch reads fail **CLOSED** (DB unreadable → `block`), unlike ordinary policy reads, which fail **OPEN**.
- **Approval loop** — a `require_approval` verdict can mint a pending `agentApprovals` row, notified to the linked Telegram owner; the human approves/denies via inline buttons in the bot; the agent redeems the `approval_id` on retry.
- **Audit chain** — every non-`allow` decision (and every approval mint/redeem/reject/mismatch) writes an append-only, hash-chained row (`auditLogs.entryHash`/`prevHash`), verifiable via `GET /v1/agent/audit/verify`.

Two evaluation surfaces share one core (`runPolicyCheck` → `PolicyService.evaluate`):

- `enforcePolicy(c, agent, intent, approvalId?, forceReason?)` — Hono routes, returns a `Response` or `null`.
- `enforcePolicyForTool(agent, intent, approvalId?, forceReason?)` — MCP tool handlers, returns an MCP `{isError, content}` envelope or `null`.

Both in `api-ts/src/services/policyGate.ts`.

Unscoped requests (no `organizationId` and no `agentId`) are always `allow` — retail/no-org flows are outside the control plane entirely.

## 2. Response shapes: block (403) vs require_approval (202)

`error_code` is `POLICY_VIOLATION` for a fresh gate verdict; a rejected approval redemption returns `APPROVAL_INVALID`.

**Block (403):**

```json
{
  "success": false,
  "status": "block",
  "error": "Transaction blocked by org policy",
  "error_code": "POLICY_VIOLATION",
  "reason": "chain solana is blocked"
}
```

**Require approval, `AGENT_APPROVALS_ENABLED=true` (202):**

```json
{
  "success": false,
  "status": "require_approval",
  "error": "Transaction requires approval under org policy",
  "error_code": "POLICY_VIOLATION",
  "reason": "tx $1200.00 exceeds approval threshold $1000",
  "approval_id": "6f2b1c3a-...-uuid",
  "poll_url": "/v1/agent/approvals/6f2b1c3a-...-uuid",
  "expires_at": "2026-07-31T12:34:56.000Z"
}
```

If `AGENT_APPROVALS_ENABLED` is `false` or the approval insert fails, the body is identical minus `approval_id`/`poll_url`/`expires_at`.

**Invalid/reused/expired `approval_id` on retry (403):**

```json
{
  "success": false,
  "status": "blocked",
  "error": "Approval is invalid, expired, already used, or does not match this request",
  "error_code": "APPROVAL_INVALID",
  "reason": "already_consumed"
}
```

The MCP surface returns the same information as plain text inside `{isError: true, content: [...]}`.

## 3. Approval lifecycle

### Mint (on `require_approval`)

- `id`: `crypto.randomUUID()`.
- `expiresAt`: `now + 10 minutes` (hardcoded, not policy-configurable).
- `intentHash`: see binding rules below.
- `userTelegramId`: resolved by `resolveUserTelegramId` — prefers `agents.ownerUserId → users.telegramId` (set via `/link/code` + `/claim`), falling back to `organizations.ownerId → users.telegramId` when the request carries an `organizationId`. Null if neither resolves — the row is still created but nobody is notified.

### Human decides

Decided via Telegram inline buttons (`bot/handlers/approvals.py`). On decision or sweep-expiry, `bot/services/approval_webhook.py::notify_approval_decided` enqueues and fires the agent's callback webhook (§5).

### Redeem (retry with `approval_id`)

`redeemApproval` is only consulted when the fresh evaluation is `require_approval` — an ordinary `block` verdict is enforced first and never consults an approval. Checks, in order, with exact reason strings:

| Check | `reason` |
|---|---|
| row not found | `not_found` |
| `row.agentId !== intent.agentId` | `agent_mismatch` |
| already redeemed (`consumedAt` set) | `already_consumed` |
| `expiresAt` passed | `expired` |
| `status !== 'approved'` | `not_approved` (or `expired` if `status === 'expired'`) |
| intent hash mismatch | `intent_changed` |
| value above the approved band | `value_exceeds_approved` |
| lost the atomic-consume race | `already_consumed` |
| unclassified DB error | `approval_redemption_failed` (never leaks raw DB text) |

On success it atomically sets `consumedAt` via `UPDATE ... WHERE id = ? AND consumedAt IS NULL` — single-use and race-safe.

### Intent-hash binding — what's IN and what's OUT

`computeApprovalIntentHash` is a SHA-256 over a canonical, alphabetically-key-ordered JSON object built from exactly these fields (null/undefined omitted):

```
agentId, chain, contractAddress, destinationAddress, fromToken, toToken, walletAddress
```

**It deliberately excludes `amount`/`valueUsd`.** Quotes are TTL'd (~60s) but human approval takes minutes, so a redemption almost always carries a freshly re-quoted value for the same trade shape; binding the hash to the mint-time USD value would make approvals practically unredeemable.

- **Binds**: which agent, chain, token pair, router/contract, sending wallet, destination — i.e. *what trade this is*.
- **Does not bind**: the amount or its USD value — a fresh quote for the same shape is fine.

### The 5% value band

`isWithinValueBand(oldValueUsd, newValueUsd, bandPct = 0.05)` enforces `newValueUsd <= oldValueUsd * 1.05`. Only the **upper** bound is enforced — redeeming at a lower value always passes; more than 5% above what the human approved is rejected with `value_exceeds_approved`. This lets a re-quote through while blocking a larger trade swapped in against the same `approval_id`.

**Integrator guidance**: fetch a fresh quote before redeeming (don't reuse the original past its ~60s TTL). As long as `chain`/`fromToken`/`toToken`/`contractAddress`/`walletAddress`/`destinationAddress` match and the USD value isn't >5% higher, redemption succeeds.

## 4. Agent-owner linking

- `POST /v1/agent/link/code` mints a 16-hex-char (64-bit) one-time code, storing only its SHA-256 in `agent_link_codes` (`expiresAt = now + 10min`). Returns `{success, code, expires_at, instructions}`. The raw code is shown once and never persisted.
  - **409 anti-takeover guard**: if `agent.ownerUserId != null`, minting is refused (`error_code: CONFLICT`). Without this, a leaked bearer token could re-link an already-owned agent to an attacker's Telegram account and then self-approve its own spending. The current owner must `/unlink` first.
- `/claim <code>` in Telegram: re-hashes the code, does a guarded `UPDATE agent_link_codes SET used_at=... WHERE code_hash=? AND used_at IS NULL AND expires_at > now RETURNING agent_id`, then a guarded `UPDATE agents SET owner_user_id=? WHERE id=? AND owner_user_id IS NULL`. Both are race-safe; a second claim sees the agent already linked. Creates the `users` row if the Telegram identity is new.
- `/unlink [<name_or_id>]`: with no args lists your linked agents; with an arg clears `owner_user_id`, scoped to `owner_user_id = caller` so you can only unlink your own.

> **Two id spaces:** `agent_link_codes.agent_id` is an **integer FK to `agents.id`**, whereas `agent_approvals.agent_id` is the **string `agents.uuid`**. They are not interchangeable.

## 5. Webhook receiver guide (approval decisions)

Fired by `bot/services/approval_webhook.py::notify_approval_decided`, delivered and retried by `bot/services/webhook_dispatcher.py`.

**Payload:**

```json
{
  "event": "approval.decided",
  "approval_id": "6f2b1c3a-...",
  "status": "approved",
  "decided_at": "2026-07-31T12:00:00.000000+00:00",
  "intent_hash": "…sha256 hex…"
}
```

`status` is `approved`, `denied`, or `expired` (set by the expiry sweep).

**Headers:**

```
Content-Type: application/json
X-Suwappu-Timestamp: <unix seconds, string>
X-Suwappu-Signature: <hex hmac-sha256>
```

**Signature scheme:**

```
key_bytes = bytes.fromhex(api_key_hash)   # api_key_hash = sha256(your_api_key).hexdigest()
message   = f"{timestamp}.".encode("utf-8") + raw_body
signature = hmac_sha256(key_bytes, message).hexdigest()
```

`api_key_hash` equals `sha256(api_key)`, so your agent derives the key locally — it is never transmitted. `raw_body` must be the **exact bytes sent**: the sender serializes with `json.dumps(body, separators=(",", ":"))` (compact, no whitespace), so verify against those bytes, not a re-serialized copy.

**Replay window**: the timestamp is bound into the signature, but freshness is the receiver's responsibility — enforce ±5 minutes on `X-Suwappu-Timestamp`.

**Node.js / TypeScript verification:**

```ts
import crypto from 'crypto'

function verifySuwappuWebhook(
  rawBody: Buffer, // exact bytes received, unparsed
  timestampHeader: string,
  signatureHeader: string,
  apiKey: string,
): boolean {
  const now = Math.floor(Date.now() / 1000)
  const ts = parseInt(timestampHeader, 10)
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 5 * 60) return false // ±5 min

  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex')
  const keyBytes = Buffer.from(apiKeyHash, 'hex')
  const message = Buffer.concat([Buffer.from(`${timestampHeader}.`, 'utf-8'), rawBody])
  const expected = crypto.createHmac('sha256', keyBytes).update(message).digest('hex')

  const sigBuf = Buffer.from(signatureHeader, 'hex')
  const expBuf = Buffer.from(expected, 'hex')
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)
}
```

**Python verification:**

```python
import hashlib
import hmac
import time


def verify_suwappu_webhook(
    raw_body: bytes, timestamp_header: str, signature_header: str, api_key: str
) -> bool:
    now = int(time.time())
    try:
        ts = int(timestamp_header)
    except ValueError:
        return False
    if abs(now - ts) > 5 * 60:  # +/- 5 minute replay window
        return False

    api_key_hash = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
    key_bytes = bytes.fromhex(api_key_hash)
    message = f"{timestamp_header}.".encode("utf-8") + raw_body
    expected = hmac.new(key_bytes, message, hashlib.sha256).hexdigest()

    return hmac.compare_digest(expected, signature_header)
```

**Retry, backoff, dead-letter:**

- Delivery is enqueued durably in `agent_webhook_deliveries`, then one immediate best-effort POST is attempted inline. That inline attempt does **not** count against the cap.
- The dispatcher polls every 15s for `pending` rows whose `next_attempt_at` has passed.
- Backoff after each failed dispatcher attempt: **30s → 2m → 8m → 30m**; the 5th failure dead-letters (`status='failed'`). `MAX_ATTEMPTS = 5`.
- Each retry is **re-signed** with a fresh timestamp.
- `callback_url` is re-validated against the SSRF guard on every attempt: non-HTTPS (except localhost in non-prod) or a host resolving to a private/loopback/link-local/reserved/metadata IP is rejected.

## 6. Audit endpoints and hash-chain verification

- `GET /v1/agent/audit` — org-API-key callers see their own org's rows; plain agent-token callers see only their own agent's rows. Params: `event_type`, `agent_id` (org keys only), `since` (ISO), `limit` (1–500, default 100). Returns `{success, events: [{eventType, agentId, orgId, details, createdAt, entryHash}], count}`.
- `GET /v1/agent/audit/verify` — walks the caller's chain (`limit` 1–5000, default 1000) oldest→newest, recomputing `computeEntryHash({userId, orgId, agentId, eventType, details, ts, prevHash})` per row and checking linkage. Pre-migration rows with null hashes are skipped rather than flagged. Returns `{success, valid, checked, firstBreakId?}`.

Every non-`allow` policy decision, approval mint/redeem/reject, and kill-switch change is written through `writeAuditLog`/`auditLog` — this is the canonical compliance trail, not just swap outcomes.

## 7. Kill switches (org API key only)

- `POST /v1/agent/killswitch` — requires an org API key with the `admin` scope; a plain agent bearer gets `401 UNAUTHORIZED — Org API key required for kill-switch management`. Body: `{scope: 'org'|'agent', scope_id?, active: boolean, reason?}`. Org keys may only manage `scope: 'org'` for their own `orgId`; other scopes return `403 POLICY_VIOLATION`. `scope: 'global'` is not settable via this API (admin/bot only, via the `/ks` Telegram command).
- `GET /v1/agent/killswitch` — lists active switches visible to the caller: `global` plus the caller's own `org` scope.

## 8. Operational notes

- **`AGENT_APPROVALS_ENABLED`** (default `false`) gates whether a `require_approval` verdict mints an `approval_id` at all. The same flag on the Python side (`settings.agent_approvals_enabled`) gates both the approval notifier and the webhook dispatcher — **if it is off on the Python side, decisions are never delivered or retried even when api-ts mints approvals.** Keep both sides consistent.
- **Migration deploy order** — apply Drizzle migrations **0009 → 0013 before deploying the api-ts build that depends on them**. A missing column makes policy reads throw, and ordinary policy reads fail *open*, so the entire policy layer would be silently disabled in the gap between deploy and migrate. What each adds:
  - `0009` — policy grant fields (`approvalMode`, `expiresAt`, `allowedContracts`), nullable `organizationId`. (Also carries a pre-existing `swap_route_candidates` diff that predated this work.)
  - `0010` — `agent_approvals` (+ `consumed_at`).
  - `0011` — `audit_logs.prev_hash` / `entry_hash`.
  - `0012` — `agent_link_codes` + `agents.owner_user_id`.
  - `0013` — `agents.organization_id`.

  0012 and 0013 are written idempotently (`IF NOT EXISTS`, guarded FKs) because the Python stack creates overlapping objects at runtime via `database/db.py::_ensure_schema()`.
- **No passkey / step-up auth on the web path yet** — decisions are made exclusively via Telegram inline buttons. There is no webapp approve/deny or hardware-key step-up wired into `redeemApproval`.
- **Approvals need a linked human** — if `resolveUserTelegramId` returns null (no `owner_user_id`, no org owner), the approval is still minted but nobody is notified; it sits `pending` until it expires. Link the agent with `POST /v1/agent/link/code` + `/claim`.
- **Webhook 5-attempt cap** — after the 30s/2m/8m/30m retries fail, delivery is permanently dead-lettered. There is no operator endpoint to requeue a dead-lettered delivery today; poll `GET /v1/agent/approvals/:id` as the fallback source of truth.
- **10-minute TTLs are hardcoded** for both approval mints and link codes — not configurable per policy.
