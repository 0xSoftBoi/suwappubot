#!/usr/bin/env python3
"""Re-wrap exported Turnkey backup keys from the local-KEK KMS to AWS KMS (R5).

Today `KMS_PROVIDER=local`: each backup key's DEK is wrapped by an env-var-derived
KEK that lives in the same Railway environment as the DB. Moving to AWS KMS puts a
real IAM boundary in front of the unwrap (kms:Decrypt scoped to the service role),
so a DB dump alone can't expose keys. Each row is fully re-encrypted (fresh DEK + nonce
via generate_data_key, scheme stays `kms_aesgcm_v2`); the private-key plaintext is
unchanged, only its on-disk encryption is replaced.

SAFETY: dry-run by default. Each row is decrypted with the CURRENT (local) KMS,
re-encrypted with AWS, and the AWS-wrapped result is **decrypted back and compared
to the original plaintext BEFORE the row is written**. A row that fails the
round-trip is skipped, never overwritten — a bad re-wrap can't brick a backup key.

Run it with BOTH configs available:
    KMS_PROVIDER=local            # so the existing rows decrypt
    AWS creds + AWS_DEFAULT_REGION # boto3
    KMS_AWS_KEY_ID=alias/suwappu-wallet-backup  # the new CMK
    DATABASE_URL=<prod>

    python scripts/rewrap_backup_keys_to_aws.py            # dry-run (counts only)
    python scripts/rewrap_backup_keys_to_aws.py --apply    # actually re-wrap
    python scripts/rewrap_backup_keys_to_aws.py --apply --limit 50   # batch

After it reports 0 remaining, flip the service `KMS_PROVIDER=aws` and redeploy.
"""
import argparse
import os
import sys

# Decrypt uses the default (current=local) KMS; encrypt uses an explicit AWS client.
from bot.utils.envelope_crypto import (
    decode_from_db,
    decrypt_private_key_v2,
    decrypt_wallet_key,
    encode_for_db,
    encrypt_private_key_v2,
)
from bot.services.kms_client import AwsKmsClient
from bot.models.user import Wallet
from database.db import get_session, init_db
from sqlalchemy import and_, or_


def _is_aws_wrapped(kms_key_id) -> bool:
    kid = (kms_key_id or "")
    return kid.startswith("arn:aws") or kid.startswith("alias/")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    ap.add_argument("--limit", type=int, default=0, help="max rows to process (0 = all)")
    args = ap.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2
    assert init_db(db_url), "DB init failed"

    if os.environ.get("KMS_PROVIDER", "").lower() not in ("local", "dev"):
        print("Refusing to run: set KMS_PROVIDER=local so existing rows decrypt.", file=sys.stderr)
        return 2

    aws_key_id = os.environ.get("KMS_AWS_KEY_ID")
    if not aws_key_id:
        print("KMS_AWS_KEY_ID (the target AWS CMK) is required", file=sys.stderr)
        return 2
    aws = AwsKmsClient(key_id=aws_key_id, region=os.environ.get("AWS_DEFAULT_REGION"))

    scanned = migrated = skipped_done = failed = 0
    with get_session() as session:
        # Push the "not yet AWS-wrapped" filter into SQL so --limit selects N
        # UNMIGRATED rows (otherwise LIMIT keeps re-pulling the same head rows and
        # makes no forward progress). NULL kms_key_id = legacy/v1 backup → must be
        # migrated, so include it explicitly rather than letting LIKE drop it.
        q = session.query(Wallet).filter(
            Wallet.backup_key_exported_at.isnot(None),
            or_(
                Wallet.kms_key_id.is_(None),
                and_(
                    ~Wallet.kms_key_id.like("arn:aws%"),
                    ~Wallet.kms_key_id.like("alias/%"),
                ),
            ),
        )
        if args.limit:
            q = q.limit(args.limit)
        wallets = q.all()

        for w in wallets:
            scanned += 1
            if _is_aws_wrapped(w.kms_key_id):  # belt-and-suspenders vs the SQL filter
                skipped_done += 1
                continue

            plaintext = None
            try:
                plaintext = decrypt_wallet_key(
                    encrypted_private_key=w.encrypted_private_key,
                    encryption_scheme=w.encryption_scheme,
                    kms_wrapped_dek=w.kms_wrapped_dek,
                    aesgcm_nonce=w.aesgcm_nonce,
                    kms_key_id=w.kms_key_id,
                    key_version=w.key_version,
                )
                new = encrypt_private_key_v2(plaintext, kms_client=aws)
                fields = encode_for_db(new)

                # Round-trip verify the AWS-wrapped blob BEFORE writing anything.
                check = decrypt_private_key_v2(
                    decode_from_db(
                        fields["encrypted_private_key"], fields["encryption_scheme"],
                        fields["kms_wrapped_dek"], fields["aesgcm_nonce"],
                        fields["kms_key_id"], fields["key_version"],
                    ),
                    kms_client=aws,
                )
                if check != plaintext:
                    failed += 1
                    print(f"  wallet {w.id}: round-trip MISMATCH — skipped (not written)")
                    continue

                if args.apply:
                    w.encrypted_private_key = fields["encrypted_private_key"]
                    w.encryption_scheme = fields["encryption_scheme"]
                    w.kms_wrapped_dek = fields["kms_wrapped_dek"]
                    w.aesgcm_nonce = fields["aesgcm_nonce"]
                    w.kms_key_id = fields["kms_key_id"]
                    w.key_version = fields["key_version"]
                migrated += 1
                print(f"  wallet {w.id}: re-wrapped to AWS{'' if args.apply else ' (dry-run)'}")
            except Exception as e:  # noqa: BLE001
                failed += 1
                print(f"  wallet {w.id}: ERROR {type(e).__name__}: {e} — skipped")
            finally:
                plaintext = None  # drop the plaintext reference

    print(
        f"\nscanned={scanned} to_migrate={migrated} already_aws={skipped_done} failed={failed} "
        f"mode={'APPLY' if args.apply else 'DRY-RUN'}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
