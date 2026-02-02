"""
Envelope encryption utilities for wallet private keys.

Uses AES-256-GCM with KMS-wrapped data encryption keys (DEKs).
"""

import os
import base64
import logging
import ctypes
from typing import Optional, Tuple
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)


# Encryption scheme identifiers
SCHEME_LEGACY_FERNET_V1 = "legacy_fernet_v1"
SCHEME_KMS_AESGCM_V2 = "kms_aesgcm_v2"


@dataclass
class EncryptedWalletKey:
    """Container for encrypted wallet key data."""
    scheme: str  # Encryption scheme identifier
    ciphertext: bytes  # AES-GCM encrypted private key
    nonce: bytes  # 12-byte nonce for AES-GCM
    wrapped_dek: bytes  # KMS-encrypted DEK
    kms_key_id: str  # Which KMS key was used
    key_version: int = 1  # For future rotation tracking


def zeroize(data: bytearray) -> None:
    """
    Best-effort zeroization of sensitive data in memory.
    
    Note: Python doesn't guarantee memory clearing, but this helps.
    """
    if data is None:
        return
    try:
        for i in range(len(data)):
            data[i] = 0
    except Exception:
        pass


def zeroize_bytes(data: bytes) -> None:
    """
    Best-effort zeroization for bytes objects.
    
    Bytes are immutable in Python, so we try to overwrite via ctypes.
    This is not guaranteed but helps reduce exposure window.
    """
    if data is None or len(data) == 0:
        return
    try:
        # Attempt to overwrite the buffer directly
        ptr = ctypes.cast(ctypes.c_char_p(data), ctypes.POINTER(ctypes.c_char))
        ctypes.memset(ptr, 0, len(data))
    except Exception:
        pass


def encrypt_private_key_v2(
    private_key: str,
    kms_client=None,
) -> EncryptedWalletKey:
    """
    Encrypt a private key using envelope encryption (KMS + AES-GCM).
    
    Args:
        private_key: The plaintext private key (hex string or base58)
        kms_client: Optional KMS client (uses default if not provided)
        
    Returns:
        EncryptedWalletKey with all fields populated
    """
    if kms_client is None:
        from bot.services.kms_client import get_kms_client
        kms_client = get_kms_client()
    
    # Generate data key via KMS
    data_key_result = kms_client.generate_data_key()
    plaintext_dek = bytearray(data_key_result.plaintext_key)
    
    try:
        # Generate random nonce for AES-GCM
        nonce = os.urandom(12)
        
        # Encrypt the private key with AES-256-GCM
        aesgcm = AESGCM(bytes(plaintext_dek))
        ciphertext = aesgcm.encrypt(nonce, private_key.encode("utf-8"), None)
        
        return EncryptedWalletKey(
            scheme=SCHEME_KMS_AESGCM_V2,
            ciphertext=ciphertext,
            nonce=nonce,
            wrapped_dek=data_key_result.encrypted_key,
            kms_key_id=data_key_result.key_id,
            key_version=1,
        )
    finally:
        # Best-effort zeroize the plaintext DEK
        zeroize(plaintext_dek)


def decrypt_private_key_v2(
    encrypted_data: EncryptedWalletKey,
    kms_client=None,
) -> str:
    """
    Decrypt a private key that was encrypted with envelope encryption.
    
    Args:
        encrypted_data: The encrypted wallet key data
        kms_client: Optional KMS client (uses default if not provided)
        
    Returns:
        Decrypted private key string
    """
    if kms_client is None:
        from bot.services.kms_client import get_kms_client
        kms_client = get_kms_client()
    
    # Decrypt the DEK via KMS
    plaintext_dek = bytearray(kms_client.decrypt_data_key(encrypted_data.wrapped_dek))
    
    try:
        # Decrypt the private key with AES-GCM
        aesgcm = AESGCM(bytes(plaintext_dek))
        plaintext = aesgcm.decrypt(
            encrypted_data.nonce,
            encrypted_data.ciphertext,
            None,
        )
        return plaintext.decode("utf-8")
    finally:
        # Best-effort zeroize
        zeroize(plaintext_dek)


# --- Database field encoding/decoding ---

