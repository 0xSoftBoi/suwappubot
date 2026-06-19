"""Suwappu Python SDK — async client for the Suwappu cross-chain DEX API."""

from __future__ import annotations

from suwappu.client import (
    DEFAULT_BASE_URL,
    SuwappuClient,
    SuwappuError,
    create_client,
)
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

__version__ = "0.1.0"

__all__ = [
    "DEFAULT_BASE_URL",
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
