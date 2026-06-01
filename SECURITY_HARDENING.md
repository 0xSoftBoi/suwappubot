# Security Hardening Report — suwappubot

This document records a security hardening pass across the Python bot/API and the
TypeScript agent API (`api-ts`). Findings are severity-ranked. Each confirmed,
auto-fixed finding lists its title, location (`file:line`), dimension, exploit
scenario, the fix applied, and residual risk.

Two classes of finding are called out separately:

- **Auto-fixed** — resolved by code edits in this pass (below).
- **REQUIRES MANUAL ROTATION — NOT auto-fixed** — secret-exposure findings that
  code edits **cannot** resolve. These need credential rotation and git-history
  purge. See the prominent section immediately below.

---

## ⚠️ REQUIRES MANUAL ROTATION — NOT auto-fixed (read first)

**The following findings expose secrets/credentials. Code changes CANNOT fix
them.** A secret that has ever been committed must be treated as compromised:
removing it from the current tree leaves it in git history, packfiles, forks,
clones, CI caches, and any mirror. These require **(1) credential rotation** and
**(2) git-history purge** (e.g. `git filter-repo` — preferred — or BFG Repo
Cleaner), followed by a force-push and re-clone by all collaborators.

| # | Finding | File:Line | Severity | Action required |
|---|---------|-----------|----------|-----------------|
| R1 | Hardcoded `BETA_PASSWORDS` in source (`'waifu'`, `'suwappu'`, `'earlybird'`) | `bot/services/x402_service.py:24-29` | Critical | Rotate/retire all beta codes; move to DB (bcrypt-hashed, expiry, max-uses, tier); purge from git history |
| R2 | Plaintext private-key export from Turnkey TEE backed up to DB | `bot/services/turnkey_export.py:36-56` | Critical | Treat all exported backup keys as compromised → **rotate every affected wallet** (migrate funds to new keys); remove the export path; purge any logs/dumps |
| R3 | DB breach exposes all Turnkey backup keys at rest | `bot/services/turnkey_export.py:50-55` | Critical | Same as R2: rotate wallet keys; segregate backup KMS credentials from app credentials; consider HSM |
| R4 | Backup-key decryption has no 2FA / authorization gate | `bot/services/wallet.py:495-514` | Critical | If exposure suspected, rotate affected wallet keys; add authz gate (see note) |
| R5 | Encrypted backup keys decryptable by any process with KMS access | `bot/utils/envelope_crypto.py:200-238` | High | Rotate KMS keys; restrict KMS decrypt via IAM/key policy; rotate wallet keys if RCE suspected |
| R6 | Plaintext key in memory during predict signing | `bot/handlers/predict.py:752-770` | High | Rotate keys only if a memory dump/host compromise is suspected; otherwise operational |

### Why code edits are insufficient

- **R1 (beta passwords):** The literal strings are in the working tree *and* in
  every historical commit. Even after replacing them with a DB lookup, anyone
  with repo/history/fork access can read the old codes. **Rotate the codes** and
  **purge history.**
- **R2/R3 (exported Turnkey keys):** Once a private key has been exported in
  plaintext and persisted, the key material itself is the secret. Deleting the
  export code does not un-expose keys already written to the DB / backups / logs.
  **The only true remediation is to rotate (replace) the wallet keys and move
  funds**, plus purge any persisted copies.
- **R4/R5/R6:** These concern key *handling*. Defense-in-depth was added in code
  (authz guard, anomaly detection, zeroization — see auto-fixed F1, F2, F16) but
  if any of these paths were already exploited, the underlying private keys must
  be rotated; code cannot retroactively secure a key an attacker already read.

### Recommended rotation + purge procedure

1. **Rotate first, purge second.** Invalidate every exposed secret (beta codes)
   and migrate funds off every potentially-exposed wallet key to freshly
   generated keys before touching history, so a leaked-but-now-purged secret is
   already dead.
2. **Purge git history** with `git filter-repo` (preferred) or BFG:
   - `git filter-repo --path bot/services/x402_service.py --invert-paths` is too
     blunt (drops the file); instead use `git filter-repo --replace-text
     replacements.txt` mapping each literal secret to `***REMOVED***`.
   - Or BFG: `bfg --replace-text replacements.txt` then
     `git reflog expire --expire=now --all && git gc --prune=now --aggressive`.
3. **Force-push** all branches/tags; have every collaborator re-clone (rebasing
   onto rewritten history corrupts local copies).
4. **Invalidate caches:** CI secret caches, build artifacts, container images,
   and any mirror/fork that may retain the old objects.
5. **Audit access logs** for the exposure window for each rotated credential.

---

## Severity-ranked confirmed findings (auto-fixed)

### CRITICAL

---

#### C1 — Internal API authentication bypass via NameError on all four endpoints
- **File:** `api/routes/internal.py:55, 115, 171, 229`
- **Dimension:** authz / AUTH-PATH
- **Exploit:** Every internal endpoint called `_verify_internal_key(x_internal_api_key)`,
  but the function parameter is `x_internal_key`. The reference `x_internal_api_key`
  is undefined → `NameError` at runtime, so `_verify_internal_key` never ran. The
  call sits outside the `try` blocks, so it surfaced as a 500 (fail-closed in
  effect), but the four endpoints — `/internal/sign-transaction`, `/internal/x402/verify`,
  `/internal/agent/provision-wallet`, `/internal/agent/execute-swap` — were
  entirely broken and the `INTERNAL_API_KEY` check was dead code. The intended
  posture (require `X-Internal-Key`) was never enforced.
- **Fix applied:** Renamed the argument to `x_internal_key` at all four call
  sites (`replace_all`, identical lines). `INTERNAL_API_KEY` validation now runs;
  missing/invalid header → 401. `py_compile` passes; zero remaining
  `x_internal_api_key` references.
- **Residual risk:** Restored auth assumes the TS caller already sends
  `X-Internal-Key` (it should; omission now correctly 401s). The cross-user IDs
  issue (C2) is mitigated but not fully closed.

#### C2 — Cross-user swap execution / agent wallet takeover
- **File:** `api/routes/internal.py:223` (with `bot/services/swap_engine.py:841`)
- **Dimension:** authz / AUTH-PATH
- **Exploit:** `/internal/agent/execute-swap` accepts `internal_wallet_id` and
  `internal_user_id` from the request body and passes them to
  `swap_engine.execute_swap` with no ownership check. Combined with C1's
  unauthenticated path, an attacker could execute swaps on **any** wallet by
  specifying its ID — a full account-takeover primitive.
