"""Structured exception taxonomy for suwappubot.

Using typed error codes instead of bare string messages lets downstream code
(alerting, retry logic, client error responses) make decisions based on error
category rather than parsing human-readable text.
"""

from enum import IntEnum
from typing import Optional, Dict, Any


class ErrorCode(IntEnum):
    # Quote / routing
    PROVIDER_TIMEOUT = 1001
    PROVIDER_RATE_LIMIT = 1002
    NO_ROUTE_FOUND = 1003
    INSUFFICIENT_LIQUIDITY = 1004
    PRICE_IMPACT_TOO_HIGH = 1005

    # Execution
    CHAIN_NOT_SUPPORTED = 2001
    TOKEN_NOT_SUPPORTED = 2002
    INSUFFICIENT_BALANCE = 2003
    INSUFFICIENT_GAS = 2004
    APPROVAL_FAILED = 2005
    TRANSACTION_REVERTED = 2006
    SLIPPAGE_EXCEEDED = 2007
    SIMULATION_FAILED = 2008

    # Wallet / signing
    WALLET_NOT_FOUND = 3001
    SIGNING_FAILED = 3002
    DECRYPTION_FAILED = 3003

    # Infrastructure
    RPC_ERROR = 4001
    DB_ERROR = 4002
    CACHE_ERROR = 4003

    # Generic
    UNKNOWN = 9999


class SwapError(Exception):
    """Raised when a swap operation fails.

    Carries a machine-readable ``code`` so alerting and retry logic can act on
    error category rather than parsing the human-readable ``message``.
    """

    def __init__(
        self,
        message: str,
        code: ErrorCode = ErrorCode.UNKNOWN,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.details: Dict[str, Any] = details or {}

    def __repr__(self) -> str:
        return f"SwapError({self.code.name}={self.code.value}, {self.args[0]!r})"


class ValidationError(Exception):
    """Error during validation."""


class WalletError(Exception):
    """Error during wallet operations."""


class APIError(Exception):
    """Error from external API."""


class RateLimitError(Exception):
    """Rate limit exceeded."""