def encode_for_db(encrypted: EncryptedWalletKey) -> dict:
    """
    Encode EncryptedWalletKey fields for database storage.
    
    Returns a dict with base64-encoded binary fields.
    """
    return {
        "encrypted_private_key": base64.b64encode(encrypted.ciphertext).decode("ascii"),
        "encryption_scheme": encrypted.scheme,
        "kms_wrapped_dek": base64.b64encode(encrypted.wrapped_dek).decode("ascii"),
        "aesgcm_nonce": base64.b64encode(encrypted.nonce).decode("ascii"),
        "kms_key_id": encrypted.kms_key_id,
        "key_version": encrypted.key_version,
    }


def decode_from_db(
    encrypted_private_key: str,
    encryption_scheme: str,
    kms_wrapped_dek: Optional[str],
    aesgcm_nonce: Optional[str],
    kms_key_id: Optional[str],
    key_version: Optional[int] = 1,
) -> EncryptedWalletKey:
    """
    Decode database fields back into EncryptedWalletKey.
    
    For legacy schemes, only encrypted_private_key is used.
    """
    if encryption_scheme == SCHEME_KMS_AESGCM_V2:
        if not all([kms_wrapped_dek, aesgcm_nonce, kms_key_id]):
            raise ValueError("Missing required fields for v2 decryption")
        
        return EncryptedWalletKey(
            scheme=encryption_scheme,
            ciphertext=base64.b64decode(encrypted_private_key),
            nonce=base64.b64decode(aesgcm_nonce),
            wrapped_dek=base64.b64decode(kms_wrapped_dek),
            kms_key_id=kms_key_id,
            key_version=key_version or 1,
        )
    else:
        # Legacy scheme - ciphertext is the full encrypted blob
        return EncryptedWalletKey(
            scheme=encryption_scheme or SCHEME_LEGACY_FERNET_V1,
            ciphertext=encrypted_private_key.encode("utf-8"),  # Legacy stores as string
            nonce=b"",
            wrapped_dek=b"",
            kms_key_id="",
            key_version=0,
        )


def decrypt_wallet_key(
    encrypted_private_key: str,
    encryption_scheme: Optional[str] = None,
    kms_wrapped_dek: Optional[str] = None,
    aesgcm_nonce: Optional[str] = None,
    kms_key_id: Optional[str] = None,
    key_version: Optional[int] = None,
) -> str:
    """
    Unified decryption function that handles both legacy and v2 schemes.
    
    Args:
        encrypted_private_key: The ciphertext (base64 for v2, legacy string for v1)
        encryption_scheme: Scheme identifier (None = legacy)
        kms_wrapped_dek: Base64 wrapped DEK (v2 only)
        aesgcm_nonce: Base64 nonce (v2 only)
        kms_key_id: KMS key identifier (v2 only)
        key_version: Key version (v2 only)
        
    Returns:
        Decrypted private key string
    """
    scheme = encryption_scheme or SCHEME_LEGACY_FERNET_V1
    
    if scheme == SCHEME_KMS_AESGCM_V2:
        encrypted_data = decode_from_db(
            encrypted_private_key=encrypted_private_key,
            encryption_scheme=scheme,
            kms_wrapped_dek=kms_wrapped_dek,
            aesgcm_nonce=aesgcm_nonce,
            kms_key_id=kms_key_id,
            key_version=key_version,
        )
        return decrypt_private_key_v2(encrypted_data)
    else:
        # Legacy decryption
        from bot.utils.encryption import decrypt_private_key as legacy_decrypt
        from bot.config.settings import settings
        return legacy_decrypt(encrypted_private_key, settings.encryption_key)


def migrate_to_v2(
    encrypted_private_key: str,
    encryption_scheme: Optional[str] = None,
    kms_wrapped_dek: Optional[str] = None,
    aesgcm_nonce: Optional[str] = None,
    kms_key_id: Optional[str] = None,
    key_version: Optional[int] = None,
) -> Optional[dict]:
    """
    Migrate a wallet key from legacy to v2 encryption.
    
    Args:
        (same as decrypt_wallet_key)
        
    Returns:
        Dict of new DB fields if migration performed, None if already v2
    """
    scheme = encryption_scheme or SCHEME_LEGACY_FERNET_V1
    
    if scheme == SCHEME_KMS_AESGCM_V2:
        # Already v2, no migration needed
        return None
    
    # Decrypt with legacy
    private_key = decrypt_wallet_key(
        encrypted_private_key=encrypted_private_key,
        encryption_scheme=scheme,
        kms_wrapped_dek=kms_wrapped_dek,
        aesgcm_nonce=aesgcm_nonce,
        kms_key_id=kms_key_id,
        key_version=key_version,
    )
    
    try:
        # Re-encrypt with v2
        encrypted = encrypt_private_key_v2(private_key)
        return encode_for_db(encrypted)
    finally:
        # Best-effort clear
        if isinstance(private_key, str):
            # Can't truly clear a string in Python, but we can dereference
            del private_key


