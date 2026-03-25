"""Suwappu SDK — Cross-chain DEX SDK for AI agents.

Usage:
    from suwappu import create_client

    client = create_client(api_key="your_key")
    quote = await client.get_quote("ETH", "USDC", 1.0, "arbitrum")
    tx = await client.execute_swap(quote.id)
"""

from suwappu.client import SuwappuClient, SuwappuError, create_client
from suwappu.formatters import (
    format_amount,
    format_chain_name,
    format_compact,
    format_exchange_rate,
    format_min_received,
    format_network_fee,
    format_price_impact,
    format_relative_time,
    format_time_estimate,
    format_usd,
    format_usd_value,
    shorten_address,
    shorten_tx_hash,
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
    # Formatters
    "format_amount",
    "format_usd",
    "format_compact",
    "format_time_estimate",
    "format_relative_time",
    "shorten_address",
    "shorten_tx_hash",
    "format_chain_name",
    "format_exchange_rate",
    "format_price_impact",
    "format_min_received",
    "format_network_fee",
    "format_usd_value",
]

__version__ = "0.1.0"
