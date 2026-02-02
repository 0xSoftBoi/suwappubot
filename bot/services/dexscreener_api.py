"""DexScreener API client for token pair and market data.

API docs: https://docs.dexscreener.com/api/reference
Free tier, no API key required.
"""

import logging
from typing import Optional
from dataclasses import dataclass
from datetime import datetime

from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter
from bot.utils.cache import AsyncCache
from bot.utils.retry import async_retry
from bot.utils.performance import track_time, MetricNames

logger = logging.getLogger(__name__)

# Cache for pair data (60s TTL)
dexscreener_cache = AsyncCache(default_ttl=60)


class DexScreenerError(Exception):
    """DexScreener API error."""
    def __init__(self, message: str, status_code: int = 0):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class DexScreenerPair:
    """Token pair data from DexScreener."""
    pair_address: str
    base_token_name: str
    base_token_symbol: str
    base_token_address: str
    quote_token_symbol: str
    price_usd: Optional[float] = None
    price_native: Optional[float] = None
    volume_24h: float = 0
    price_change_5m: float = 0
    price_change_1h: float = 0
    price_change_6h: float = 0
    price_change_24h: float = 0
    liquidity_usd: float = 0
    fdv: Optional[float] = None
    market_cap: Optional[float] = None
    pair_created_at: Optional[datetime] = None
    url: str = ""
    txns_buys_24h: int = 0
    txns_sells_24h: int = 0


def _parse_pair(data: dict) -> DexScreenerPair:
    """Parse a single pair from DexScreener response."""
    base_token = data.get("baseToken", {})
    quote_token = data.get("quoteToken", {})
    price_change = data.get("priceChange", {})
    liquidity = data.get("liquidity", {})
    txns = data.get("txns", {})
    buys_24h = txns.get("h24", {}).get("buys", 0)
    sells_24h = txns.get("h24", {}).get("sells", 0)

    created_at = None
    if data.get("pairCreatedAt"):
        try:
            created_at = datetime.fromtimestamp(data["pairCreatedAt"] / 1000)
        except (ValueError, TypeError, OSError):
            pass

    price_usd = None
    if data.get("priceUsd"):
        try:
            price_usd = float(data["priceUsd"])
        except (ValueError, TypeError):
            pass

    price_native = None
    if data.get("priceNative"):
        try:
            price_native = float(data["priceNative"])
        except (ValueError, TypeError):
            pass

    return DexScreenerPair(
        pair_address=data.get("pairAddress", ""),
        base_token_name=base_token.get("name", ""),
        base_token_symbol=base_token.get("symbol", ""),
        base_token_address=base_token.get("address", ""),
        quote_token_symbol=quote_token.get("symbol", ""),
        price_usd=price_usd,
        price_native=price_native,
        volume_24h=float(data.get("volume", {}).get("h24", 0) or 0),
        price_change_5m=float(price_change.get("m5", 0) or 0),
        price_change_1h=float(price_change.get("h1", 0) or 0),
        price_change_6h=float(price_change.get("h6", 0) or 0),
        price_change_24h=float(price_change.get("h24", 0) or 0),
        liquidity_usd=float(liquidity.get("usd", 0) or 0),
        fdv=float(data["fdv"]) if data.get("fdv") else None,
        market_cap=float(data["marketCap"]) if data.get("marketCap") else None,
        pair_created_at=created_at,
        url=data.get("url", ""),
        txns_buys_24h=int(buys_24h or 0),
        txns_sells_24h=int(sells_24h or 0),
    )


