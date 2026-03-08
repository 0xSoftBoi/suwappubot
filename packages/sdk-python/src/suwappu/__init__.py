"""Suwappu SDK — Cross-chain DEX SDK for AI agents.

Usage:
    from suwappu import create_client

    client = create_client(api_key="your_key")
    quote = await client.get_quote("ETH", "USDC", 1.0, "arbitrum")
    tx = await client.execute_swap(quote.id)
"""

from suwappu.client import SuwappuClient, SuwappuError, create_client
from suwappu.types import (
    Chain,
    LendingMarket,
    LendingMarketDetail,
    PerpMarket,
    PerpPosition,
    PerpQuote,
    PredictionMarket,
    PredictionMarketDetail,
    Quote,
    SuwappuConfig,
    SwapResult,
    Token,
    TokenBalance,
    TokenPrice,
)

__all__ = [
    "create_client",
    "SuwappuClient",
    "SuwappuError",
    "SuwappuConfig",
    "Quote",
    "SwapResult",
    "TokenBalance",
    "TokenPrice",
    "Chain",
    "Token",
    "PerpMarket",
    "PerpQuote",
    "PerpPosition",
    "PredictionMarket",
    "PredictionMarketDetail",
    "LendingMarket",
    "LendingMarketDetail",
]

__version__ = "0.1.0"
