# Secret Rotation + Git-History Purge Runbook

Runbook for the **manual** remediations from the #311 red-team review (tracked in
issue #331, findings **R1–R6**). These are secret-exposure issues that **code changes
cannot fix**: a secret that has ever been committed, exported, or persisted must be
treated as compromised — removing it from the current tree leaves it in git history,
packfiles, forks, clones, CI caches, and any mirror.

> **Golden rule: rotate first, purge second.** Invalidate every exposed secret (so a
> leaked-but-not-yet-purged value is already dead) *before* rewriting history.

The auto-fixed code findings (C1/C2/C3, custodial guard, OAuth/RPC hardening) are already
landed; this runbook covers only what a human must do.

---

## Severity-ranked exposures

| # | Exposure | Where | Severity | Core action |
|---|----------|-------|----------|-------------|
| R1 | Beta access codes hardcoded in source (now env-driven, but the literals live in git history) | `bot/services/x402_service.py` (history: commit `5319d3c` and earlier) | High | Rotate the codes; purge the literals from history |
| R2 | Plaintext private key **exported** from the Turnkey TEE and backed up to the DB | `bot/services/turnkey_export.py` | **Critical** | Treat exported keys as compromised → **rotate wallet keys / migrate funds** |
| R3 | DB breach exposes all Turnkey backup keys at rest | `wallets.encrypted_private_key`, `backup_key_exported_at` | **Critical** | Same as R2 + segregate the backup-KMS credential from the app credential |
| R4 | Backup-key decryption had no 2FA / authz gate | `bot/services/wallet.py` | High | Rotate affected keys if exposure suspected; the authz gate is part of the #311 wallet hardening (separate PR) |
| R5 | Encrypted backup keys decryptable by any process holding KMS access | `bot/utils/envelope_crypto.py` | High | Restrict KMS `Decrypt` via IAM/key policy; rotate KMS keys |
| R6 | Plaintext key in memory during predict signing | `bot/handlers/predict.py` | Medium | Operational; rotate only if a host/memory compromise is suspected |

**Decision gate:** R2–R6 only require *key rotation* (an expensive, user-facing action —
moving funds) **if you have reason to believe the keys were actually exposed** (DB dump,
RCE, leaked logs, a real export having run against real funds). If the export path was
never used against funded production wallets, the remediation is to **remove/guard the
path** and tighten KMS — not to rotate every wallet. Establish that first (see R2 below).

---

## R1 — Beta access codes

**State:** `x402_service.py` now reads `BETA_PASSWORDS` from the env (no hardcoded fallback
— good). But the old literals are in git history and, if still accepted, are compromised.

1. **Rotate.** Pick new codes and set the `BETA_PASSWORDS` env var (format
   `code:TIER,code2:TIER2`) on Railway (production + development). Remove the old codes
   from the env so they no longer grant access.
2. *(Optional, recommended)* Migrate beta codes to a DB table (bcrypt-hashed, with expiry +
   max-uses + tier) so future codes are never in env/source at all.
3. **Purge the literals from history** — see [§ History purge](#history-purge) with a
   `replacements.txt` mapping each old literal → `***REMOVED***`.

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
