"""Encryption utilities for securing private keys."""

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64
import os


def derive_key(password: str, salt: bytes = None) -> tuple[bytes, bytes]:
    """Derive an encryption key from a password using PBKDF2."""
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
    """
    Encrypt a private key using Fernet symmetric encryption.
    
    Args:
        private_key: The private key to encrypt (hex string for EVM, base58 for Solana)
        encryption_key: The master encryption key from settings
        
    Returns:
        Encrypted private key as a base64 string with salt prepended
    """
    # Generate a unique salt for this key
    key, salt = derive_key(encryption_key)
    
    fernet = Fernet(key)
    encrypted = fernet.encrypt(private_key.encode())
    
    # Prepend salt to encrypted data
    result = base64.urlsafe_b64encode(salt + encrypted)
    return result.decode()


def decrypt_private_key(encrypted_data: str, encryption_key: str) -> str:
    """
    Decrypt an encrypted private key.
    
    Args:
        encrypted_data: The encrypted private key (base64 string with salt)
        encryption_key: The master encryption key from settings
        
    Returns:
        Decrypted private key string
    """
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

