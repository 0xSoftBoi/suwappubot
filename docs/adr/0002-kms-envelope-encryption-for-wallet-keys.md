# 0002 — KMS envelope encryption for wallet keys

**Status**: Accepted (backfilled 2026-08; decision predates this record)

## Context

User wallet private keys are custodial and stored in the shared database.
The original scheme, `legacy_fernet_v1`, derived encryption from a single
static `ENCRYPTION_KEY` env var — one leaked secret exposed every wallet, and
rotation required re-encrypting everything manually.

## Decision

Default wallet encryption is **`kms_aesgcm_v2`**: envelope encryption where a
per-wallet data key encrypts the private key with AES-GCM, and the data key is
wrapped by AWS KMS. Legacy `legacy_fernet_v1` blobs **auto-migrate to v2 on
read** — no big-bang migration. See `docs/KMS_AWS_MIGRATION.md` and
`docs/SECRET_ROTATION_RUNBOOK.md`.

## Consequences

- A database dump alone cannot decrypt keys; KMS access is also required.
- KMS is the one AWS dependency that survives the Railway migration (ADR 0001);
  its availability is on the swap critical path.
- Both encryption code paths must be kept working until no v1 blobs remain.
- **Any change to these modules is MONEY-PATH**: adversarial review required
  before merge.
