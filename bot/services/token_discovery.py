"""Token discovery service for trending tokens, new pools, and smart money.

Aggregates data from multiple sources to surface trading opportunities:
- Trending tokens by volume/price change
- New liquidity pools (from launch detector)
- Smart money activity (from copy trading)
"""

import logging
import time
from typing import Dict, List, Optional
from dataclasses import dataclass, field

from bot.services.price_service import price_service

logger = logging.getLogger(__name__)


@dataclass
class DiscoveryToken:
    """A token surfaced by the discovery engine."""
    symbol: str
    name: str = ""
    chain: str = "solana"
    address: Optional[str] = None

    # Price data
    price_usd: float = 0
    price_change_24h: float = 0  # percentage
    volume_24h: float = 0

    # Discovery metadata
    market_cap: float = 0
    holder_count: int = 0
    liquidity_usd: float = 0
    age_hours: float = 0

    # Safety
    safety_score: Optional[int] = None

    # Source of discovery
    source: str = "trending"  # trending, new_pool, smart_money, gainers, losers

    fetched_at: float = 0


class TokenDiscoveryService:
    """Service for discovering tradeable tokens."""

    CACHE_TTL = 60  # 1 minute

    def __init__(self):
        self._cache: Dict[str, List[DiscoveryToken]] = {}
        self._cache_times: Dict[str, float] = {}

    def _is_cached(self, key: str) -> bool:
        return key in self._cache and (time.time() - self._cache_times.get(key, 0)) < self.CACHE_TTL

    async def get_trending(self, chain: str = "all", limit: int = 20) -> List[DiscoveryToken]:
        """Get trending tokens by volume and price change.

        Args:
            chain: Filter by chain or "all"
            limit: Max results

        Returns:
            List of trending tokens sorted by volume
        """
        cache_key = f"trending:{chain}"
        if self._is_cached(cache_key):
            return self._cache[cache_key][:limit]

        tokens = []

        # Get prices for popular tokens
        popular_tokens = [
            "ETH", "SOL", "BTC", "BONK", "WIF", "PEPE", "SHIB",
            "DOGE", "MATIC", "ARB", "OP", "LINK", "UNI", "AAVE",
            "JTO", "PYTH", "JUP", "RNDR", "INJ", "TIA",
        ]

        try:
            prices = await price_service.get_prices(popular_tokens)

            for symbol in popular_tokens:
                price = prices.get(symbol, 0)
                if price <= 0:
                    continue

                change = 0
                try:
                    change = await price_service.get_token_change_24h(symbol)
                except Exception:
                    pass

                tokens.append(DiscoveryToken(
                    symbol=symbol,
                    price_usd=price,
                    price_change_24h=change,
                    source="trending",
                    fetched_at=time.time(),
                ))

        except Exception as e:
            logger.error(f"Failed to fetch trending tokens: {e}")

        # Sort by absolute price change (most volatile first)
        tokens.sort(key=lambda t: abs(t.price_change_24h), reverse=True)

        self._cache[cache_key] = tokens
        self._cache_times[cache_key] = time.time()

        return tokens[:limit]

    async def get_top_gainers(self, chain: str = "all", limit: int = 10) -> List[DiscoveryToken]:
        """Get top gaining tokens in the last 24h."""
        trending = await self.get_trending(chain, limit=50)
        gainers = [t for t in trending if t.price_change_24h > 0]
        gainers.sort(key=lambda t: t.price_change_24h, reverse=True)
        return gainers[:limit]

    async def get_top_losers(self, chain: str = "all", limit: int = 10) -> List[DiscoveryToken]:
        """Get top losing tokens in the last 24h."""
        trending = await self.get_trending(chain, limit=50)
        losers = [t for t in trending if t.price_change_24h < 0]
        losers.sort(key=lambda t: t.price_change_24h)
        return losers[:limit]

    async def get_new_pools(self, chain: str = "solana", limit: int = 10) -> List[DiscoveryToken]:
        """Get recently launched tokens/pools from the launch detector.

        Integrates with the existing launch_detector service.
        """
        cache_key = f"new_pools:{chain}"
        if self._is_cached(cache_key):
            return self._cache[cache_key][:limit]

        tokens = []

        try:
            from bot.services.sniping.launch_detector import launch_detector
            recent = launch_detector.get_recent_launches(limit=limit)

            for launch in recent:
                tokens.append(DiscoveryToken(
                    symbol=getattr(launch, "token_symbol", "???"),
                    name=getattr(launch, "token_name", ""),
                    chain=chain,
                    address=getattr(launch, "token_address", None),
                    source="new_pool",
                    age_hours=getattr(launch, "age_hours", 0),
                    liquidity_usd=getattr(launch, "liquidity_usd", 0),
                    fetched_at=time.time(),
                ))
        except Exception as e:
            logger.debug(f"Launch detector not available: {e}")

        self._cache[cache_key] = tokens
        self._cache_times[cache_key] = time.time()

        return tokens[:limit]

    async def get_smart_money_buys(self, limit: int = 10) -> List[DiscoveryToken]:
        """Get tokens being bought by tracked smart money wallets.

        Integrates with the copy trading service.
        """
        cache_key = "smart_money"
        if self._is_cached(cache_key):
            return self._cache[cache_key][:limit]

        tokens = []

        try:
            from bot.services.copy_service import copy_service
            recent_trades = copy_service.get_recent_leader_trades(limit=20)

            # Aggregate by token
            token_counts: Dict[str, int] = {}
            for trade in recent_trades:
                sym = getattr(trade, "to_token", None)
                if sym:
                    token_counts[sym] = token_counts.get(sym, 0) + 1

            # Get prices for these tokens
            if token_counts:
                prices = await price_service.get_prices(list(token_counts.keys()))
                for symbol, count in sorted(token_counts.items(), key=lambda x: x[1], reverse=True):
                    tokens.append(DiscoveryToken(
                        symbol=symbol,
                        price_usd=prices.get(symbol, 0),
                        source="smart_money",
                        fetched_at=time.time(),
                    ))
        except Exception as e:
            logger.debug(f"Copy service not available for smart money: {e}")

        self._cache[cache_key] = tokens
        self._cache_times[cache_key] = time.time()

        return tokens[:limit]

    def format_discovery_message(
        self,
        tokens: List[DiscoveryToken],
        title: str = "Trending Tokens",
    ) -> str:
        """Format a list of discovery tokens for Telegram display."""
        if not tokens:
            return f"*{title}*\n\n_No tokens found._"

        lines = [f"*{title}*\n"]

        for i, token in enumerate(tokens[:10], 1):
            change = token.price_change_24h
            arrow = "\U0001f7e2" if change >= 0 else "\U0001f534"
            sign = "+" if change >= 0 else ""

            price_str = f"${token.price_usd:.6f}" if token.price_usd < 1 else f"${token.price_usd:.2f}"

            line = f"{i}. {arrow} *{token.symbol}* {price_str} ({sign}{change:.1f}%)"

            if token.safety_score is not None:
                line += f" [{token.safety_score}/100]"

            lines.append(line)

        return "\n".join(lines)


# Global instance
discovery_service = TokenDiscoveryService()
