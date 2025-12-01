"""Input validation utilities."""

import re
from typing import Optional
from eth_utils import is_address as is_evm_address
import base58


def validate_evm_address(address: str) -> bool:
    """Validate an EVM (Ethereum-compatible) address."""
    try:
        return is_evm_address(address)
    except Exception:
        return False


def validate_solana_address(address: str) -> bool:
    """Validate a Solana address (base58 encoded public key)."""
    try:
        decoded = base58.b58decode(address)
        return len(decoded) == 32
    except Exception:
        return False


def validate_address(address: str, chain_type: str = "evm") -> bool:
    """
    Validate a blockchain address.
    
    Args:
        address: The address to validate
        chain_type: "evm" or "solana"
        
    Returns:
        True if valid, False otherwise
    """
    if chain_type == "solana":
        return validate_solana_address(address)
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


def validate_private_key(private_key: str, chain_type: str = "evm") -> bool:
    """
    Validate a private key.
    
    Args:
        private_key: The private key to validate
        chain_type: "evm" or "solana"
        
    Returns:
        True if valid, False otherwise
    """
    if chain_type == "solana":
        return validate_solana_private_key(private_key)
    return validate_evm_private_key(private_key)


def validate_amount(amount_str: str) -> Optional[float]:
    """
    Validate and parse an amount string.
    
    Args:
        amount_str: Amount as string (e.g., "100", "50.5", "1,000.00")
        
    Returns:
        Parsed float amount or None if invalid
    """
    try:
        # Remove commas and whitespace
        clean = amount_str.replace(",", "").replace(" ", "").strip()
        
        # Parse as float
        amount = float(clean)
        
        # Must be positive
        if amount <= 0:
            return None
            
        return amount
    except (ValueError, TypeError):
        return None


def validate_slippage(slippage_str: str) -> Optional[int]:
    """
    Validate and parse slippage as basis points.
    
    Args:
        slippage_str: Slippage as percentage string (e.g., "0.5", "1")
        
    Returns:
        Slippage in basis points (e.g., 50 for 0.5%) or None if invalid
    """
    try:
        slippage = float(slippage_str)
        
        # Must be between 0.01% and 50%
        if slippage < 0.01 or slippage > 50:
            return None
        
        # Convert to basis points
        return int(slippage * 100)
    except (ValueError, TypeError):
        return None

