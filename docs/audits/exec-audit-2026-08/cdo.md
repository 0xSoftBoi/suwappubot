# CDO Data Governance Audit — Suwappu (2026-08-15)

Scope: dual-ORM drift, sensitive-data inventory, lifecycle/retention, migration hygiene, bridge durability.
Method: static read of bot/models/ (SQLAlchemy), api-ts/src/db/schema/ (Drizzle), database/db.py (_ensure_schema), grep for logging of secrets.

---

## 1. Dual-ORM Drift (bot/models/ SQLAlchemy vs api-ts/src/db/schema/ Drizzle)

### CRITICAL — `users.recovery_setup_at` vs `recovery_email_set_at`: two different columns, no single source of truth, actively diverging
- **Files**: `bot/models/user.py:78-79` (`recovery_email`, `recovery_setup_at`) vs `api-ts/src/db/schema/users.ts:52-53` (`recoveryEmail` → same column `recovery_email`, but `recoveryEmailSetAt` → **different** underlying column `recovery_email_set_at`)
- **Issue**: Python bot writes `recovery_setup_at` when a user sets up recovery via Telegram/WhatsApp (`bot/services/wallet_recovery.py:71-72`). api-ts writes `recovery_email_set_at` when a user sets it via the webapp route (`api-ts/src/routes/webapp.ts:2000`, read at `:1965`). These are two physically distinct columns tracking the same concept with no reconciliation. A user who sets recovery email via the bot will show `setup_at: null` in the webapp API response (and vice versa).
- **Risk**: Silent data inconsistency in a security-relevant feature (wallet recovery). Support/users get contradictory "is recovery configured" answers depending on which surface they check. Low direct breach risk, real correctness/trust risk.
- **Fix**: Pick one canonical column name (recommend keeping Python's `recovery_setup_at` since it's the older/reconciled one — see `database/db.py:1894`), have api-ts read/write that same column, drop `recovery_email_set_at` from the Drizzle schema and app code. Route through `db-migrate` for a rename migration; until then, patch `webapp.ts` to write both columns.

### CRITICAL — Drizzle `totpSecret: varchar(64)` is stale metadata for a column Python widened to TEXT; a `drizzle-kit push` would repeat the exact incident already logged in `db.py`
- **Files**: `api-ts/src/db/schema/users.ts:42` (`varchar('totp_secret', { length: 64 })`) vs `bot/models/user.py:65-67` (`Text`, comment: "~208 chars") vs `database/db.py:1734-1751` (`_widen_totp_secret`, widens `VARCHAR(64)` → `TEXT` because "older deployments created the column as VARCHAR(64) for a plaintext TOTP seed. Encryption-at-rest stores a much longer ciphertext").
- **Issue**: The live DB column is `TEXT` (post-widen). `users.ts` still declares `varchar(64)`. This is the *same class of bug* that already caused a documented production incident: `docs` / `database/db.py:1875-1877` record that an api-ts `drizzle-kit push --force` previously **dropped** `recovery_email`/`recovery_setup_at` from the shared Postgres because Drizzle's schema didn't know about Python-owned columns. If `db:push` is run again with `totpSecret` still declared as `varchar(64)`, Drizzle will try to narrow `TEXT` back to `varchar(64)`, which on Postgres either errors (if any stored ciphertext exceeds 64 chars — it will, ~208 chars) or, if forced, truncates live encrypted 2FA secrets — locking users out of 2FA or worse, corrupting the ciphertext silently.
- **Risk**: HIGH — repeat of a known incident class, this time against security-critical data (2FA secrets), not just a UX field.
- **Fix**: Change `api-ts/src/db/schema/users.ts:42` to `text('totp_secret')` immediately (cheap, no migration needed since Drizzle is descriptive-only for Python-owned tables). Add the same "Python-owned, do not drizzle-generate" comment used on `apiUsageDaily.ts:12-14` to `users.ts` and `wallets.ts` to stop this recurring. Delegate to `db-migrate`.

### HIGH — `users` table: ~14 Python-owned columns entirely absent from the Drizzle schema (silent drift, not yet dangerous but every one is a future `db:push` landmine)
- **File**: `bot/models/user.py` columns not in `api-ts/src/db/schema/users.ts`: `discord_id`, `discord_username` (:26-27), `membership_address` (:31), `panic_sell_enabled` (:39), `llm_model` (:47), `region` (:52), `push_token` (:71), `passkey_credential_id`, `passkey_user_handle` (:74-75), `positions_backfilled_at` (:83), `weekly_digest`, `last_digest_at` (:86-87), `organization_role` (:91).
- **Issue**: None of these are declared in Drizzle even though api-ts reads/writes `users` extensively. Any future `drizzle-kit push` (already proven to have run with `--force` once, per `db.py:1875`) will treat these as "not in schema" and is one flag away from dropping them again. Currently mitigated only by the reactive `_reconcile_user_columns` band-aid (`database/db.py:1891-1922`), which restores missing columns as nullable **after the fact** — i.e., after an outage window.
- **Risk**: Medium-high; the mitigation is real but reactive (columns are gone until the next Python boot runs `_ensure_schema`), and it silently drops any `NOT NULL`/default/unique constraints the original column had (line 1913-1917: adds as bare `ADD COLUMN` with no default/constraint).
- **Fix**: Either (a) make `users.ts` the actual mirror of every Python-owned column with a "generated from SQLAlchemy, do not push" banner, checked by a CI diff script, or (b) hard-block `drizzle-kit push`/`--force` against the shared production DB entirely (remove from `package.json` scripts, keep only `db:generate`+manual review). Given `database/db.py:246` doctrine (additive+idempotent, no Alembic, Python owns migrations), (b) is the correct fix — api-ts should never mutate DDL on tables it doesn't originate.

### MEDIUM — `wallets`: `backup_key_exported_at` (Python) missing from Drizzle
- **Files**: `bot/models/user.py:151` vs `api-ts/src/db/schema/wallets.ts` (no equivalent field).
- **Risk**: Low on its own, but same landmine pattern as above — api-ts can't see this column exists.
- **Fix**: Add to `wallets.ts` or fold into the same "Python-owned" banner/CI-diff fix above.

### Governance root cause
- `api-ts/package.json:18` still exposes `"db:push": "drizzle-kit push"` against what `database/db.py:1894` calls "the shared Postgres." This is the mechanism that already caused one incident (`recovery_email`/`recovery_setup_at` dropped, `db.py:1875-1877`) and is structurally capable of repeating it against `totp_secret` today. **This is the single most important governance gap in the codebase**: two ORMs, one database, and only one side (Python via `_ensure_schema`) treats migrations as append-only; the other side (`drizzle-kit push`) is destructive-by-default and has been run with `--force` in production before.

---