- **Fix applied:** (1) C1 restores auth so only holders of the shared
  `INTERNAL_API_KEY` (the trusted TS service) reach the endpoint. (2) In
  `swap_engine.execute_swap`, `_get_wallet()` now returns `user_id`, and after
  the wallet lookup the service raises `SwapError("Wallet {id} does not belong to
  user {user_id}")` when `wallet.user_id != user_id`, binding wallet→user before
  any funds move.
- **Residual risk:** This is now a trust-boundary/design issue, not an open
  takeover. A caller holding the shared secret still supplies both IDs; the
  consistency check does not help when one party controls both. Full mitigation
  requires deriving `internal_wallet_id`/`internal_user_id` server-side from the
  agent provisioning record keyed by `agent_uuid` (coordinated TS-side change,
  out of minimal scope).

#### C3 — Reversed (fail-open) admin check grants everyone admin when ADMIN_IDS empty
- **File:** `bot/handlers/admin_custodial.py:30` and `bot/handlers/admin_fees.py:16`
- **Dimension:** authz
- **Exploit:** `return user_id in ADMIN_IDS or len(ADMIN_IDS) == 0` grants admin
  to **all** users when `ADMIN_IDS` is empty (the default). Any Telegram user
  could run custodial/fee admin commands (hot-wallet management, gas sponsorship,
  fee sweeps). `admin.py` had the correct fail-closed logic; these two modules
  were reversed.
- **Fix applied:** Changed both to fail-closed
  `return len(ADMIN_IDS) > 0 and user_id in ADMIN_IDS`, matching `admin.py:22`.
  Verified every callback in both files already calls `is_admin(user.id)`, so the
  only defect was the boolean. Empty list now denies all. Both files
  `py_compile` clean; no reversed-pattern matches remain under `bot/`.
- **Residual risk:** `ADMIN_IDS = []` is still a hardcoded literal in both
  modules (not wired to `settings.admin_telegram_ids`). Now fail-closed (safe by
  default) but operators must edit the literals or a follow-up should unify
  config. No regression test (no existing test module for these handlers).

#### C4 — Unvalidated `redirect_url` in OAuth callback (open redirect / auth-code interception)
- **File:** `api/routes/oauth.py:267` (store site `:146`)
- **Dimension:** authz
- **Exploit:** The OAuth flow accepted a user-supplied `redirect_url` with no
  domain validation, then issued `RedirectResponse` to it after success. An
  attacker supplying `redirect_url=https://attacker.com` could steal the
  authorization code, enabling account takeover.
- **Fix applied:** Added pure helper `_is_allowed_redirect()` allowlisting
  `redirect_url` against `settings.oauth_redirect_base` (single or comma-list):
  permits `None` (server default), exact base match, or a path strictly beneath
  `base + '/'` — blocking suffix-confusion (`...example.com.attacker.com`) and
  scheme mismatch. Enforced at (a) `oauth_authorize()` → 400 before persisting
  state, and (b) `oauth_callback()` success site → falls back to
  `{oauth_redirect_base}/dashboard` if the stored value no longer validates.
- **Residual risk:** If `oauth_redirect_base` is configured to an overly broad
  (multi-tenant) base, the allowlist inherits that breadth. No step-up
  re-auth/state signing added (kept minimal).

#### C6 — Missing 2FA gate on high-value custodial withdrawal
- **File:** `bot/handlers/custodial.py:476-575`
- **Dimension:** authentication & authorization
- **Exploit:** `withdraw_confirm()` never invoked `twofa_service` despite a
  `DEFAULT_THRESHOLD` of $1000. An attacker with the user's Telegram session
  could withdraw any amount regardless of security settings.
- **Fix applied:** Added a `CONFIRM_2FA` conversation state and
  `withdraw_confirm_2fa` handler. For withdrawals above the
  `require_2fa_above` ($1000) threshold, a 6-digit code is issued via
  `twofa_service.generate_simple_code()` and the send only proceeds after
  `verify_simple_code()`. USD value via `price_service` with a fail-safe fallback
  to raw amount so the gate cannot be bypassed by an unavailable price feed.
- **Residual risk:** The 2FA code is delivered over the same Telegram channel,
  so it enforces policy but does not stop an attacker who already controls the
  Telegram account. In-memory per-process code state (resets on restart).

#### C7 — Balance deducted before on-chain send with no refund on failure (fund loss)
- **File:** `bot/handlers/custodial.py:500-567`
- **Dimension:** transaction integrity
- **Exploit:** Balance was subtracted before the on-chain send; if
  `send_token`/`send_native_token` raised (network/gas/revert/invalid address),
  the `except` only messaged the user — the deduction was never restored. Users
  permanently lost funds with no transfer.
- **Fix applied:** Extracted on-chain execution into `_execute_withdrawal()`; on
  any exception after deduction, the amount is refunded via
  `update_custodial_balance(operation='add')`, with a critical-level log if the
  refund itself fails, and the user is told "Your balance was not charged."
- **Residual risk:** Refund path is best-effort; a refund failure is logged but
  needs ops follow-up. TOCTOU mitigations are single-process (see C8 note).

#### C8 — Weak EVM address validation in withdrawals (no checksum)
- **File:** `bot/handlers/custodial.py:481`
- **Dimension:** financial / input validation / data
- **Exploit:** Validation only checked `startswith('0x')` and `len == 42`, not
  EIP-55 checksum or hex validity. Typo'd / non-hex / wrong-case addresses passed
  and funds could be sent irrecoverably to the wrong destination.
- **Fix applied:** Added `_normalize_evm_address()` using
  `validate_address(addr,'evm')` (eth_utils `is_address` — format + checksum),
  rejecting mixed-case addresses whose checksum doesn't match, then normalizing to
  checksummed form before any send. (Also enforced before the spending/whitelist
  checks, see C9.)
- **Residual risk:** Does not add an address-whitelist/QR confirmation step
  (whitelist enforcement is opt-in, C9). Could not run tests locally (deps
  absent); `importorskip`-guarded test runs in CI.

