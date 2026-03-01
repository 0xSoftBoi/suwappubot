"""Sui wallet creation and management utilities."""

import logging
import base64
import hashlib
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


def create_sui_keypair() -> Tuple[str, bytes]:
    """
    Create a new Sui Ed25519 keypair.

    Returns:
        Tuple of (sui_address, private_key_bytes)
    """
    from nacl.signing import SigningKey

    # Generate Ed25519 keypair
    signing_key = SigningKey.generate()
    private_key = signing_key.encode()
    public_key = signing_key.verify_key.encode()

    # Sui address = BLAKE2b-256(0x00 || public_key)[0:32]
    # 0x00 is the Ed25519 scheme flag
    address_bytes = hashlib.blake2b(
        bytes([0x00]) + public_key,
        digest_size=32,
    ).digest()
    sui_address = "0x" + address_bytes.hex()

    return sui_address, private_key


def get_sui_address_from_private_key(private_key_bytes: bytes) -> str:
    """Derive Sui address from private key bytes."""
    from nacl.signing import SigningKey

    signing_key = SigningKey(private_key_bytes[:32])
    public_key = signing_key.verify_key.encode()

    address_bytes = hashlib.blake2b(
        bytes([0x00]) + public_key,
        digest_size=32,
    ).digest()
    return "0x" + address_bytes.hex()


def validate_sui_address(address: str) -> bool:
    """Validate a Sui address format."""
    if not address.startswith("0x"):
        return False
    try:
        addr_bytes = bytes.fromhex(address[2:])
        return len(addr_bytes) == 32
    except ValueError:
        return False
