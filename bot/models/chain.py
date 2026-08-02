"""
Chain and Token models for runtime use.
These are dataclass representations used throughout the application.
Database models are in user.py and swap.py.
"""

from dataclasses import dataclass
from typing import Optional, Union


@dataclass
class Chain:
    """Runtime chain representation."""

    chain_id: Union[int, str]
    name: str
    display_name: str
    chain_type: str  # "evm" or "solana"
    native_token: str
    native_decimals: int
    rpc_url: str
    explorer_url: str
    logo_emoji: str

    def get_tx_url(self, tx_hash: str) -> str:
        """Get explorer URL for a transaction."""
        if self.chain_type == "solana":
            return f"{self.explorer_url}/tx/{tx_hash}"
        return f"{self.explorer_url}/tx/{tx_hash}"

    def get_address_url(self, address: str) -> str:
        """Get explorer URL for an address."""
        if self.chain_type == "solana":
            return f"{self.explorer_url}/account/{address}"
        return f"{self.explorer_url}/address/{address}"


@dataclass
class Token:
    """Runtime token representation."""

    symbol: str
    name: str
    address: str
    decimals: int
    chain_name: str
    logo_emoji: str
    is_stablecoin: bool = True

    def format_amount(self, amount_raw: int) -> float:
        """Convert raw amount to human-readable format."""
        return amount_raw / (10**self.decimals)

    def to_raw_amount(self, amount: float) -> int:
        """Convert human-readable amount to raw format."""
        return int(amount * (10**self.decimals))
