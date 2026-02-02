"""Abstract base class for swap providers.

All swap provider implementations (Li.Fi, Jupiter, CoW, Socket, etc.)
should inherit from SwapProvider and implement the required methods.
This standardizes the interface and enables the circuit breaker and
parallel quote fetching in SwapEngine.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class ProviderQuote:
    """Standardized quote result from any provider.

    Individual providers may return richer data in ``raw_data``.
    """
    provider: str
    from_amount: str          # Raw amount (smallest unit)
    to_amount: str            # Raw amount (smallest unit)
    to_amount_min: str        # Minimum output after slippage
    gas_cost_usd: float
    fee_cost_usd: float
    estimated_time: int       # Seconds
    price_impact: float
    raw_data: dict            # Provider-specific data for execution


class SwapProvider(ABC):
    """Abstract base class that all swap providers must implement."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique provider identifier (e.g., 'lifi', 'jupiter', 'cow')."""
        ...

    @abstractmethod
    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        from_amount: str,
        from_address: str,
        to_address: Optional[str] = None,
        slippage: float = 0.5,
    ) -> ProviderQuote:
        """Get a quote for swapping tokens.

        Args:
            from_chain: Source chain name (e.g., 'ethereum', 'solana')
            to_chain: Destination chain name
            from_token: Source token address
            to_token: Destination token address
            from_amount: Amount in smallest unit (wei, lamports, etc.)
            from_address: Sender wallet address
            to_address: Receiver address (defaults to from_address)
            slippage: Slippage tolerance as percentage (0.5 = 0.5%)

        Returns:
            ProviderQuote with standardized quote data
        """
        ...

    @abstractmethod
    async def execute(
        self,
        quote: ProviderQuote,
        wallet_address: str,
        private_key_encrypted: str,
    ) -> dict:
        """Execute a swap using a previously obtained quote.

        Args:
            quote: Quote obtained from get_quote
            wallet_address: Wallet address to execute from
            private_key_encrypted: Encrypted private key for signing

        Returns:
            Dict with at least {'tx_hash': str, 'status': str}
        """
        ...

    def is_supported_route(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
    ) -> bool:
        """Check if this provider supports the given route.

        Override in subclasses to filter routes (e.g., Jupiter only
        supports Solana, CCIP only supports same-token cross-chain).
        Default: returns True (provider supports all routes).
        """
        return True
