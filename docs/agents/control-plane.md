# Suwappu Agent Control Plane — Integrator Guide

> This document describes the control plane as actually shipped on this branch
> (`feat/agent-control-plane-v2`). An earlier version of this file described a
> superseded design (`agent_approvals` table, intent-hash + 5% value band,
> `/webapp/approvals` endpoints) — that design was replaced by the
> `approval_requests` payload-hash flow documented below. Do not conflate the
> two; the old table/fields no longer exist in this branch's schema.

## 1. Overview

The control plane gates fund-moving agent calls (`POST /v1/agent/swap`,
`POST /v1/agent/swap/execute`, and the MCP `execute_swap` tool) through a
shared evaluator, `PolicyService.evaluate()`, before any transaction is built
or broadcast. Read-only MCP tools (quotes, portfolio, prices, etc.) are **not**
policy-gated — only `execute_swap`.

- **Policies** (`api-ts/src/db/schema/policies.ts`, `policies` table,
  evaluated by `api-ts/src/services/PolicyService.ts`) are rows scoped to an
  org (`organizationId`), optionally further narrowed to one agent
  (`agentId` set), **or** scoped to a bare agent with no org at all
  (`organizationId` null, `agentId` set — a plain agent-token/MCP-auth
  request with no org API key). Fields: `maxTxUsd`, `maxSlippageBps`,
  `maxGasUsd`, `dailyCapUsd`, `sessionCapUsd`, `maxTxPerHour`,
  `allowedChains`/`blockedChains`, `allowedTokens`/`blockedTokens`,
  `destinationAllowlist`, `allowedContracts` (router/contract allowlist —
  without a matched `contractAddress` on the intent this gate enforces
  nothing), `requireApprovalAboveUsd`, `approvalMode`
  (`'above_limit'` default | `'always_ask'` | `'autonomous'`), `expiresAt`
  (time-boxed grant — an expired policy is skipped entirely), `priority`
  (lower wins first), `enabled`.
- **Kill switches** — `policy_kill_switches`, three scopes: `global`, `org`,
  `agent`. Any active match short-circuits to `block`, checked before
  ordinary policy rows. **Kill-switch reads fail CLOSED** (DB unreadable →
  `block`); ordinary policy reads fail **OPEN** (DB unreadable → `allow`,
  logged) — see §8 for why this matters for migration ordering.
- **Approval loop** — a `require_approval` verdict inserts a pending
  `approval_requests` row. The resolved human owner (see §3's owner
  resolution) approves/denies it; the agent then re-submits the *original*
  request with `approval_id` set.
- **Audit chain** — `audit_logs`, hash-chained (`entryHash`/`prevHash`),
  append-only. Every non-`allow` policy decision, approval
  create/approve/deny, link/unlink, and kill-switch change writes a row.
  Verifiable via `GET /v1/agent/audit/verify`.

Enforcement strength is honest-by-design: server-side evaluation at the
swap-build step is **hard** enforcement for the KMS-custodial signing path and
for agents holding a Suwappu-issued API key (we hold the credential). For a
self-signing EOA that builds and signs entirely client-side, it is
**advisory** — nothing stops that caller from bypassing our API. See the
schema-file docstring in `policies.ts` for the same caveat in code.

## 2. The gate call sites

`enforcePolicyGateForFreshQuote(c, agentIdentifier, orgId, quote, isSolana, walletAddress)`
in `api-ts/src/routes/agent.ts` is the single shared implementation, used by:

- `POST /v1/agent/swap` (quote_id path)
- `POST /v1/agent/swap/execute` (custodial sign+broadcast path)
- MCP `execute_swap` (via `routes/mcp.ts`'s `policyGateResponseToMcpEnvelope`,
  which converts the same `Response` into the MCP `{isError, content}`
  envelope)