def rotate_wallet_key(
    wallet_row,
    new_kms_key_id: str,
    session=None,
    kms_client=None,
) -> bool:
    """
    Rotate a wallet's encryption to a new KMS key.

    1. Decrypts the wallet with the current key (v2 or legacy).
    2. Re-encrypts with the specified new KMS key ID.
    3. Updates the wallet row fields in the session.

    Args:
        wallet_row: SQLAlchemy wallet row with encryption fields.
        new_kms_key_id: The KMS key ARN/ID to re-encrypt with.
        session: Active DB session (required to persist changes).
        kms_client: Optional KMS client override.

    Returns:
        True on success, False on failure.
    """
    if kms_client is None:
        from bot.services.kms_client import get_kms_client
        kms_client = get_kms_client()

    try:
        # Step 1: Decrypt with current key
        private_key = decrypt_wallet_key(
            encrypted_private_key=wallet_row.encrypted_private_key,
            encryption_scheme=getattr(wallet_row, "encryption_scheme", None),
            kms_wrapped_dek=getattr(wallet_row, "kms_wrapped_dek", None),
            aesgcm_nonce=getattr(wallet_row, "aesgcm_nonce", None),
            kms_key_id=getattr(wallet_row, "kms_key_id", None),
            key_version=getattr(wallet_row, "key_version", None),
        )

        # Step 2: Re-encrypt with new KMS key
        encrypted = encrypt_private_key_v2(private_key, kms_client=kms_client)
        new_fields = encode_for_db(encrypted)

        # Step 3: Update wallet row
        if session is not None:
            for field_name, value in new_fields.items():
                if hasattr(wallet_row, field_name):
                    setattr(wallet_row, field_name, value)
            # Bump key_version
            current_version = getattr(wallet_row, "key_version", None) or 0
            wallet_row.key_version = current_version + 1
            session.flush()

        logger.info("Rotated wallet %s to new KMS key", wallet_row.id)
        return True

    except Exception as e:
        logger.error("Key rotation failed for wallet %s: %s", wallet_row.id, e)
        return False
    finally:
        # Best-effort clear plaintext
        private_key = None  # noqa: F841


def get_private_key_with_auto_migrate(
    wallet_row,
    session=None,
    auto_migrate: bool = True,
) -> str:
    """
    Get a decrypted private key, optionally auto-migrating legacy wallets.
    
    Args:
        wallet_row: SQLAlchemy wallet or hot_wallet row
        session: Optional DB session for migration commit
        auto_migrate: Whether to migrate legacy wallets to v2
        
    Returns:
        Decrypted private key string
    """
    from bot.config.settings import settings
    
    scheme = getattr(wallet_row, "encryption_scheme", None) or SCHEME_LEGACY_FERNET_V1
    
    # Decrypt
    private_key = decrypt_wallet_key(
        encrypted_private_key=wallet_row.encrypted_private_key,
        encryption_scheme=scheme,
        kms_wrapped_dek=getattr(wallet_row, "kms_wrapped_dek", None),
        aesgcm_nonce=getattr(wallet_row, "aesgcm_nonce", None),
        kms_key_id=getattr(wallet_row, "kms_key_id", None),
        key_version=getattr(wallet_row, "key_version", None),
    )
    
    # Auto-migrate if enabled and still on legacy
    if auto_migrate and settings.auto_migrate_legacy_wallets and scheme != SCHEME_KMS_AESGCM_V2:
        try:
            new_fields = migrate_to_v2(
                encrypted_private_key=wallet_row.encrypted_private_key,
                encryption_scheme=scheme,
            )
            
            if new_fields and session:
                for field, value in new_fields.items():
                    if hasattr(wallet_row, field):
                        setattr(wallet_row, field, value)
                session.flush()
                logger.info(f"Auto-migrated wallet {wallet_row.id} to v2 encryption")
        except Exception as e:
            logger.warning(f"Auto-migration failed for wallet {wallet_row.id}: {e}")
    
    return private_key

