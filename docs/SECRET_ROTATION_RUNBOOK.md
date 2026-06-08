# Secret Rotation + Git-History Purge Runbook

Runbook for the **manual** remediations from the #311 red-team review (tracked in
issue #331, findings **R1–R6**). The auto-fixed code findings (C1–C18, custodial guard,
OAuth/RPC hardening) are already landed; this covers only what a human/ops must do.

## TL;DR — what a deep review (all 891 commits, every branch) actually found

1. **Rotate the 3 beta codes; skip the git-history purge.** The *only* real secret ever
   committed is three beta access codes (`waifu`, `suwappu`, `earlybird`). Rotating them in
   the Railway `BETA_PASSWORDS` env var neutralizes the exposure **completely and instantly**.
   A history rewrite is **not worth it** and can't even fully un-expose them — there is a
   **fork you don't control** (`daceconomy/A-suwappubot`, a full copy of all history) and
   GitHub keeps old commits reachable by direct-SHA URL. Everything else flagged in history
   was a false positive (test fixtures, vendored forge-std/OZ constants, `.env` templates).
2. **The Turnkey "key export" is encrypted and load-bearing — likely a non-issue.** The
   backup is **AES-256-GCM envelope-encrypted (`kms_aesgcm_v2`)**, not plaintext at rest, and
   it's *used* (fallback signing in `turnkey_fallback.py`) — so you can't just delete it. It
   only ever ran if `WALLET_PROVIDER=turnkey` in prod. **Check one value to settle it:**
   ```bash
   railway variables --service python-api | grep -iE 'WALLET_PROVIDER|KMS_PROVIDER'
   ```
   - **unset / `local`** → the export never fired → `backup_key_exported_at` is uniformly NULL
     → **R2/R3 blast radius is zero.** No DB query, no key rotation. Done.
   - **`turnkey`** → run the blast-radius query (R2 below); rotate keys **only if**
     `KMS_PROVIDER` ≠ `aws` (then the DEK is wrapped by an env-var KEK, weak) or you suspect a
     host/KMS breach. If `KMS_PROVIDER=aws`, the fix is just R5 (scope `kms:Decrypt`).

   Honest caveat: the key *did* leave the Turnkey TEE in plaintext transiently (in app
   memory) during export, so custody dropped from TEE-grade to app-KMS-grade — the at-rest
   safety is entirely contingent on `KMS_PROVIDER=aws` **with** R5 scoping.

> **Golden rule when you do rotate: rotate first, purge second** — but per (1) the purge is
> optional defense-in-depth here, not security-critical.

---

## Severity-ranked exposures (re-assessed)

| # | Exposure | Where | Real severity | Core action |
|---|----------|-------|---------------|-------------|
| R1 | Beta access codes hardcoded in source (now env-driven; literals remain in history) | `bot/services/x402_service.py` (history: `01104ff` → removed in `5319d3c`) | High → **easy** | **Rotate the codes in env.** Purge optional (fork + SHA-cache make it incomplete). |
| R2 | Private key exported from Turnkey TEE, stored **encrypted** (`kms_aesgcm_v2`) in DB | `bot/services/turnkey_export.py` (auto-runs in `wallet.py` `_create_turnkey_wallet`) | **Conditional** | If `WALLET_PROVIDER`≠turnkey → **zero**. Else: query blast radius; rotate only if KMS unsound / breach suspected. |
| R3 | DB breach exposes backup keys at rest | `wallets.encrypted_private_key`, `backup_key_exported_at` | **Conditional** | Encrypted at rest; a DB-only breach doesn't expose keys **if** `KMS_PROVIDER=aws`. Segregate the backup KMS key (R5). |
| R4 | Backup-key decryption has no 2FA / authz gate | `bot/services/wallet.py` | High | Add the authz gate (code — small, can be done now); rotate affected keys only if exposure suspected. |
| R5 | Encrypted backup keys decryptable by any process with KMS access | `bot/utils/envelope_crypto.py`, `bot/services/kms_client.py` | High | If AWS KMS: dedicated CMK + scope `kms:Decrypt` to the service role. If `local`: KEK is an env var — restrict who can read the Railway secret. |
| R6 | Plaintext key in memory during signing | `bot/handlers/predict.py` | Medium | Operational; rotate only on suspected host/memory compromise. |

---

## R1 — Beta access codes

**State:** `x402_service.py` now reads `BETA_PASSWORDS` from the env (no hardcoded fallback
— good). But the old literals are in git history and, if still accepted, are compromised.

1. **Rotate (this is the whole fix).** Pick new codes and set the `BETA_PASSWORDS` env var
   (format `code:TIER,code2:TIER2`) on Railway (production + development). Remove the old
   codes so reading them from history no longer grants anything. `x402_service.py` already
   loads only from env, so this takes effect immediately.
2. *(Optional, recommended)* Migrate beta codes to a DB table (bcrypt-hashed, with expiry +
   max-uses + tier) so future codes are never in env/source at all.
3. **Purge is OPTIONAL, not required.** Rotation (step 1) fully neutralizes the exposure.
   A purge can't be complete anyway (see [§ History purge](#history-purge) — the fork and
   GitHub's SHA cache), so only do it as cosmetic hygiene, never as the security fix.

