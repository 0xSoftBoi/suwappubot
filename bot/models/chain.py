"""
Chain and Token models for runtime use.
These are dataclass representations used throughout the application.
Database models are in user.py and swap.py.
"""

from dataclasses import dataclass
from typing import Union


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
        """Get explorer URL for a transaction.

        The hash is canonicalized because stored EVM hashes come in two
        spellings (see bot/utils/tx_hash.py) and some explorers 404 on an
        unprefixed one. `self.chain_type` is passed through so Solana base58
        and TRON bare-hex are left exactly as they are.

        The import is function-local to keep this dataclass module a leaf:
        bot/models/ is imported early in the boot chain and must not pull in
        bot/utils/__init__.py at module scope.
        """
        from bot.utils.tx_hash import canonical_tx_hash

        return f"{self.explorer_url}/tx/{canonical_tx_hash(tx_hash, self.chain_type)}"

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
