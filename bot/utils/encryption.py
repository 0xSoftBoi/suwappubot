"""Encryption utilities for securing private keys."""

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64
import os
import logging

logger = logging.getLogger(__name__)

# Try to import C++ core
try:
    import suwappu_core

    CPP_CORE_AVAILABLE = True
except ImportError:
    suwappu_core = None
    CPP_CORE_AVAILABLE = False


def derive_key(password: str, salt: bytes = None) -> tuple[bytes, bytes]:
    """Derive an encryption key from a password using PBKDF2."""
    if CPP_CORE_AVAILABLE:
        try:
            salt_str = base64.b64encode(salt).decode() if salt else ""
            key_b64, salt_b64 = suwappu_core.derive_key(password, salt_str)
            return base64.urlsafe_b64decode(key_b64), base64.b64decode(salt_b64)
        except Exception as e:
            logger.warning(f"C++ derive_key failed, using fallback: {e}")

    if salt is None:
        salt = os.urandom(16)

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=480000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
    return key, salt


def encrypt_private_key(private_key: str, encryption_key: str) -> str:
    """Encrypt a private key using native C++ or Fernet fallback."""
    if CPP_CORE_AVAILABLE:
        try:
            return suwappu_core.encrypt_private_key(private_key, encryption_key)
        except Exception as e:
            logger.warning(f"C++ encrypt failed, using fallback: {e}")

    # Generate a unique salt for this key
    key, salt = derive_key(encryption_key)

    fernet = Fernet(key)
    encrypted = fernet.encrypt(private_key.encode())

    # Prepend salt to encrypted data
    result = base64.urlsafe_b64encode(salt + encrypted)
    return result.decode()


def decrypt_private_key(encrypted_data: str, encryption_key: str) -> str:
    """Decrypt an encrypted private key using native C++ or Fernet fallback."""
    if CPP_CORE_AVAILABLE:
        try:
            return suwappu_core.decrypt_private_key(encrypted_data, encryption_key)
        except Exception as e:
            logger.warning(f"C++ decrypt failed, using fallback: {e}")

    # Decode and extract salt
    data = base64.urlsafe_b64decode(encrypted_data.encode())
    salt = data[:16]
    encrypted = data[16:]

    # Derive key using the same salt
    key, _ = derive_key(encryption_key, salt)

    fernet = Fernet(key)
    decrypted = fernet.decrypt(encrypted)
    return decrypted.decode()


def generate_encryption_key() -> str:
    """Generate a new random encryption key for use in .env."""
    return Fernet.generate_key().decode()