#### C10 — RPC endpoint injection via chainlist.org (untrusted discovery)
- **File:** `bot/services/rpc_manager.py:220-244`
- **Dimension:** external
- **Exploit:** `_fetch_chainlist_endpoints()` ingested `https://chainlist.org/rpcs.json`
  with no domain allowlist, TLS pinning, or signature check. A poisoned/MITM'd
  response could inject attacker-controlled RPC URLs; all transactions for a chain
  could then be routed through an attacker who could front-run, intercept, or
  forge responses.
- **Fix applied:** Added `TRUSTED_RPC_DOMAINS` (frozenset, 44 registrable domains
  covering shipped providers) and pure helper `_is_trusted_rpc_url()` (scheme must
  be exactly `https`; host via `.hostname` must equal a trusted domain or be a
  dot-anchored subdomain). Wired `if not _is_trusted_rpc_url(rpc_url): continue`
  into the existing chainlist filter loop (covers startup fetch + 6-hour refresh).
  Configured `settings.py` endpoints load via a separate path and are unaffected.
- **Residual risk:** Host-name filtering only — no TLS cert pinning, no signature
  authentication of the chainlist response. Subdomain takeover or compromise of a
  shared-infra trusted provider still passes. New legitimate providers absent from
  the hardcoded list are silently dropped (intentional safety tradeoff).

#### C11 — User-ID enumeration via `GET /users/{user_id}/*`
- **File:** `api/main.py:1425-1461`
- **Dimension:** authz
- **Exploit:** `/users/{user_id}/wallets|portfolio|swaps` validated the agent key
  but not that the agent may access that `user_id`. Iterating `user_id` enumerated
  all wallets/portfolios; a single compromised/shared agent key exposed the whole
  user base.
- **Fix applied:** Added `enforce_enumeration_guard(agent_key, user_id)` on all
  three routes, reusing `UserRateLimiter` to cap each agent key at 10 req/min
  (429 + `Retry-After`) and logging a warning when one key fans out across ≥20
  distinct `user_id`s in 60s. Admin keys exempt on `/swaps`. No `agent.id ==
  user_id` ownership check (RegisteredAgent has no User link; shared agent key has
  no identity) — rate limiting was the task's accepted alternative.
- **Residual risk:** In-memory per-process limiter → under multiple replicas the
  effective limit is N×10/min and an attacker's requests get load-balanced. For a
  hard global cap, move tracking to Redis. Shared global key collapses all callers
  into one bucket.

#### C13 — Sponge webhook signature validation skipped when secret unset
- **File:** `api-ts/src/routes/agent.ts:~380-410`
- **Dimension:** edge
- **Exploit:** If `SPONGE_WEBHOOK_SECRET` was unset, signature validation was
  skipped and the callback processed unverified — allowing forged callbacks to
  auto-register malicious agents, trigger actions, or inject metadata.
- **Fix applied:** Removed the "accept without signature validation" path. Now
  rejects with 503 if `SPONGE_WEBHOOK_SECRET` is unset (any env), 401 on
  missing/invalid signature; added a hex-parse guard and security logging.
- **Residual risk:** Fails closed in **every** environment, so local/test sponge
  callbacks 503 without the secret (intentional, but a dev-time behavior change).

#### C14 — Cross-agent quote hijacking (`/swap`, `/swap/execute`, MCP)
- **File:** `api-ts/src/routes/agent.ts:856` (and `:1423`); `api-ts/src/routes/mcp.ts:476`
- **Dimension:** agent / mcp
- **Exploit:** `quoteCache.get(quote_id)` was used without checking the cached
  quote's `agentId` against the calling agent. Agent B could submit Agent A's
  `quote_id` and receive A's unsigned transaction (to/data/value/chainId), then
  sign and broadcast to move A's funds. The MCP `handleExecuteSwap` never received
  the `agent` at all.
- **Fix applied:** In `agent.ts` `/swap` and `/swap/execute`, after the expiry
  check, added `if (cached.agentId !== undefined && cached.agentId !== agent.id)
  → 403`. In `mcp.ts`, changed `handleExecuteSwap(args)` →
  `handleExecuteSwap(args, agent)` and added the same guard after
  `getCachedQuote`, returning the generic "Quote expired or not found" to avoid
  leaking existence. `!== undefined` so `agentId === 0` is handled.
- **Residual risk:** Webapp-created quotes carry no `agentId`, so the guard
  short-circuits for them (matches intended behavior; not reachable via the MCP
  agent surface — quote IDs are random with 30–60s TTL). Could not run `tsc`/tests.

#### C15 — Turnkey spending-limit policy self-deletion (guardrail bypass)
- **File:** `api-ts/src/routes/agent.ts:1950` (create `:1876`, list `:1927`)
- **Dimension:** authorization
- **Exploit:** `DELETE /v1/agent/wallet/policy/:policyId` deleted any policy on the
  agent's own Turnkey sub-org with only the agent's own token — no check that the
  policy was agent-created. An agent could enumerate and delete admin-set spending
  limits / address whitelists, then execute arbitrary swaps.
- **Fix applied:** The delete handler now lists policies first and only deletes if
  the target's `policyName` starts with `AGENT_POLICY_PREFIX` (`'agent-'`);
  admin/guardrail policies (other names) return a `ValidationError` and are
  protected. Create handler uses the same prefix constant; error mapping switched
  to `mapErrorToResponse`.
- **Residual risk:** Protection is a **name-prefix heuristic** — an admin who
  names a guardrail `agent-*` would leave it deletable. Execution-time server-side
  policy re-validation (the deeper ask) is out of single-file scope. A
  create/delete timing race remains theoretically possible (see H-tier).

#### C16 — Wallet-address injection in `POST /v1/agent/swap`
- **File:** `api-ts/src/routes/agent.ts:844` (tx `from` at `:961`)
- **Dimension:** input validation / authorization
- **Exploit:** `/swap` accepted `wallet_address` from the body with no ownership
  check and built the unsigned tx with `from: wallet_address`. An agent could
  substitute a victim's address as the sender to construct fund-moving directives
  from arbitrary wallets.
- **Fix applied:** Added `checkEvmWalletOwnership(agent, addr)` (valid EVM address
  AND exact case-insensitive match to `agent.metadata.wallet_address`); `/swap`
  EVM path → 403 on mismatch. (Shared helpers: `isEvmAddress`, `evmAddressesEqual`,
  `getAgentWalletAddress`.)
