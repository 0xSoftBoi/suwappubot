# KMS `local` → `aws` migration (R5)

Closes the R5 item from the #311 red-team review: move exported Turnkey backup keys
off the env-var-derived local KEK and behind a real AWS KMS IAM boundary.

## Why

Production runs `KMS_PROVIDER=local` with `WALLET_PROVIDER=turnkey`. Signing keys live
in Turnkey's TEE, but the **auto-exported encrypted fallback backups**
(`wallets.encrypted_private_key`, present where `backup_key_exported_at IS NOT NULL`) are
envelope-encrypted (`kms_aesgcm_v2`) with a DEK that is wrapped by a **KEK derived from an
environment variable** (`LocalKmsClient`, HKDF over `ENCRYPTION_KEY`). That KEK lives in
the same Railway environment as `DATABASE_URL`, so a single environment/DB compromise can
unwrap every backup. Moving the DEK wrapping to AWS KMS puts `kms:Decrypt` (scoped to the
service IAM role) between an attacker and the keys: a DB dump alone is no longer enough.

Each affected row is fully re-encrypted: `encrypt_private_key_v2` mints a fresh DEK
(`generate_data_key`) and nonce, so the stored `encrypted_private_key` (ciphertext),
`aesgcm_nonce`, `kms_wrapped_dek`, and `kms_key_id` columns all change. The underlying
private-key plaintext is identical — only its on-disk encryption is replaced, now wrapped
by AWS KMS instead of the local KEK.

## Blast radius (size it first)

```sql
SELECT count(*) FROM wallets WHERE backup_key_exported_at IS NOT NULL;
```

Only those rows are affected. If the count is 0, there is nothing to migrate — just flip
`KMS_PROVIDER=aws` for new exports and stop here.

## 1. AWS KMS setup (one-time)

Create a symmetric CMK dedicated to wallet-backup wrapping and grant the service role the
minimum it needs.

```bash
aws kms create-key \
  --description "Suwappu wallet backup DEK wrapping (kms_aesgcm_v2)" \
  --key-usage ENCRYPT_DECRYPT --key-spec SYMMETRIC_DEFAULT
aws kms create-alias \
  --alias-name alias/suwappu-wallet-backup \
  --target-key-id <key-id-from-above>
```

Key policy / IAM — grant the **service role only** these actions on this CMK:
`kms:GenerateDataKey` (used by `encrypt_private_key_v2`), `kms:Decrypt` (used at sign time
and by the re-wrap verify step), and `kms:DescribeKey`. No `kms:Encrypt`, no key
administration, no other principals. Enable annual rotation and CloudTrail data events on
the key so every unwrap is logged (pairs with the R4 access guard's app-side logging).

## 2. Re-wrap the existing rows

`scripts/rewrap_backup_keys_to_aws.py` decrypts each affected row with the **current local**
KMS, re-encrypts with **AWS** KMS, and — critically — **round-trips the AWS-wrapped result
back to plaintext and compares it to the original before writing the row**. A row that fails
verification is skipped and left untouched, so a bad re-wrap can never brick a backup key.
It is idempotent (rows already wrapped by an `arn:aws…`/`alias/…` key are skipped) and
batchable via `--limit`.

Run it with **both** KMS configs present in the environment:

```bash
export DATABASE_URL=<prod>
export KMS_PROVIDER=local                       # so existing rows still decrypt
export KMS_AWS_KEY_ID=alias/suwappu-wallet-backup
export AWS_DEFAULT_REGION=us-east-1             # + AWS creds for boto3

python scripts/rewrap_backup_keys_to_aws.py                 # dry-run: counts + per-row plan
python scripts/rewrap_backup_keys_to_aws.py --apply --limit 50   # re-wrap a batch
python scripts/rewrap_backup_keys_to_aws.py --apply              # finish the rest
```

The script refuses to run unless `KMS_PROVIDER` is `local`/`dev` (it must be able to decrypt
the old wrapping) and `KMS_AWS_KEY_ID` is set. It never prints key material. `get_session()`
commits per process invocation, so each `--limit` batch is its own transaction — safe to
re-run after an interruption.

Take a DB snapshot before the first `--apply` (Railway → backups, or the pg_dump→S3 script
from the live-status runbook). Because old and new wrappings are interchangeable until
cutover (see step 3), a snapshot fully covers rollback.

## 3. Cutover

Once a dry-run reports `to_migrate=0`:

1. Set the service env `KMS_PROVIDER=aws` (+ `KMS_AWS_KEY_ID`, AWS creds) and redeploy.
2. New exports now wrap with AWS automatically (`encrypt_private_key_v2` uses the configured
   client). Decryption of any already-migrated row continues to work because the row carries
   its own `kms_key_id`.

**Keep the old `ENCRYPTION_KEY` env var in place until the migration is verified complete.**
It is the only thing that can unwrap any not-yet-migrated row. Remove it only after a final
`to_migrate=0` dry-run **and** a spot-check sign on a migrated wallet under `KMS_PROVIDER=aws`.

## Rollback

Before cutover: restore the pre-`--apply` DB snapshot — nothing else changed.
After cutover but `ENCRYPTION_KEY` still present: set `KMS_PROVIDER=local` and redeploy;
local rows still decrypt, and AWS rows fail closed (they don't silently mis-decrypt).
The re-wrap is forward-only by design — there is no automated AWS→local reverse, but the
snapshot covers it.