**Known gap — org-less MCP/agent-token calls currently skip the gate
entirely.** `enforcePolicyGateForFreshQuote` returns `null` (no evaluation at
all) immediately when `orgId` is falsy (`if (!orgId) return null`, ~line
1135 of `agent.ts`). `PolicyService.evaluate()` itself *does* support
org-less per-agent policy rows (`organizationId` null, `agentId` set — see
its own doc comment), but no call site currently passes such a request
through to it, because the gate bails before ever calling `evaluate()` for a
request with no org context. In practice this means org-less per-agent
policies are stored and readable but not yet enforced on any live path. This
is flagged here rather than asserted as working — verify against the current
`agent.ts` source before relying on it.

`orgId` for the REST routes comes from `apiKeyCtx.orgId` (org API key auth).
For MCP `execute_swap` it comes from `agent.organizationId` (the agent's own
`agents.organization_id`, set independently of any API key) — see
`routes/mcp.ts::handleExecuteSwap`.

## 3. Approval lifecycle

### 3.1 Create (`PolicyService.evaluate()` → `require_approval` → `ApprovalService.create()`)

When the policy verdict is `require_approval`, `agent.ts` persists the
**re-quotable economic terms** (chain, tokens, amounts, wallet, min-out — NOT
a `quote_id`, since the ~60s quote-cache TTL is far shorter than the approval
window and is per-process) into `approval_requests`
(`api-ts/src/db/schema/approvals.ts`), then returns `202`:

```json
{
  "success": false,
  "status": "pending",
  "error": "Transaction requires approval under org policy",
  "reason": "tx $1200.00 exceeds approval threshold $1000",
  "approval_id": "6f2b1c3a-...-uuid",
  "expires_at": "2026-08-02T12:49:56.000Z",
  "hint": "Poll GET /v1/agent/approvals/:id until status is \"approved\", then re-submit with approval_id set (quote_id not required — the trade is re-quoted server-side)."
}
```

Solana quotes carry no USD value at this layer (`termsFromSolanaQuote`
hard-codes `valueUsd=0`), so an approved Solana trade would silently bypass
USD-based caps — the gate refuses Solana `require_approval` outright with a
`403` rather than creating an unpriced approval.

**Owner resolution (`ApprovalService.create()`,
`api-ts/src/services/ApprovalService.ts`)** — the human who may later
approve/deny is written into `approval_requests.user_id`:

1. If an org context exists, the caller (`agent.ts`, lines ~1253–1266) has
   already resolved `organizations.ownerId` for `orgId` and passes it in as
   `input.userId`. **This order is preserved and is never overridden** — an
   org's owner always wins over anything agent-specific.
2. If `input.userId` is `null` (no org context, or the org lookup itself came
   back empty), `create()` falls back to the *agent's own* linked owner:
   `agents.owner_user_id` (`api-ts/src/services/ApprovalService.ts:161-183`,
   matched against `agents.uuid` or, for pre-uuid agents, `agents.id::text`
   — the two identifier spaces `agentIdentifierOf()` can produce).
3. If neither resolves, `user_id` is `null` as before — the request is still
   created (never blocks execution on this failure) but nobody can approve
   it via the owner-scoped endpoints below (they filter on `user_id`); it
   sits `pending` until it expires.

The fallback lookup is wrapped so any DB error degrades to step 3's null
behavior rather than ever failing approval creation.

### 3.2 Owner approves/denies

```
POST /v1/agent/approvals/:id/approve
POST /v1/agent/approvals/:id/deny
```

Auth: `flexAuth()` — JWT bearer (`Authorization: Bearer <jwt>`, HS256 only)
or the `suwappu_auth` session cookie, or Telegram `X-Telegram-Init-Data`.
**Never an agent key** — an agent must never be able to self-approve. Also
rate-limited per-user (`rateLimit()`) and per-IP (`ipRateLimit(30)`).

`ApprovalService.decide(id, userId, outcome)` does an ownership check
(`approval_requests` inner-joined to `organizations` on `organizations.ownerId
= userId`) then a race-safe conditional `UPDATE ... WHERE status='pending' AND
expires_at > now()`, so a duplicate click or retry can only ever win once.