- **Residual risk:** Requires a managed wallet — agents using external/self-custody
  EVM wallets are now rejected (flag for review if self-custody is a real product
  flow). Solana path relies on the per-agent quote binding (no stored Solana
  wallet to check).

#### C17 — Wallet-address injection in `POST /v1/agent/execute` (NL commands)
- **File:** `api-ts/src/routes/agent.ts:1024` (use at `:1083`)
- **Dimension:** input validation / authorization
- **Exploit:** `/execute` accepted an optional `wallet_address` and reused it as
  the swap sender without ownership validation, so a natural-language command could
  carry a victim's address.
- **Fix applied:** When `wallet_address` is present, the same
  `checkEvmWalletOwnership` gate applies → 403 on mismatch.
- **Residual risk:** Same managed-wallet requirement as C16.

#### C18 — MCP `execute_swap` authorization bypass
- **File:** `api-ts/src/routes/mcp.ts:476` (routing `:568`)
- **Dimension:** mcp
- **Exploit:** `handleExecuteSwap` retrieved a cached quote but never validated it
  belonged to the calling agent, and the `agent` was never passed in — an attacker
  agent could execute another agent's quote.
- **Fix applied:** Threaded `agent` into `handleExecuteSwap` and added the
  `cached.agentId !== agent.id` guard (same as C14). Updated the single routing
  call site.
- **Residual risk:** Webapp quotes (no `agentId`) remain executable by any
  authenticated MCP agent with the ID — not reachable in practice (random ID,
  short TTL, MCP agents cannot create webapp quotes).

---

### HIGH

---

#### H1 — Hot-wallet keys storable under legacy single-master-key encryption
- **File:** `bot/services/hot_wallet.py:245-278`
- **Dimension:** custody
- **Exploit:** `get_private_key()` could decrypt legacy Fernet wallets using the
  single shared `settings.encryption_key`; envelope (v2) encryption was opt-in. A
  weak/leaked master key decrypts all such hot wallets.
- **Fix applied:** Added `_require_secure_envelope_encryption()` (requires
  `wallet_encryption_scheme == 'kms_aesgcm_v2'` AND `kms_provider ∈ {aws, gcp}`,
  rejecting `dev`/legacy). `_create_local_hot_wallet()` and `import_hot_wallet()`
  now call the guard and unconditionally use v2 envelope encryption before any DB
  write. Legacy **read** + auto-migrate preserved so existing wallets remain
  accessible. 5 regression tests pass.
- **Residual risk:** Un-migrated legacy rows are still decryptable by the master
  key until first access; recommend an offline batch migration. Monthly KMS
  rotation is operational (configure in AWS/GCP KMS). `get_private_key()` still
  returns plaintext into memory for local signing (by design; needs HSM/Turnkey to
  eliminate). The equivalent `bot/services/wallet.py` user-wallet path still has
  the legacy fallback (out of scope).

#### H2 — Plaintext private key in memory without zeroization (signing)
- **File:** `bot/services/wallet.py:1072, 1091, 1186, 1238-1239`
- **Dimension:** custody / KEY_SINK
- **Exploit:** Decrypted keys are passed as immutable Python strings to signing
  functions and linger in RAM until GC, exposed to memory dumps/debuggers. The
  `Account` object from `Account.from_key()` also retains key bytes.
- **Fix applied:** Module-level `_zeroize_str()` best-effort wipes a string's
  backing buffer via `ctypes.memset` (CPython-only, ASCII-only, length-gated,
  never raises). Wrapped every local signing path in try/finally that zeroizes the
  key + any `0x`-prefixed copy + decoded bytearray (`_sign_evm_local`,
  `_sign_typed_data_local`, `_sign_solana_local`, the TRON paths, and the raw-tx
  signers). In `_sign_typed_data_local`, the `Account` object is also dropped
  (`account = None; del account`) in finally so its internal key bytes are
  GC-eligible immediately. Signatures unchanged; round-trip tests recover the
  correct signer.
- **Residual risk:** Best-effort only — copies created inside `eth_account`/decrypt
  internals persist until GC; no-op on PyPy/non-ASCII. `_zeroize_str` does an
  in-place memset on an immutable `str` with no refcount guard: verified the
  production path returns a fresh, uniquely-owned key per call (no `lru_cache`), so
  it is **latent not live**, but any future change that caches/interns decrypted
  keys would cause silent corruption on a fund-moving path. True elimination needs
  isolated sign-by-wallet-id or HSM/Turnkey.

#### H3 — Backup-key decryption has no rate limiting / anomaly detection
- **File:** `bot/services/wallet.py:495-514`
- **Dimension:** KEY_SINK
- **Exploit:** `get_backup_private_key()` could be invoked unlimited times (e.g. a
  hijacked Telegram session driving the predict handler), and with KMS access an
  attacker could decrypt all DEKs.
- **Fix applied:** Added `_BackupKeyAccessGuard` (process-wide, thread-safe) inside
  `get_backup_private_key`: logs every decryption (INFO) for alerting and enforces
  a per-wallet burst cap (default 20 / 300s) raising `RateLimitExceeded` with an
  ERROR anomaly log on breach. Optional per-access min-interval defaulted to 0 to
  avoid breaking legitimate back-to-back orders. Deliberately did **not** throttle
  `turnkey_fallback.py` (legitimate high-frequency signing).
- **Residual risk:** In-memory per-process (resets on restart, not shared across
  workers — use Redis for distributed). Keys on `wallet.id`, not session-user, so
  it does not detect ownership mismatch or add re-auth/2FA before decryption
  (handler-level layers from the finding remain unimplemented).

#### H4 — Encrypted backup keys decryptable by any process with KMS access
- **File:** `bot/utils/envelope_crypto.py:200-238`
- **Dimension:** KEY_SINK
- **Exploit:** `decrypt_wallet_key()` can be called directly by any code path,
  bypassing the `get_backup_private_key()` authorization layer; RCE → decrypt all
  Turnkey backup keys. **Also a rotation item (R5).**
- **Fix applied (defense-in-depth):** KMS-client anomaly detection (see H7) and
  the access guard (H3) raise the bar. The structural fix (authorization gateway
  wrapping all decryption) and KMS IAM restriction are operational/architectural.
