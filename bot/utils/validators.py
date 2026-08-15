"""Input validation utilities."""

import re
from typing import Optional
from eth_utils import is_address as is_evm_address
import base58
import logging

logger = logging.getLogger(__name__)

# Try to import C++ core
try:
    import suwappu_core

    CPP_CORE_AVAILABLE = True
except ImportError:
    suwappu_core = None
    CPP_CORE_AVAILABLE = False


EVM_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def validate_evm_address(address: str) -> bool:
    """Validate an EVM (Ethereum-compatible) address.

    Requires 0x prefix, correct length, and rejects the zero address which
    would silently burn funds on-chain.
    """
    try:
        if not address.startswith("0x"):
            return False
        if address.lower() == EVM_ZERO_ADDRESS:
            return False
        return is_evm_address(address)
    except Exception:
        return False


def validate_solana_address(address: str) -> bool:
    """Validate a Solana address (base58 encoded 32-byte public key).

    Solana public keys are exactly 32 bytes when decoded. The base58 encoding
    of 32 bytes is 43 or 44 characters (44 normally; 43 when the leading byte
    is small, e.g. Wrapped SOL `So1111...112`). The decoded length is the real
    check — the char-length bound just rejects obviously-wrong inputs early.
    """
    try:
        if not (43 <= len(address) <= 44):
            return False
        decoded = base58.b58decode(address)
        return len(decoded) == 32
    except Exception:
        return False


def validate_tron_address(address: str) -> bool:
    """Validate a TRON address (base58check, starts with T, 34 chars)."""
    try:
        if not address.startswith("T") or len(address) != 34:
            return False
        decoded = base58.b58decode_check(address)
        return len(decoded) == 21 and decoded[0] == 0x41
    except Exception:
        return False


# STARK field prime: 2^251 + 17*2^192 + 1 — all Starknet felts (addresses,
# private keys) must be in (0, PRIME).
STARK_PRIME = 2**251 + 17 * 2**192 + 1


def validate_starknet_address(address: str) -> bool:
    """Validate a Starknet address (0x-prefixed hex felt, <= 66 chars).

    Starknet addresses are field elements: 0 < value < STARK_PRIME. The zero
    address is rejected (would burn funds).
    """
    try:
        if not address.startswith("0x"):
            return False
        if len(address) > 66:  # "0x" + up to 64 hex chars
            return False
        value = int(address, 16)
        return 0 < value < STARK_PRIME
    except Exception:
        return False


def is_valid_starknet_address(address: str) -> bool:
    """Alias for validate_starknet_address (naming parity with callers)."""
    return validate_starknet_address(address)


def validate_starknet_private_key(private_key: str) -> bool:
    """Validate a Starknet private key (0x-prefixed hex felt: 0 < key < STARK_PRIME).

    Policy: only 0x-prefixed hex is accepted — bare strings are ambiguous
    (hex vs decimal) and rejecting them avoids silently importing the wrong key.
    """
    try:
        key = private_key.strip()
        if not key.lower().startswith("0x"):
            return False
        value = int(key, 16)
        return 0 < value < STARK_PRIME
    except Exception:
        return False


def validate_address(address: str, chain_type: str = "evm") -> bool:
    """
    Validate a blockchain address.

    Args:
        address: The address to validate
        chain_type: "evm", "solana", "tron", or "starknet"

    Returns:
        True if valid, False otherwise
    """
    if chain_type == "solana":
        return validate_solana_address(address)
    if chain_type == "tron":
        return validate_tron_address(address)
    if chain_type == "starknet":
        return validate_starknet_address(address)
    return validate_evm_address(address)


