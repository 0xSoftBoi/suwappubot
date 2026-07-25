"""Suwappu Python SDK — async client for the Suwappu cross-chain DEX API."""

from __future__ import annotations

from suwappu.client import (
    DEFAULT_BASE_URL,
    SuwappuApiError,
    SuwappuClient,
    SuwappuError,
    create_client,
)
from suwappu.types import (
    AgentErrorCode,
    AgentProfile,
    Chain,
    LendingMarket,
    LendingMarketDetail,
    PerpMarket,
    PerpPosition,
    PerpQuote,
    PredictionMarket,
    PredictionMarketDetail,
    Quote,
    RegisterAgentResult,
    RotateKeysResult,
    SuwappuConfig,
    SwapResult,
    Token,
    TokenBalance,
    TokenPrice,
    WalletPolicy,
    WebhookEvent,
    WebhookEventsResult,
    WebhookPagination,
    WebhookTestResult,
)

__version__ = "0.2.0"

__all__ = [
    "DEFAULT_BASE_URL",
    "create_client",
    "SuwappuClient",
    "SuwappuError",
    "SuwappuApiError",
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
    "AgentErrorCode",
    "AgentProfile",
    "RegisterAgentResult",
    "RotateKeysResult",
    "WalletPolicy",
    "WebhookEvent",
    "WebhookEventsResult",
    "WebhookPagination",
    "WebhookTestResult",
]