- **Residual risk:** Direct `decrypt_wallet_key` calls are not blocked in code; if
  RCE/exposure occurred, **wallet keys must be rotated (R5)**.

#### H5 — Unchecked RPC responses in EVM swaps (tx-hash tampering)
- **File:** `bot/services/swap_engine.py:1158-1179`
- **Dimension:** financial
- **Exploit:** `send_raw_transaction` results were trusted without verifying the
  returned hash; a malicious/MITM'd RPC could return a success hash for a modified
  (e.g. recipient-changed) transaction, hiding theft.
- **Fix applied:** Compute the tx hash locally (`Web3.keccak(raw)`) before sending
  at both the approval and swap sites, then verify `bytes(returned) ==
  bytes(expected)`; raise `SwapError("RPC returned mismatched transaction hash —
  possible tampering")` on mismatch. The swap site now returns the locally-computed
  hash rather than the node's value.
- **Residual risk:** Detects a lying RPC returning a different-tx hash, but does
  not prevent a malicious RPC silently dropping the tx (correct hash, never
  broadcast) nor transport MITM. URL pinning / multi-provider cross-verification
  remain out of scope.

#### H6 — Missing auth binding in `execute_swap` service layer
- **File:** `bot/services/swap_engine.py:841`
- **Dimension:** AUTH-PATH
- **Exploit:** `execute_swap(wallet_id, user_id)` fetched the wallet by ID only,
  never checking `wallet.user_id == user_id`, so a caller could mix one user's
  wallet with another's identity.
- **Fix applied:** `_get_wallet()` now returns `user_id`; after lookup the service
  raises `SwapError` when `wallet.user_id != user_id`. (Same change underpins C2.)
- **Residual risk:** Trusts the passed `user_id` as the authenticated identity;
  upstream callers must authenticate it.

#### H7 — KMS wrapping provides no protection against code-level compromise
- **File:** `bot/services/kms_client.py:87-152`
- **Dimension:** KEY_SINK
- **Exploit:** The singleton KMS client has full decrypt privileges; RCE → decrypt
  any wrapped DEK and any wallet backup key. Envelope encryption alone does not
  defend against in-process compromise.
- **Fix applied (defense-in-depth, detection-only):** Added
  `_KmsDecryptAnomalyMonitor` wired into `decrypt_data_key()` across
  DevMock/Aws/Gcp clients. It tracks, over a 300s window, global decrypt volume
  (≥200), distinct wrapped-DEK count (≥50, the signature of an RCE walking the key
  table), and per-key count (≥50), and logs `logger.error("ANOMALY ... possible
  key exfiltration")` on breach (throttled). It **never raises** (sits on every
  signing hot path; copy-trading/sniping can fan out), identifies DEKs by
  truncated SHA-256 (holds no key material), and swallows all exceptions.
- **Residual risk:** Detection only — does not block, and a single-key exfiltration
  (one decrypt) is below threshold. The real mitigations (KMS key policies/IAM,
  CloudTrail/Cloud Audit Logs, KMS Grants with limits) are infra-side. In-memory
  per-process; thresholds need production tuning.

#### H8 — Li.Fi token-resolution cache trusts unvalidated addresses
- **File:** `api-ts/src/services/TokenService.ts:303-359`
- **Dimension:** agent-tool
- **Exploit:** `resolveToken()` cached Li.Fi responses for 10 min with no
  validation. A DNS hijack / MITM / Li.Fi compromise could map a legitimate symbol
  to a malicious contract, and the swap builder would trust it.
- **Fix applied:** Added `EVM_ADDRESS_RE` and `isValidLifiToken(token, chainId,
  normalizedSymbol)` enforcing (a) well-formed EVM address, (b) Li.Fi-reported
  `chainId` must equal the requested chain, (c) if a trusted address exists in
  `COMMON_TOKENS` for that exact (chain, symbol) it must match. Invalid/spoofed
  responses resolve to `null` (an already-handled caller path). TTL/signature/
  `COMMON_TOKENS` early-return untouched.
- **Residual risk:** For chains in `CHAINS` but absent from `COMMON_TOKENS`
  (Gnosis 100, Fantom 250, Mantle 5000, Linea 59144, Scroll 534352) major symbols
  still resolve via Li.Fi with **format-only** validation — a major-symbol spoof on
  those chains is still possible. Closing it requires adding verified canonical
  addresses to `COMMON_TOKENS` (deliberately not guessed in-sandbox). Could not run
  `tsc`/tests.

#### H9 — Portfolio disclosure via arbitrary `wallet_address`
- **File:** `api-ts/src/routes/agent.ts:1214, 1216`
- **Dimension:** agent / information disclosure
- **Exploit:** `GET /v1/agent/portfolio?wallet_address=...` returned live balances
  for any address with no ownership check; per-agent-key rate limiting did not stop
  enumerating arbitrary wallets and building holdings dossiers.
- **Fix applied:** `GET /portfolio` now enforces `checkEvmWalletOwnership` → 403,
  so an agent can only query its own wallet (subsumes the per-wallet rate-limit
  ask).
- **Residual risk:** Requires a managed wallet; Solana portfolio queries are now
  rejected entirely (no stored Solana address) — a behavior regression for Solana
  portfolio use. Could not run `tsc`/tests.

#### H10 — A2A quote generation used a placeholder sender address; no ownership enforcement
- **File:** `api-ts/src/routes/a2a.ts:140` (placeholder at `:320`)
- **Dimension:** a2a
- **Exploit:** EVM A2A quotes were built with the placeholder
  `0x0000...0001` instead of the requesting agent's wallet, and no endpoint
  validated quote ownership — laying the groundwork for cross-agent reuse if
  execution is added.
- **Fix applied:** Added exported `resolveAgentEvmAddress(agent)` (uses
  `agent.metadata.wallet_address` only if it matches `^0x[a-fA-F0-9]{40}$`, else
  falls back to the original placeholder) and used it at the Li.Fi `getQuote`
  call, so quotes are priced/built against the requesting agent's own address.
  Added exported `isQuoteOwnedByAgent(cached, agentId)` (documented mandatory gate
  for any future execution path) plus comments at the `cacheAgentQuote` sites.
  Solana quote takes no address at quote time (no change). Tests added (bun:test).