**Confirmed gap**: `decide()` and `listForOwner()`
(`api-ts/src/services/ApprovalService.ts`) both resolve ownership via an
inner join `approval_requests → organizations ON organizations.ownerId =
userId` — org-owner-only. An approval whose `user_id` was resolved via the
§3.1 step-2 fallback (`agents.owner_user_id`, `organizationId IS NULL`) has
no `organizationId` for that join to match, so it will never appear in
`listForOwner()` and `decide()` will 403 with "not found for your
organizations" even for the correct owner. **The §3.1 fallback makes
`user_id` non-null (so the row isn't silently unapprovable-by-design), but
`decide()`/`listForOwner()` need a matching org-less lookup path
(`eq(approvalRequests.userId, userId)` when `organizationId IS NULL`) before
an org-less agent's owner can actually act on it end-to-end. That follow-up
is not part of this change.**

Success (`approve`):

```json
{
  "success": true,
  "approval_id": "6f2b1c3a-...",
  "status": "approved",
  "decided_at": "2026-08-02T12:41:02.000Z",
  "hint": "The agent must re-submit the original request with approval_id set to execute it."
}
```

If `APPROVAL_STEP_UP_REQUIRED='true'` (env, default `'false'`), `approve`
additionally requires a body `{ "step_up_challenge": "<hex>" }` obtained from
`POST /v1/agent/approvals/:id/step-up/challenge` (flexAuth, owner-only, mints
a single-use nonce that expires after 2 minutes — see §4). A missing or
rejected challenge returns:

```json
{ "success": false, "code": "STEP_UP_REQUIRED", "error": "step_up_challenge is required" }
```

`deny` has no step-up path — denial never requires it.

### 3.3 Agent polls

```
GET /v1/agent/approvals/:id
```

Auth: `agentBearerAuth()` (the agent's own key). Returns `403` if the id
belongs to a different agent. If still `pending` and past `expires_at`, the
response lazily reflects `status: "expired"` without writing it (the
authoritative expiry check happens again at decide/consume time).

### 3.4 Agent re-submits (`validateForExecution` → build tx → `finalizeConsume`)

The agent re-submits the **original** `POST /v1/agent/swap` or
`POST /v1/agent/swap/execute` request with `approval_id` set (no `quote_id`
needed). `resolveApprovalResubmit()` in `agent.ts`:

1. Loads the approval (`getForAgent` — 403 if agent mismatch).
2. If not yet `approved`, returns `202` (still `pending`) or `400`
   (`denied`/`expired`/`consumed`) with `{status: <current status>}`.
3. **Re-quotes server-side** from the stored terms — never trusts a
   client-supplied quote at this step.
4. `ApprovalService.validateForExecution(id, agentId, organizationId,
   freshTerms)` checks, in order: agent match; org match (an org-scoped
   approval can only be consumed presenting the *same* org context —
   an org-less resubmit against an org-scoped approval is always rejected);
   `status === 'approved'`; not expired; **payload-hash match** of the core
   (immutable) terms — `hashCoreTerms()` is a SHA-256 over canonical JSON of
   everything in the payload *except* `amountOutMin` and `valueUsd` (those
   two are checked separately, not by equality); and finally
   `freshAmountOutMin >= approvedAmountOutMin` — **the fresh price may never
   be worse than what the human approved**; a re-quote at a *better* price
   always passes.
5. `PolicyService.evaluate()` is re-run unconditionally — a valid approval
   only satisfies a `require_approval` verdict; a `block` verdict (including
   a kill switch flipped on after the approval was minted) still `403`s.
6. If the re-evaluation reserves cap allowance
   (`PolicyService.reserveApprovalAllowance`), that reservation happens
   **before** the transaction is built, inside one DB transaction serialized
   by a per-org advisory lock — this closes the TOCTOU where two concurrent
   approved resubmits could both read the pre-insert cap sum and jointly
   exceed it. If the build subsequently fails, the caller **must** call
   `releaseApprovalAllowance(reserve)` to roll the reservation back (only the
   call that created it may release it — a partial unique index on
   `policy_decisions(approval_id)` gives at-most-once insertion regardless).
7. **Only after the transaction is successfully built** does the caller call
   `ApprovalService.finalizeConsume(id)`, which flips `'approved' →
   'consumed'` via a conditional `UPDATE ... WHERE status='approved'` — a
   concurrent re-submit racing the same approval can only ever win once. A
   build that fails after consumption would burn the approval for nothing,
   which is exactly why consumption is ordered last.

The 15-minute approval TTL is `ApprovalService.APPROVAL_TTL_MS` (hardcoded,
not policy-configurable).

## 4. Step-up: what it is and is NOT

`POST /v1/agent/approvals/:id/step-up/challenge` (flexAuth, owner-only)
issues a random 24-byte hex nonce (`approval_step_up_challenges` table),
single-use, expiring after 2 minutes, scoped to the caller's ownership of
that specific pending approval (mirrors `decide()`'s pre-check so a caller
with no access never even learns whether a challenge row exists).
`decideApproveWithStepUp()` validates + consumes it atomically alongside the
approval-status flip, in one `db.transaction`.

**This is a server-issued re-confirmation nonce for the approve action — not
WebAuthn/passkey/hardware-key step-up.** It proves the same authenticated
session made two round-trips within 2 minutes; it does not add a second
authentication factor. Gated entirely off by default
(`APPROVAL_STEP_UP_REQUIRED` env, default `'false'`). Treat it as
brute-force/replay hardening on the approve click, not as MFA.

## 5. Agent ↔ owner linking

```
POST /v1/agent/link/code    (agent key auth, agentFlexAuth())
```

Mints a 16-hex-char one-time code (`randomBytes(8)`), stores only its SHA-256
in `agent_link_codes` (`api-ts/src/db/schema/agentLinkCodes.ts`),
`expiresAt = now + 10min`. Returns `{success, code, expires_at,
instructions}` — the raw code is shown once, never persisted.

**409 anti-takeover guard**: if `agent.ownerUserId != null`, minting is
refused —

```json
{ "success": false, "error": "Agent is already linked to an owner. Ask the owner to /unlink first." }
```

Without this, a leaked bearer token could re-link an already-owned agent to
an attacker's Telegram account, who could then approve that agent's own
future spend as its "owner." The current owner must `/unlink` first.

```
/claim <code>     (Telegram, bot/handlers/claim_agent.py)
/unlink [name_or_id]
```

`/claim` re-hashes the code, does a guarded
`UPDATE agent_link_codes SET used_at=... WHERE code_hash=? AND used_at IS
NULL AND expires_at > now() RETURNING agent_id`, then a guarded
`UPDATE agents SET owner_user_id=? WHERE id=? AND owner_user_id IS NULL` —
both race-safe; a second claim attempt on the same code, or a code pointing
at an already-linked agent, fails cleanly. Creates a `users` row if the
Telegram identity is new. `/unlink` with no args lists the caller's linked
agents; with a name/id it clears `owner_user_id`, scoped to
`owner_user_id = caller` so an owner can only unlink their own agents.

> **Two id spaces**: `agent_link_codes.agent_id` is an **integer FK to
> `agents.id`**, whereas `approval_requests.agent_id` is the **string
> `agents.uuid`** (or, for pre-uuid agents, `agents.id` stringified — see
> `agentIdentifierOf()`). They are not interchangeable; `ApprovalService`'s
> owner-fallback lookup (§3.1) explicitly matches on both forms.

## 6. Webhooks (approval decisions)

Fired by `bot/services/approval_webhook.py::notify_approval_decided` when an
`approval_requests` row is decided or swept as expired; delivered/retried by
`bot/services/webhook_dispatcher.py`. Delivery target is the agent's
`agents.callback_url`.

**Payload** (`body_dict` in `approval_webhook.py`):

```json
{
  "event": "approval.decided",
  "approval_id": "6f2b1c3a-...",
  "status": "approved",
  "decided_at": "2026-08-02T12:41:02.000000+00:00",
  "payload_hash": "…sha256 hex of the approval's core economic terms…"
}
```

`status` is `approved`, `denied`, or `expired`. `payload_hash` is
`approval_requests.payload_hash` (the same `hashCoreTerms()` value used at
resubmit-time validation) — a receiver can confirm the decision refers to
the exact trade shape it expects.

**Headers:**

```
Content-Type: application/json
X-Suwappu-Timestamp: <unix seconds, string>
X-Suwappu-Signature: <hex hmac-sha256>
```

**Signature scheme** (`sign_payload()` in `approval_webhook.py`):

```
key_bytes = bytes.fromhex(api_key_hash)      # api_key_hash = agents.api_key_hash = sha256(api_key).hexdigest()
message   = f"{timestamp}.".encode("utf-8") + raw_body
signature = hmac_sha256(key_bytes, message).hexdigest()
```

`raw_body` is the **exact bytes sent** — the sender serializes with
`json.dumps(body, separators=(",", ":"))` (compact, no whitespace); verify
against those exact bytes, not a re-serialized copy. `api_key_hash` is a
value the agent can already compute locally (`sha256(its own api_key)`), so
the shared secret is never transmitted over the webhook itself.

**Recommended replay window**: ±5 minutes on `X-Suwappu-Timestamp` (the
sender does not enforce this — it is the receiver's responsibility).

**Node.js verification:**

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

**Retry / backoff / dead-letter** (`bot/services/webhook_dispatcher.py`):

- Delivery is enqueued durably in `agent_webhook_deliveries` first, then one
  immediate best-effort POST is attempted inline (does not count against the
  retry cap).
- The dispatcher polls every **15s** (`CHECK_INTERVAL_SECONDS`) for `pending`
  rows whose `next_attempt_at` has passed (or is `NULL`).
- Backoff schedule after each failed retry attempt:
  **30s → 2m → 8m → 30m → 2h** (`BACKOFF_SCHEDULE_SECONDS = [30, 120, 480,
  1800, 7200]`). `MAX_ATTEMPTS = 5` retryable failures; the 6th total attempt
  failing dead-letters the row (`status='failed'`) with no further retry.
- Each retry attempt is re-signed with a fresh timestamp.
- `callback_url` is re-checked against the SSRF guard (`is_callback_url_safe`)
  on every attempt: requires `https` (plain `http` allowed only for
  localhost-ish hosts outside production), and rejects if *any* resolved
  address is private/loopback/link-local/reserved or the cloud metadata IP
  `169.254.169.254` — defends against DNS rebinding, not just a static
  scheme check.
- There is no operator endpoint to requeue a dead-lettered delivery; poll
  `GET /v1/agent/approvals/:id` as the fallback source of truth.

## 7. Audit trail

`api-ts/src/services/audit.ts` — every insert computes `entryHash =
sha256(canonical JSON of {userId, orgId, agentId, eventType, details, ts,
prevHash})`, chained per-org; a shared `'global'` chain covers org-less
entries. Reads for the previous hash + the insert happen inside one
transaction guarded by a Postgres advisory lock keyed on the chain, so two
concurrent writers to the same chain can never both read the same
`prevHash`.

**Agent/API-key-scoped reads** (existing, `agentFlexAuth()`):

- `GET /v1/agent/audit` — an org API key sees its own org's rows; a plain
  agent bearer token sees only its own agent's rows (org-less/global chain).
  Params: `event_type`, `agent_id` (org-key callers only), `since` (ISO),
  `limit` (1–500, default 100). Returns `{success, events: [{eventType,
  agentId, orgId, details, createdAt, entryHash}], count}`.
- `GET /v1/agent/audit/verify` — walks the caller's chain (`limit` 1–5000,
  default 1000) oldest→newest, recomputing `computeEntryHash(...)` per row
  and checking linkage against `prevHash`. Rows written before the hash-chain
  migration (`entryHash IS NULL AND prevHash IS NULL`) are skipped rather
  than flagged as a break. Returns `{success, valid, checked, firstBreakId?}`.

**Owner-scoped (JWT/session) reads** — added on this branch for the human
owner acting through the web dashboard, with no API key
(`api-ts/src/routes/agent.ts`, `resolveOwnerAuditOrgId()`):

- `GET /v1/agent/owner/audit`
- `GET /v1/agent/owner/audit/verify`

Auth: `flexAuth()`. Both accept an optional `?org_id=` — if given, the
caller's ownership (`organizations.ownerId = authUser.userId`) is verified or
the request is rejected with `403`; if omitted, the caller's own
first-owned org (by `createdAt`) is used, and a caller who owns zero
organizations gets a `404` rather than silently falling back to the
org-less global chain (a human owner asking "show me my org's audit trail"
should never be answered with someone else's org-less agent activity).
`owner/audit` accepts the same `event_type`/`agent_id`/`since`/`limit`
params as the agent-key surface and returns `{success, org_id, events,
count}`; `owner/audit/verify` returns `{success, org_id, valid, checked,
firstBreakId?}`.

## 8. Kill switches

- `POST /v1/agent/killswitch` — **org API key with `admin` scope only**
  (`apiKeyAuth()` + `requireScope('admin')`); a plain agent bearer gets `401
  UNAUTHORIZED`. Body: `{scope: 'org'|'agent', scope_id?, active: boolean,
  reason?: string}`. An org key may only manage `scope: 'org'` for its own
  `orgId` — other scopes are rejected. `scope: 'global'` is **not** settable
  via this API at all; it is bot/admin-only, via the Telegram `/ks` command.
- `GET /v1/agent/killswitch` — org API key only; lists active switches
  visible to the caller: `global` plus the caller's own `org` scope.

## 9. Operational notes

- **`AGENT_APPROVALS_ENABLED`** gates the **Python side only** — the
  `bot/services/approval_notifier.py` notifier and
  `bot/services/webhook_dispatcher.py` dispatcher. It does not gate anything
  in api-ts; `ApprovalService.create()` always inserts a pending row when
  `PolicyService` returns `require_approval`. If this flag is off on the
  Python side, approval requests are still created and can still be
  approved/denied via the JWT endpoints in §3.2 — they simply never get a
  Telegram notification or an outbound webhook delivery. Keep both sides'
  expectations aligned when toggling it.
- **Migration deploy order** — apply Drizzle migrations **0013 → 0015 before
  deploying the api-ts build that depends on them**:
  - `0013_brown_cerise` — `policies.organization_id` made nullable (org-less
    per-agent policies), `agents.organization_id`, `policies.approval_mode` /
    `expires_at` / `allowed_contracts`.
  - `0014_complete_wolfsbane` — `audit_logs.prev_hash` / `entry_hash` (the
    hash chain columns).
  - `0015_square_hitman` — `agent_link_codes`, `approval_step_up_challenges`,
    `agents.owner_user_id`.

  This matters because **ordinary policy reads fail open**: if the api-ts
  build queries a column that migration hasn't added yet, the read throws,
  and a thrown policy read is treated as an infra hiccup and resolved to
  `allow` (logged, but not blocked) rather than `block` — so a missed
  migration doesn't loudly break policy enforcement, it *silently disables*
  it for the gap between deploy and migrate. Kill-switch reads are the one
  exception (fail closed), so a missing `policy_kill_switches` column/table
  would at least block rather than bypass.

  `0015` uses `IF NOT EXISTS`/guarded FKs because the Python stack can create
  overlapping objects at runtime via `database/db.py::_ensure_schema()`.

## 10. Known limitations (verify before relying on)

- **Org-less policy enforcement is not wired end-to-end** — see §2. Policy
  rows can be created with `organizationId=null, agentId=<id>`, and
  `PolicyService.evaluate()` supports evaluating them, but no live call site
  currently reaches that branch for a request that has no org context at
  all.
- **Owner-approval of an org-less agent's request does not work yet** — see
  §3.1/§3.2. The owner-resolution fallback added on this branch sets
  `approval_requests.user_id` correctly for an org-less agent, but
  `decide()`/`listForOwner()` only match rows through an `organizations`
  join, so that owner still cannot see or act on the request via
  `GET /v1/agent/approvals` or `POST .../approve`/`.../deny` today. Treat
  the fallback as "the row now points at the right human" rather than "the
  human can now approve it" until `decide()`/`listForOwner()` gain an
  org-less lookup path.
- **Step-up is not MFA** — see §4. Don't market it as hardware/passkey
  step-up in customer-facing copy.
- **No dead-letter requeue endpoint** — see §6.
- **15-minute approval TTL and 10-minute link-code TTL are hardcoded**, not
  per-policy configurable.