> ⚠️ **Standing exposure — the fork.** `daceconomy/A-suwappubot` is a fork = a full,
> independent copy of everything ever committed, which you don't control and **cannot
> purge**. Rotation is the only lever that protects against it. After rotating, consider
> asking the fork owner to delete/re-sync, but treat anything that was ever committed
> (the beta codes) as permanently readable by whoever holds that fork.

---

## R2 / R3 — Turnkey key export + DB backups (CRITICAL)

`turnkey_export.py` calls `ACTIVITY_TYPE_EXPORT_WALLET`, receives a **plaintext private
key**, and writes an encrypted backup to `wallets.encrypted_private_key`
(`backup_key_exported_at` stamps when). Once a key is exported in plaintext and persisted,
the **key material itself is the secret** — deleting the code doesn't un-expose anything
already written to the DB/logs/backups.

1. **Establish blast radius (do this first).**
   - Query `SELECT id, user_id, address, backup_key_exported_at FROM wallets WHERE
     backup_key_exported_at IS NOT NULL;` — these are the wallets whose keys were exported.
   - If the set is **empty** (export never ran against real wallets) → no key rotation
     needed; jump to step 3 (remove/guard the path) + step 4 (KMS).
2. **If any keys were exported → rotate them.** For each affected wallet: generate a fresh
   key (new Turnkey sub-org wallet), **migrate funds** to the new address, repoint the
   user's active wallet, and retire the old key. Treat the old address as burned.
3. **Remove or gate the export path.** Either delete `turnkey_export.py` + its caller in
   `bot/services/wallet.py` (~L229) if backups aren't needed, or gate it behind explicit
   2FA + admin authorization and never persist plaintext (the #311 wallet-hardening PR adds
   the authz gate + zeroization — review and land it under #331).
4. **Scrub persisted copies.** Null out `encrypted_private_key`/`backup_key_exported_at`
   for rotated wallets; purge any logs, DB dumps, or backups that captured exported keys.

---

## R4 / R5 / R6 — key handling (defense-in-depth)

These concern how keys are *used*, not a standing plaintext exposure. Land the #311 wallet
hardening (authz gate on backup-key decrypt, memory zeroization) as a reviewed PR under
#331. Separately, **tighten KMS**: scope the `kms:Decrypt` grant for the wallet-backup key
to only the service role that needs it (IAM/key policy), and consider a dedicated KMS key
for backups, segregated from the app's general KMS credential. Rotate the KMS key + any
affected wallet keys only if RCE/host compromise is suspected.

---

## History purge

> 🛑 **Not recommended for this repo** (see TL;DR). The only real history secret is the beta
> codes, which rotation already kills; a purge can't reach the fork or GitHub's SHA cache,
> and rewriting 891 commits / 58 branches / 20+ open PRs is high-disruption. This section is
> kept as reference **if** a future, genuinely-unrotatable secret is ever committed.

Run **after** rotation. Rewriting history is destructive and forces every collaborator to
re-clone — coordinate a window.

### 1. Build the replacement map
Create `replacements.txt` (one secret per line; `git filter-repo` replaces each match with
`***REMOVED***`). Use literal old beta codes + any other leaked literals:
```
waifu==>***REMOVED***
suwappu==>***REMOVED***
earlybird==>***REMOVED***
# add any other confirmed-leaked literal strings here
```
> Do **not** `--invert-paths` whole files (that drops the file's whole history); use
> `--replace-text` so only the secret strings are scrubbed.

### 2. Rewrite (prefer git-filter-repo)
```bash
# fresh mirror clone to operate on
git clone --mirror git@github.com:0xSoftBoi/suwappubot.git suwappubot-purge.git
cd suwappubot-purge.git
git filter-repo --replace-text ../replacements.txt
```
BFG alternative:
```bash
bfg --replace-text replacements.txt suwappubot-purge.git
cd suwappubot-purge.git && git reflog expire --expire=now --all && git gc --prune=now --aggressive
```

### 3. Force-push + re-clone
```bash
git push --force --mirror      # from the rewritten mirror
```
- Every collaborator must **re-clone** (rebasing local work onto rewritten history
  corrupts it). Announce before pushing.
- Update any open PR branches (they'll be based on old history) — re-create from `main`.

### 4. Invalidate downstream copies
A purge only fixes *this* repo's objects. Also:
- **Rotate anyway** — assume the secret leaked before the purge (this is why rotation is
  step 0, not step 4).
- Delete/rebuild CI caches, build artifacts, container images that embedded the secret.
- Purge or re-sync any **forks/mirrors** (GitHub forks keep their own object copies).
- **Audit access logs** for the exposure window of each rotated credential.

---

## Done when
- [ ] R1 codes rotated in env; literals scrubbed from history.
- [ ] R2/R3 blast radius established; exported keys rotated + funds migrated (or confirmed
      none exported); export path removed/gated; persisted copies scrubbed.
- [ ] R4/R5/R6 wallet hardening landed (#331 PR) + KMS decrypt scoped down.
- [ ] History force-pushed; all collaborators re-cloned; CI caches/images/forks invalidated.
- [ ] Access logs audited for each rotated secret's exposure window.

**Refs:** issue #331, `SECURITY_HARDENING.md` (branch `security/api-hardening-worktree`),
already-landed fixes #330/#332/#333/#334.