class DexScreenerAPI:
    """DexScreener API client."""

    BASE_URL = "https://api.dexscreener.com"

    # DexScreener chain slugs
    CHAIN_MAP = {
        "ethereum": "ethereum",
        "bsc": "bsc",
        "polygon": "polygon",
        "arbitrum": "arbitrum",
        "optimism": "optimism",
        "base": "base",
        "avalanche": "avalanche",
        "fantom": "fantom",
        "solana": "solana",
    }

    @track_time(MetricNames.API_DEXSCREENER)
    @async_retry(max_attempts=2, delay=0.5)
    async def get_token_pairs(
        self, chain: str, token_address: str
    ) -> list[DexScreenerPair]:
        """
        Get all trading pairs for a token on a specific chain.

        Args:
            chain: Chain name (e.g. "ethereum", "solana")
            token_address: Token contract address

        Returns:
            List of DexScreenerPair sorted by liquidity (highest first)
        """
        chain_slug = self.CHAIN_MAP.get(chain)
        if not chain_slug:
            raise DexScreenerError(f"Unsupported chain: {chain}")

        # Check cache
        cache_key = f"dexscreener:pairs:{chain_slug}:{token_address.lower()}"
        cached = await dexscreener_cache.get(cache_key)
        if cached is not None:
            return cached

        await api_limiter.wait_and_acquire("dexscreener")
        session = await get_session()

        url = f"{self.BASE_URL}/latest/dex/tokens/{token_address}"

        async with session.get(url) as response:
            if response.status != 200:
                raise DexScreenerError(
                    f"DexScreener API returned {response.status}",
                    status_code=response.status,
                )

            data = await response.json()

        pairs_data = data.get("pairs") or []

        # Filter to the requested chain
        pairs = [
            _parse_pair(p) for p in pairs_data
            if p.get("chainId") == chain_slug
        ]

        # Sort by liquidity descending
        pairs.sort(key=lambda p: p.liquidity_usd, reverse=True)

        # Cache result
        await dexscreener_cache.set(cache_key, pairs)
        return pairs

    @track_time(MetricNames.API_DEXSCREENER)
    @async_retry(max_attempts=2, delay=0.5)
    async def search_tokens(self, query: str) -> list[DexScreenerPair]:
        """
        Search for tokens by name/symbol/address.

        Args:
            query: Search query string

        Returns:
            List of matching DexScreenerPair
        """
        cache_key = f"dexscreener:search:{query.lower()}"
        cached = await dexscreener_cache.get(cache_key)
        if cached is not None:
            return cached

        await api_limiter.wait_and_acquire("dexscreener")
        session = await get_session()

        url = f"{self.BASE_URL}/latest/dex/search"
        params = {"q": query}

        async with session.get(url, params=params) as response:
            if response.status != 200:
                raise DexScreenerError(
                    f"DexScreener API returned {response.status}",
                    status_code=response.status,
                )

            data = await response.json()

        pairs_data = data.get("pairs") or []
        pairs = [_parse_pair(p) for p in pairs_data]

        await dexscreener_cache.set(cache_key, pairs)
        return pairs

    @track_time(MetricNames.API_DEXSCREENER)
    @async_retry(max_attempts=2, delay=0.5)
    async def get_pair(
        self, chain: str, pair_address: str
    ) -> Optional[DexScreenerPair]:
        """
        Get data for a specific trading pair.

        Args:
            chain: Chain name
            pair_address: Pair contract address

        Returns:
            DexScreenerPair or None if not found
        """
        chain_slug = self.CHAIN_MAP.get(chain)
        if not chain_slug:
            raise DexScreenerError(f"Unsupported chain: {chain}")

        cache_key = f"dexscreener:pair:{chain_slug}:{pair_address.lower()}"
        cached = await dexscreener_cache.get(cache_key)
        if cached is not None:
            return cached

        await api_limiter.wait_and_acquire("dexscreener")
        session = await get_session()

        url = f"{self.BASE_URL}/latest/dex/pairs/{chain_slug}/{pair_address}"

        async with session.get(url) as response:
            if response.status != 200:
                raise DexScreenerError(
                    f"DexScreener API returned {response.status}",
                    status_code=response.status,
                )

            data = await response.json()

        pair_data = data.get("pair") or data.get("pairs", [None])[0] if data.get("pairs") else None
        if not pair_data:
            return None

        pair = _parse_pair(pair_data)
        await dexscreener_cache.set(cache_key, pair)
        return pair


# Global singleton
dexscreener_api = DexScreenerAPI()