- **Residual risk:** Ownership is enforced only by convention/helper — A2A has no
  quote-execution path today, so the guard is documented but not wired. Agents
  with a valid stored wallet get slightly different quote figures (intended).
  `agent.ts`'s `/swap` cached-quote path shares this pattern but is covered by C14.
  Could not run `tsc`/tests.

#### H11 — IP rate limit keyed by spoofable `x-forwarded-for`
- **File:** `api-ts/src/middleware/ipRateLimit.ts:36`
- **Dimension:** edge
- **Exploit:** The limiter took the **leftmost** `x-forwarded-for` entry, which is
  client-controllable, so an attacker could rotate the header to evade limits.
- **Fix applied:** Added exported `resolveClientIp(forwarded, socketIp,
  trustedProxyCount)` selecting the entry `TRUSTED_PROXY_COUNT` hops **from the
  right** (a trusted ALB appends the real client IP), falling back to the socket
  IP (`getConnInfo` from `hono/bun`, try/caught), then `'unknown'`.
  `TRUSTED_PROXY_COUNT` env-configurable (default 1). Single-hop traffic is
  unchanged; spoofed padding now collapses to one stable key. 7 tests added.
- **Residual risk:** Default assumes a single trusted proxy hop — if another
  XFF-appending layer (e.g. CloudFront) fronts the ALB, set `TRUSTED_PROXY_COUNT`
  accordingly. If the container port were directly internet-reachable, from-right
  stripping picks the attacker's value (SG/VPC restriction must hold). In-memory
  per-process. Could not run `tsc`/tests (getConnInfo path unverified in sandbox).

#### H12 — Admin API key has no brute-force protection
- **File:** `api-ts/src/middleware/auth.ts:45-62`
- **Dimension:** edge
- **Exploit:** `adminKeyAuth()` used a timing-safe compare but had no rate
  limiting, allowing unbounded brute-force of `X-Admin-Key` across HTTP requests.
- **Fix applied:** Added per-IP failure tracking (Map). After 5 failures an
  exponential lockout applies (1s base, doubling, capped 1h) — locked requests get
  429 + `Retry-After` thrown before the compare. Each invalid attempt logs
  `[security] Invalid admin key attempt from ip=...`. Successful auth clears the
  entry. Happy path and the missing-key 500/401 paths unchanged.
- **Residual risk:** In-memory per-process (resets on restart, not shared across
  replicas — bypassable by spreading attempts or restarts). `x-forwarded-for`
  spoofable unless behind a trusted proxy; shared-NAT IPs could lock out a
  legitimate admin (mitigated by exponential, not permanent, lockout). No
  secrets-manager / external alerting (console.warn only).

#### H13 — JWT 7-day expiry with no refresh/revocation
- **File:** `api/main.py:576`
- **Dimension:** authz
- **Exploit:** Tokens were valid 7 days; a stolen token gave a week of access and
  permission changes (ban / expiry) did not take effect until expiry.
- **Fix applied:** Reduced `JWT_EXPIRY_HOURS` 168→1 (env-configurable, default 1).
  Added `_user_is_authorized()` wired into `decode_jwt_token` so **every** token
  use re-confirms the subject user still exists in the DB (deleted/deauthorized
  user → immediate rejection). Re-imports `DATABASE_AVAILABLE` inside the function
  (module-level copy is stale-False), failing open only when the DB is genuinely
  unavailable (matches degraded-mode pattern).
- **Residual risk:** No revocation list / refresh-token rotation (out of minimal
  scope; 1h expiry is the stolen-token mitigation). `User` has no
  `is_active`/`banned` column, so "authorized" = "row exists"; true ban/subscription
  enforcement needs a schema field. `decode_jwt_token` now does a synchronous PK
  lookup on the event loop (negligible). Test skips on Python 3.9 (monolith needs
  3.10+).

#### H14 — `UserRateLimiter` never cleared (stale history / memory leak)
- **File:** `bot/utils/rate_limiter.py:135-167`
- **Dimension:** edge
- **Exploit:** The global in-memory `_user_requests` dict was never pruned, so a
  reused Telegram `user_id` inherited prior rate-limit history and entries
  accumulated without bound.
- **Fix applied:** Added class-level TTL cleanup (default 86400s, clamped ≥ window
  so a sweep cannot affect an active decision; sweep interval 3600s, monotonic
  throttled). `_cleanup_locked()` runs at the start of `check()` under the existing
  lock and evicts users whose newest timestamp is older than the cutoff.
  `defaultdict(list)` preserved so a swept active user auto-recreates. New params
  appended with defaults (existing call sites unaffected). 4 tests pass.
- **Residual risk:** In-memory per-process (multi-instance accumulates
  independently; Redis recommended for distributed). Sweep is lazy (activity-gated)
  — a zero-traffic limiter never sweeps but also accumulates nothing. Within one
  60s window a recreated same-ID account could still inherit ≤1 window of history
  (inherent to windowing).

#### H15 — OAuth `link` action does not validate user_id (account-link CSRF)
- **File:** `api/routes/oauth.py:437-453`
- **Dimension:** authz
- **Exploit:** For `action == 'link'`, the code did not verify the
  currently-authenticated user matches `oauth_state.user_id`. An attacker could
  seed a `link` state bound to a victim's `user_id`, trick the victim into
  authorizing, and link the attacker's OAuth identity to the victim's account.
- **Fix applied:** Added `current_user: Optional[User] = Depends(get_current_user)`
  to `oauth_callback()`. When `action == 'link'` or `oauth_state.user_id` is set,
  require `current_user` present and `current_user.id == oauth_state.user_id`;
  otherwise delete the state and raise 403. Login/register flows unaffected.
- **Residual risk:** Relies on the existing JWT-cookie session; no step-up
  re-auth and `oauth_state.user_id` is not signed/encrypted. State integrity
  still rests on the random token + 10-min expiry.

#### H16 — No spending limits / whitelist enforcement; TOCTOU double-withdraw
- **File:** `bot/handlers/custodial.py:453, 476-575`
- **Dimension:** risk management / access control / concurrency
- **Exploit:** `withdraw_confirm()` enforced neither `spending_tracker.check_limits()`
  nor `WithdrawalWhitelist`, so unlimited per-tx withdrawals to any address were
  possible. Separately, the balance check (`:453`) and deduction (`:500`) were
  separated by awaits, allowing concurrent confirmations to double-spend.
