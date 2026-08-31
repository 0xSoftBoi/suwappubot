#!/usr/bin/env python3
"""
One-time re-wrap migration: AWS KMS -> Local env-var KEK.

Envelope encryption stores each secret encrypted under a random per-row AES-GCM
data key (DEK); KMS only wraps/unwraps that 32-byte DEK. This script rewraps every
v2 (kms_aesgcm_v2) DEK from AWS KMS to the LocalKmsClient KEK. The bulk ciphertext
and per-row nonce are left byte-identical — only the wrapped DEK changes.

Why this is needed: decrypt_private_key_v2 uses the GLOBAL kms client and ignores
the per-row kms_key_id, so flipping kms_provider aws->local without rewrapping would
make every existing DEK undecryptable.

Run order (BEFORE flipping kms_provider to 'local'):
  1. Ensure AWS creds + KMS_KEY_ID are present AND WALLET_MASTER_KEK is set.
  2. python3 scripts/rewrap_kms_to_local.py --dry-run --table all   # inspect counts
  3. python3 scripts/rewrap_kms_to_local.py --commit  --table all   # do it
  4. Re-run step 3 to confirm it is idempotent (all rows skipped).
  5. Flip kms_provider=local and redeploy.

Tables covered: wallets, hot_wallets, oauth_tokens.
Legacy (legacy_fernet_v1) rows are never touched — they are keyed by encryption_key.

Safety: dry-run is the default; --commit is required to write. Never logs DEKs,
private keys, or token plaintext.
"""

import os
import sys
import base64
import logging
import argparse

# Ensure repo root is importable when run as `python3 scripts/rewrap_kms_to_local.py`.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from bot.config.settings import settings  # noqa: E402
from bot.services.kms_client import AwsKmsClient, LocalKmsClient  # noqa: E402
from bot.utils.envelope_crypto import SCHEME_KMS_AESGCM_V2  # noqa: E402
from database.db import init_db, SessionLocal  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("rewrap_kms_to_local")


class Stats:
    def __init__(self, table: str):
        self.table = table
        self.scanned = 0
        self.skipped_no_dek = 0
        self.skipped_already_local = 0
        self.rewrapped = 0
        self.failed = 0

    def log(self):
        logger.info(
            "[%s] scanned=%d rewrapped=%d skipped_already_local=%d " "skipped_no_dek=%d failed=%d",
            self.table,
            self.scanned,
            self.rewrapped,
            self.skipped_already_local,
            self.skipped_no_dek,
            self.failed,
        )


def _rewrap_blob(aws: AwsKmsClient, local: LocalKmsClient, wrapped_dek_b64: str) -> str:
    """Unwrap a base64 AWS-wrapped DEK and return a base64 local-wrapped DEK.

    Raises _AlreadyLocal if the blob already decrypts under the local KEK.
    """
    old = base64.b64decode(wrapped_dek_b64)
    # Idempotency probe: if it already unwraps under the local KEK, it's migrated.
    try:
        local.decrypt_data_key(old)
        raise _AlreadyLocal()
    except _AlreadyLocal:
        raise
    except Exception:
        pass  # not local-wrapped yet — expected on first pass

    dek = aws.decrypt_data_key(old)
    try:
        new_wrapped = local.encrypt(dek)
        return base64.b64encode(new_wrapped).decode("ascii")
    finally:
        # Best-effort scrub of the plaintext DEK reference.
        del dek


class _AlreadyLocal(Exception):
    pass


def migrate_wallet_like(session, model, stats: Stats, aws, local, commit: bool, batch_size: int):
    """Rewrap wallets / hot_wallets — both have kms_wrapped_dek + kms_key_id columns."""
    rows = session.query(model).filter(model.encryption_scheme == SCHEME_KMS_AESGCM_V2).all()
    pending = 0
    for row in rows:
        stats.scanned += 1
        if not row.kms_wrapped_dek:
            stats.skipped_no_dek += 1  # Turnkey / no local DEK
            continue
        try:
            new_b64 = _rewrap_blob(aws, local, row.kms_wrapped_dek)
        except _AlreadyLocal:
            stats.skipped_already_local += 1
            continue
        except Exception as e:
            stats.failed += 1
            logger.error("[%s] row id=%s rewrap failed: %s", stats.table, row.id, e)
            continue

        if commit:
            row.kms_wrapped_dek = new_b64
            row.kms_key_id = local.key_id
        stats.rewrapped += 1
        pending += 1
        if commit and pending >= batch_size:
            session.commit()
            pending = 0
    if commit and pending:
        session.commit()