def detect_address_chain(address: str) -> tuple[bool, Optional[str]]:
    """Detect whether a string is a contract/token address and which chain family.

    Used by paste-to-trade: a user pastes a raw token address with no command.
    Returns (is_valid, chain_type) where chain_type is one of
    "evm" | "starknet" | "tron" | "solana", or (False, None) if not an address.

    Order matters: EVM addresses are exactly 42 chars (0x + 40 hex); Starknet
    felts share the 0x prefix but run longer, so EVM is tested first. TRON and
    Solana are base58 and unambiguous by prefix/length.
    """
    if not address:
        return False, None
    s = address.strip()
    if s.startswith("0x") or s.startswith("0X"):
        if validate_evm_address(s):
            return True, "evm"
        # Real Starknet contract addresses are long felts (~64 hex chars); the
        # >=50 floor rejects short 0x junk like "0x123" that is technically a
        # valid felt but never a token address.
        if len(s) >= 50 and validate_starknet_address(s):
            return True, "starknet"
        return False, None
    if s.startswith("T") and len(s) == 34:
        return (True, "tron") if validate_tron_address(s) else (False, None)
    if validate_solana_address(s):
        return True, "solana"
    return False, None


def validate_evm_private_key(private_key: str) -> bool:
    """Validate an EVM private key (64 hex characters, optionally with 0x prefix)."""
    key = private_key.lower()
    if key.startswith("0x"):
        key = key[2:]

    if len(key) != 64:
        return False

    return bool(re.match(r"^[0-9a-f]{64}$", key))


def validate_solana_private_key(private_key: str) -> bool:
    """Validate a Solana private key (base58 encoded or raw bytes as list)."""
    try:
        # Try base58 decoding
        decoded = base58.b58decode(private_key)
        # Solana keypair is 64 bytes (32 secret + 32 public)
        return len(decoded) in [32, 64]
    except Exception:
        # Try parsing as JSON array of bytes
        try:
            import json

            data = json.loads(private_key)
            if isinstance(data, list) and len(data) in [32, 64]:
                return all(isinstance(b, int) and 0 <= b <= 255 for b in data)
        except Exception:
            pass
    return False


def validate_tron_private_key(private_key: str) -> bool:
    """Validate a TRON private key (64 hex chars, same as EVM — secp256k1)."""
    return validate_evm_private_key(private_key)


def validate_private_key(private_key: str, chain_type: str = "evm") -> bool:
    """
    Validate a private key.

    Args:
        private_key: The private key to validate
        chain_type: "evm", "solana", "tron", or "starknet"

    Returns:
        True if valid, False otherwise
    """
    if chain_type == "solana":
        return validate_solana_private_key(private_key)
    if chain_type == "tron":
        return validate_tron_private_key(private_key)
    if chain_type == "starknet":
        return validate_starknet_private_key(private_key)
    return validate_evm_private_key(private_key)


MAX_AMOUNT = 10_000_000  # $10M max per swap
MAX_INPUT_LENGTH = 50  # Max chars for amount input


def validate_amount(amount_str: str) -> Optional[float]:
    """
    Validate and parse an amount string.

    Args:
        amount_str: Amount as string (e.g., "100", "50.5", "1,000.00")

    Returns:
        Parsed float amount or None if invalid
    """
    try:
        if len(amount_str) > MAX_INPUT_LENGTH:
            return None

        # Remove commas and whitespace
        clean = amount_str.replace(",", "").replace(" ", "").strip()

        # Parse as float
        amount = float(clean)

        # Must be positive
        if amount <= 0:
            return None

        # Cap at maximum amount
        if amount > MAX_AMOUNT:
            return None

        return amount
    except (ValueError, TypeError):
        return None


def validate_slippage(slippage_str: str) -> Optional[int]:
    """Validate and parse slippage as basis points."""
    try:
        slippage = float(slippage_str)

        # Native C++ validation
        if CPP_CORE_AVAILABLE:
            try:
                # Convert to bps for C++ method
                bps = int(slippage * 100)
                if suwappu_core.NativeQuoteValidator.validate_slippage(bps, 1000):
                    return bps
            except Exception:
                pass

        # Must be between 0.01% and 50%
        if slippage < 0.01 or slippage > 50:
            return None

        # Convert to basis points
        return int(slippage * 100)
    except (ValueError, TypeError):
        return None