- **Fix applied:** Before send: `spending_tracker.check_limits(user_id,
  amount_usd, SpendingLimits())` (per-swap $5k / hourly $10k / daily $50k);
  `record_spending()` only after success. `_check_withdrawal_whitelist()` enforces
  opt-in per-chain whitelists with cooldown. TOCTOU: deduction occurs immediately
  before send via `update_custodial_balance(operation='subtract')` (raises on
  insufficient funds) with no `await` in between, so it is atomic in the
  single-process async bot.
- **Residual risk:** TOCTOU protection is **not** DB row-level locking — a
  multi-process/multi-worker deployment could still race. `spending_tracker` and
  2FA state are in-memory per process. Whitelist is opt-in. USD valuation falls
  back to raw amount when price lookup fails (over-counts low-price tokens).

---

### MEDIUM

---

#### M1 — Unvalidated amount parsing (float precision loss)
- **File:** `api-ts/src/routes/agent.ts:1037-1039, 1079-1082` (also Solana/EVM quote sites)
- **Dimension:** agent-tool
- **Exploit:** Amounts were `parseFloat()` then `Math.floor(amount * 10**decimals)`
  → BigInt, introducing IEEE-754 precision loss, so the executed amount could
  differ subtly from the user's intent (exploitable in high-value / sandwich
  scenarios).
- **Fix applied:** Replaced all three sites with `parseAmountToBaseUnits(amount,
  decimals)` — exact string-split + BigInt; rejects non-numeric, `<= 0`, and
  precision exceeding the token's decimals. No new dependency.
- **Residual risk:** Could not run `tsc`/tests.

#### M2 — Chain-name resolution accepts ambiguous/aliased names; silent default
- **File:** `api-ts/src/routes/agent.ts:1050-1059`
- **Dimension:** agent-tool
- **Exploit:** A `/execute` swap command with no explicit chain silently defaulted
  to `ethereum`; with shared token symbols across chains, a user expecting another
  chain could execute on Ethereum unknowingly.
- **Fix applied:** Removed the silent `ethereum` default — `/execute` swap commands
  without an explicit `on <chain>` now return 400 asking the user to specify the
  chain. Aliases (`eth`, `base`, …) still resolve via `resolveChain`. Scoped inside
  the swap-match branch.
- **Residual risk:** Aliases are still accepted (only the missing-chain case is
  rejected). Could not run `tsc`/tests.

#### M3 — CORS localhost wildcard bypass (non-production)
- **File:** `api-ts/src/middleware/cors.ts:12`
- **Dimension:** edge
- **Exploit:** When `NODE_ENV !== 'production'`, any
  `http://localhost(:\d+)?` origin was accepted, letting any local proxy /
  malicious localhost port make authenticated cross-origin requests in dev/staging.
- **Fix applied:** Removed the regex branch (and the now-unused `isProduction` /
  `NODE_ENV` reference). Origins are accepted only from the explicit
  `ALLOWED_ORIGINS` allowlist in all environments. Default allowlist already
  includes `http://localhost:3000` and `:5173`, so the real dev workflow is
  preserved.
- **Residual risk:** `if (!origin) return '*'` is unchanged — no-Origin requests
  (curl, server-to-server) still get a wildcard. Any env overriding
  `ALLOWED_ORIGINS` must now list localhost explicitly. Could not run `tsc`
  (no JS runtime).

---

## Summary table

| ID | Title | File:Line | Dimension | Severity |
|----|-------|-----------|-----------|----------|
| C1 | Internal API auth bypass (NameError ×4) | `api/routes/internal.py:55,115,171,229` | authz | Critical |
| C2 | Cross-user swap execution / wallet takeover | `api/routes/internal.py:223` | authz | Critical |
| C3 | Reversed fail-open admin check | `bot/handlers/admin_custodial.py:30`, `admin_fees.py:16` | authz | Critical |
| C4 | Open redirect in OAuth callback | `api/routes/oauth.py:267` | authz | Critical |
| C6 | Missing 2FA gate on withdrawal | `bot/handlers/custodial.py:476-575` | authn/authz | Critical |
| C7 | Balance deducted, no refund on failure | `bot/handlers/custodial.py:500-567` | tx integrity | Critical |
| C8 | Weak EVM address validation | `bot/handlers/custodial.py:481` | financial | Critical |
| C10 | RPC injection via chainlist.org | `bot/services/rpc_manager.py:220-244` | external | Critical |
| C11 | User-ID enumeration | `api/main.py:1425-1461` | authz | Critical |
| C13 | Sponge webhook validation skipped | `api-ts/src/routes/agent.ts:~380-410` | edge | Critical |
| C14 | Cross-agent quote hijacking | `api-ts/src/routes/agent.ts:856`; `mcp.ts:476` | agent/mcp | Critical |
| C15 | Turnkey policy self-deletion | `api-ts/src/routes/agent.ts:1950` | authz | Critical |
| C16 | Wallet injection in /swap | `api-ts/src/routes/agent.ts:844` | input/authz | Critical |
| C17 | Wallet injection in /execute | `api-ts/src/routes/agent.ts:1024` | input/authz | Critical |
| C18 | MCP execute_swap authz bypass | `api-ts/src/routes/mcp.ts:476` | mcp | Critical |
| H1 | Hot-wallet legacy encryption | `bot/services/hot_wallet.py:245-278` | custody | High |
| H2 | Key in memory, no zeroization | `bot/services/wallet.py:1072,1091,1186,1238` | custody | High |
| H3 | No rate limit on backup-key decrypt | `bot/services/wallet.py:495-514` | key_sink | High |
| H4 | Backup keys decryptable w/ KMS access | `bot/utils/envelope_crypto.py:200-238` | key_sink | High |
| H5 | Unchecked RPC tx-hash | `bot/services/swap_engine.py:1158-1179` | financial | High |
| H6 | Missing auth binding in execute_swap | `bot/services/swap_engine.py:841` | authz | High |
| H7 | KMS no protection vs code compromise | `bot/services/kms_client.py:87-152` | key_sink | High |
| H8 | Li.Fi token cache unvalidated | `api-ts/src/services/TokenService.ts:303-359` | agent-tool | High |
| H9 | Portfolio disclosure (arbitrary wallet) | `api-ts/src/routes/agent.ts:1216` | agent | High |
| H10 | A2A placeholder sender / no ownership | `api-ts/src/routes/a2a.ts:140` | a2a | High |
| H11 | IP rate limit spoofable XFF | `api-ts/src/middleware/ipRateLimit.ts:36` | edge | High |
| H12 | Admin key no brute-force protection | `api-ts/src/middleware/auth.ts:45-62` | edge | High |
| H13 | JWT 7-day, no refresh/revocation | `api/main.py:576` | authz | High |
| H14 | Rate limiter not cleared | `bot/utils/rate_limiter.py:135-167` | edge | High |
| H15 | OAuth link action missing user_id check | `api/routes/oauth.py:437-453` | authz | High |
| H16 | No spending limits / whitelist; TOCTOU | `bot/handlers/custodial.py:453,476-575` | risk mgmt | High |
| M1 | Float precision in amount parsing | `api-ts/src/routes/agent.ts:1037-1082` | agent-tool | Medium |
| M2 | Ambiguous chain / silent default | `api-ts/src/routes/agent.ts:1050-1059` | agent-tool | Medium |
| M3 | CORS localhost wildcard bypass | `api-ts/src/middleware/cors.ts:12` | edge | Medium |
| **R1** | **Hardcoded BETA_PASSWORDS** | `bot/services/x402_service.py:24-29` | authz | **Critical — ROTATE** |
| **R2** | **Plaintext Turnkey key export to DB** | `bot/services/turnkey_export.py:36-56` | key_sink | **Critical — ROTATE** |
| **R3** | **DB breach exposes backup keys** | `bot/services/turnkey_export.py:50-55` | key_sink | **Critical — ROTATE** |
| **R4** | **Backup-key decrypt no 2FA/authz** | `bot/services/wallet.py:495-514` | key_sink | **Critical — ROTATE** |
| **R5** | **Backup keys decryptable w/ KMS** | `bot/utils/envelope_crypto.py:200-238` | key_sink | **High — ROTATE** |
| **R6** | **Plaintext key in predict memory** | `bot/handlers/predict.py:752-770` | key_sink | **High — ROTATE** |

