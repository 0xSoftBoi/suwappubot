"""
Export private keys from Turnkey and store encrypted backups.

Pipeline: generate HPKE keypair → export from Turnkey → decrypt bundle →
encrypt with KMS envelope encryption → store in DB.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from bot.utils.envelope_crypto import encrypt_private_key_v2, encode_for_db, zeroize

logger = logging.getLogger(__name__)


async def export_and_backup_wallet(wallet_row, turnkey_client, session) -> bool:
    """
    Export a private key from Turnkey and store an encrypted backup in the DB.

    Args:
        wallet_row: Wallet ORM object (must be a Turnkey wallet)
        turnkey_client: Configured TurnkeyClient instance
        session: Active SQLAlchemy session

    Returns:
        True if backup was stored successfully
    """
    if not wallet_row.turnkey_wallet_id:
        logger.warning(f"Wallet {wallet_row.id} has no Turnkey wallet ID, skipping export")
        return False

    raw_key = None
    try:
        # Export from Turnkey via ACTIVITY_TYPE_EXPORT_WALLET
        raw_key = await turnkey_client.export_wallet(
            wallet_id=wallet_row.turnkey_wallet_id,
            organization_id=wallet_row.turnkey_sub_org_id,
        )

        if not raw_key:
            logger.error(f"Turnkey returned empty key for wallet {wallet_row.id}")
            return False

        # Encrypt with KMS envelope encryption
        encrypted = encrypt_private_key_v2(raw_key)
        db_fields = encode_for_db(encrypted)

        # Store backup fields on the wallet row
        wallet_row.encrypted_private_key = db_fields["encrypted_private_key"]
        wallet_row.encryption_scheme = db_fields["encryption_scheme"]
        wallet_row.kms_wrapped_dek = db_fields["kms_wrapped_dek"]
        wallet_row.aesgcm_nonce = db_fields["aesgcm_nonce"]
        wallet_row.kms_key_id = db_fields["kms_key_id"]
        wallet_row.key_version = db_fields["key_version"]
        wallet_row.backup_key_exported_at = datetime.now(timezone.utc)

        session.flush()
        logger.info(f"Stored encrypted backup key for wallet {wallet_row.id} ({wallet_row.address[:10]}...)")
        return True

    except Exception as e:
        logger.error(f"Failed to export/backup wallet {wallet_row.id}: {e}")
        raise
    finally:
        # Best-effort zeroize raw key
        if raw_key and isinstance(raw_key, str):
            del raw_key
