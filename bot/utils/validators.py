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

    Solana public keys are exactly 32 bytes when decoded. The base58
    encoding of 32 bytes is exactly 44 characters; lengths of 32–43 chars
    indicate a shorter byte sequence and are rejected.
    """
    try:
        # Solana base58 addresses are always exactly 44 characters.
        if len(address) != 44:
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


def validate_address(address: str, chain_type: str = "evm") -> bool:
    """
    Validate a blockchain address.

    Args:
        address: The address to validate
        chain_type: "evm", "solana", or "tron"

    Returns:
        True if valid, False otherwise
    """
    if chain_type == "solana":
        return validate_solana_address(address)
    if chain_type == "tron":
        return validate_tron_address(address)
    return validate_evm_address(address)


def validate_evm_private_key(private_key: str) -> bool:
    """Validate an EVM private key (64 hex characters, optionally with 0x prefix)."""
    key = private_key.lower()
    if key.startswith("0x"):
        key = key[2:]
    
    if len(key) != 64:
        return False
    
    return bool(re.match(r'^[0-9a-f]{64}$', key))


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
        chain_type: "evm", "solana", or "tron"

    Returns:
        True if valid, False otherwise
    """
    if chain_type == "solana":
        return validate_solana_private_key(private_key)
    if chain_type == "tron":
        return validate_tron_private_key(private_key)
    return validate_evm_private_key(private_key)


MAX_AMOUNT = 10_000_000  # $10M max per swap
MAX_INPUT_LENGTH = 50    # Max chars for amount input


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