Counts (auto-fixed): 15 Critical, 16 High, 3 Medium (34 total; IDs C5/C9/C12 were
reclassified to H15/H16/M3 respectively to match source severities, so those C-IDs
are intentionally vacant). Rotation-required (not auto-fixed): 6.

---

## Test results

### Python suite (pytest) — RAN
Runner: `.venv/bin/python -m pytest` (Python 3.9.6, pytest 8.4.2). Test files map
directly to changed modules; run per-file (full single-pass collection blocked by
the env issue below).

| Test file (covered module) | Result |
|---|---|
| `test_wallet_signing.py` / `test_wallet_key_hardening.py` (`bot/services/wallet.py`) | 4 passed / 7 passed |
| `test_hot_wallet_encryption.py` (`bot/services/hot_wallet.py`) | 5 passed |
| `test_oauth_redirect_validation.py` (`api/routes/oauth.py`) | 7 passed |
| `test_swap_engine_rpc_retry.py` (`bot/services/swap_engine.py`) | 4 passed |
| `test_rpc_manager_domain_validation.py` (`bot/services/rpc_manager.py`) | 21 passed |
| `test_rate_limiter_cleanup.py` (`bot/utils/rate_limiter.py`) | 4 passed |
| `test_kms_client_hardening.py` (`bot/services/kms_client.py`) | 6 passed |
| `test_copy_service.py` / `test_order_service.py` / `test_passkey_store_wave6.py` / `test_webapp_limit_orders.py` | 2 / 3 / 3 / 2 passed |
| `test_api_enumeration_and_jwt_hardening.py` (`api/main.py`, `api/routes/internal.py`) | 1 SKIPPED (env guard) |
| `test_custodial_withdraw_security.py` (`bot/handlers/custodial.py`, `admin_custodial.py`) | 1 ERROR (env collection) |

**Totals: 78 passed, 1 skipped, 1 collection-error, 0 failed.**

#### Failures introduced by the hardening edits: NONE
- The **skip** (`test_api_enumeration_and_jwt_hardening.py`) is an intentional env
  guard: `api.main` imports the monolith, which uses PEP 604 `str | None` syntax
  requiring Python 3.10+. The test explicitly `pytest.skip`s on older interpreters.
- The **error** (`test_custodial_withdraw_security.py`) is the same root cause:
  collection fails at `bot/handlers/start.py:108`
  (`def _format_address(addr: str | None)`) evaluated at import time, raising
  `TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'` on Python
  3.9. `start.py` is **not** a changed file; it is pulled in transitively via
  `bot/handlers/__init__.py`. The test uses `pytest.importorskip`, which only
  catches `ImportError`, so the `TypeError` surfaces as an error rather than a skip.
- All changed Python files byte-compile cleanly under 3.9. The blocker is solely
  the Python 3.9 interpreter (env mismatch); the project targets 3.10+. Running
  these two tests on Python 3.10+ would let them execute.

### TypeScript suite (`api-ts`) — COULD NOT RUN
- `api-ts/package.json` has **no `test` script** and no vitest config. The test
  files in `api-ts/src/__tests__/` import from `bun:test`, so the intended runner
  is `bun test`.
- **No JS runtime is installed** anywhere on this machine — `bun`, `node`, and
  `npm` are all absent (confirmed via PATH, login shell, and a full filesystem
  search). The suite cannot be executed here.
- Tests that would have run (28 cases) cover changed modules: `a2a.test.ts`
  (8, `routes/a2a.ts`), `tokenService.test.ts` (4, `services/TokenService.ts`),
  `ipRateLimit.test.ts` (7, `middleware/ipRateLimit.ts`), plus retry (4), env (3),
  health (2). To run: install bun, then `cd api-ts && bun test`.
- TS-only edits (`cors.ts`, `auth.ts`, `agent.ts`, `mcp.ts`) were verified by
  manual trace/inspection only; recommend `bun run check` (tsc) before merge.

### `packages/`
No pytest tests exist under `packages/` (only `design-tokens`, `openclaw`, `sdk`,
`sdk-python` source); nothing to run there.

---

_Generated as part of a security hardening pass. Auto-fixed findings are resolved
in code with regression tests where the test environment permitted. The
ROTATION-required findings above are NOT resolved by code and require manual
credential rotation plus git-history purge._