def migrate_oauth(session, stats: Stats, aws, local, commit: bool, batch_size: int):
    """Rewrap oauth_tokens. Access token uses kms_wrapped_dek column; refresh token
    stores a concatenated 'wrapped_dek|nonce|ciphertext' blob (rewrap element 0 only).
    There is no kms_key_id column on this table — the local-decrypt probe is the only
    idempotency signal."""
    from bot.models.oauth import OAuthToken

    rows = (
        session.query(OAuthToken).filter(OAuthToken.encryption_scheme == SCHEME_KMS_AESGCM_V2).all()
    )
    pending = 0
    for row in rows:
        stats.scanned += 1
        changed = False
        row_failed = False

        # --- access token (kms_wrapped_dek column) ---
        if row.kms_wrapped_dek:
            try:
                new_b64 = _rewrap_blob(aws, local, row.kms_wrapped_dek)
                if commit:
                    row.kms_wrapped_dek = new_b64
                changed = True
            except _AlreadyLocal:
                pass
            except Exception as e:
                row_failed = True
                logger.error("[oauth] row id=%s access rewrap failed: %s", row.id, e)
        else:
            stats.skipped_no_dek += 1

        # --- refresh token (concatenated wrapped_dek|nonce|ciphertext) ---
        if row.refresh_token_encrypted and "|" in row.refresh_token_encrypted:
            parts = row.refresh_token_encrypted.split("|")
            if len(parts) == 3:
                try:
                    new_dek_b64 = _rewrap_blob(aws, local, parts[0])
                    if commit:
                        row.refresh_token_encrypted = "|".join([new_dek_b64, parts[1], parts[2]])
                    changed = True
                except _AlreadyLocal:
                    pass
                except Exception as e:
                    row_failed = True
                    logger.error("[oauth] row id=%s refresh rewrap failed: %s", row.id, e)
            else:
                row_failed = True
                logger.error(
                    "[oauth] row id=%s malformed refresh blob (%d parts)", row.id, len(parts)
                )

        if row_failed:
            stats.failed += 1
            continue
        if changed:
            stats.rewrapped += 1
            pending += 1
        else:
            stats.skipped_already_local += 1
        if commit and pending >= batch_size:
            session.commit()
            pending = 0
    if commit and pending:
        session.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description="Rewrap KMS-wrapped DEKs from AWS to Local KEK.")
    parser.add_argument(
        "--commit", action="store_true", help="Actually write changes (default is dry-run)."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Explicit no-op (dry-run is already the default; ignored if --commit is given).",
    )
    parser.add_argument(
        "--table",
        choices=["wallets", "hot_wallets", "oauth", "all"],
        default="all",
        help="Which table(s) to process.",
    )
    parser.add_argument(
        "--batch-size", type=int, default=100, help="Commit every N rewrapped rows."
    )
    args = parser.parse_args()
    commit = args.commit

    # --- preconditions ---
    if not settings.wallet_master_kek:
        logger.error("WALLET_MASTER_KEK is not set — cannot build the local KEK target.")
        return 2
    if not settings.kms_key_id:
        logger.error("kms_key_id (KMS_KEY_ID) is not set — cannot build the AWS source client.")
        return 2

    logger.info("Mode: %s | table=%s", "COMMIT" if commit else "DRY-RUN", args.table)

    aws = AwsKmsClient(key_id=settings.kms_key_id, region=settings.kms_region)
    local = LocalKmsClient(settings.wallet_master_kek)
    logger.info("Source=AWS KMS (%s)  Target=Local (%s)", settings.kms_key_id, local.key_id)

    if not init_db(settings.database_url):
        logger.error("Database initialization failed.")
        return 2
    session = SessionLocal()

    all_stats = []
    try:
        from bot.models.user import Wallet
        from bot.models.custodial import HotWallet

        if args.table in ("wallets", "all"):
            s = Stats("wallets")
            migrate_wallet_like(session, Wallet, s, aws, local, commit, args.batch_size)
            all_stats.append(s)
        if args.table in ("hot_wallets", "all"):
            s = Stats("hot_wallets")
            migrate_wallet_like(session, HotWallet, s, aws, local, commit, args.batch_size)
            all_stats.append(s)
        if args.table in ("oauth", "all"):
            s = Stats("oauth_tokens")
            migrate_oauth(session, s, aws, local, commit, args.batch_size)
            all_stats.append(s)
    finally:
        session.close()

    total_failed = 0
    for s in all_stats:
        s.log()
        total_failed += s.failed

    if not commit:
        logger.info("DRY-RUN complete — no changes written. Re-run with --commit to apply.")
    else:
        logger.info("COMMIT complete.")

    if total_failed:
        logger.error("%d row(s) failed — exiting non-zero.", total_failed)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
