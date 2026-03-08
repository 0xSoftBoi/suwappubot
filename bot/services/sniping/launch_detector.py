"""Unified launch detection service for token sniping.

This service orchestrates monitoring across multiple platforms:
- pump.fun (bonding curve launches)
- Raydium (AMM pool creation)
- pump.fun -> Raydium migrations

It provides:
1. Real-time detection of new token launches
2. Filtering by criteria (liquidity, age, etc.)
3. Scoring and prioritization of snipe opportunities
4. Integration with security services for safety checks
"""

import logging
import asyncio
from typing import Optional, Dict, Any, List, Callable, Set
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import re

from bot.config.settings import settings
from bot.services.sniping.pump_fun_api import (
    pump_fun_api,
    PumpFunToken,
    PumpFunTrade,
    PumpFunEventType,
)
from bot.services.sniping.raydium_monitor import (
    raydium_monitor,
    RaydiumPool,
    PoolCreationEvent,
    PoolType,
)

logger = logging.getLogger(__name__)


class LaunchPlatform(Enum):
    """Platform where token was launched."""
    PUMP_FUN = "pump_fun"
    RAYDIUM = "raydium"
    PUMP_FUN_MIGRATION = "pump_fun_migration"


class LaunchQuality(Enum):
    """Quality rating for a launch."""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    RISKY = "risky"


@dataclass
class TokenLaunch:
    """Detected token launch event."""
    token_mint: str
    platform: LaunchPlatform
    name: str
    symbol: str
    creator: str
    initial_liquidity_sol: float
    detected_at: datetime
    slot: Optional[int] = None
    signature: Optional[str] = None

    # Pricing
    initial_price_sol: float = 0
    current_price_sol: float = 0

    # Metadata
    description: str = ""
    image_uri: str = ""
    twitter: Optional[str] = None
    telegram: Optional[str] = None
    website: Optional[str] = None

    # For pump.fun
    bonding_curve: Optional[str] = None
    progress_percent: float = 0

    # For Raydium
    pool_id: Optional[str] = None
    pool_type: Optional[PoolType] = None

    # Quality assessment
    quality: LaunchQuality = LaunchQuality.MEDIUM
    quality_score: float = 50.0
    quality_reasons: List[str] = field(default_factory=list)

    # Safety (populated by security service)
    is_safe: Optional[bool] = None
    safety_score: float = 0
    safety_warnings: List[str] = field(default_factory=list)

    @property
    def age_seconds(self) -> float:
        """Seconds since detection."""
        return (datetime.utcnow() - self.detected_at).total_seconds()

    @property
    def is_fresh(self) -> bool:
        """Whether launch is very recent (<30s)."""
        return self.age_seconds < 30

    @property
    def has_socials(self) -> bool:
        """Whether token has any social links."""
        return bool(self.twitter or self.telegram or self.website)


@dataclass
class SnipeFilter:
    """Filters for which launches to alert on."""
    min_liquidity_sol: float = 1.0
    max_liquidity_sol: float = 1000.0
    min_quality_score: float = 30.0
    require_socials: bool = False
    platforms: List[LaunchPlatform] = field(default_factory=lambda: list(LaunchPlatform))
    blacklisted_creators: Set[str] = field(default_factory=set)
    blacklisted_tokens: Set[str] = field(default_factory=set)
    name_blacklist_patterns: List[str] = field(default_factory=list)

    def matches(self, launch: TokenLaunch) -> bool:
        """Check if launch matches filter criteria."""
        # Liquidity check
        if launch.initial_liquidity_sol < self.min_liquidity_sol:
            return False
        if launch.initial_liquidity_sol > self.max_liquidity_sol:
            return False

        # Quality check
        if launch.quality_score < self.min_quality_score:
            return False

        # Socials check
        if self.require_socials and not launch.has_socials:
            return False

        # Platform check
        if self.platforms and launch.platform not in self.platforms:
            return False

        # Blacklist checks
        if launch.creator in self.blacklisted_creators:
            return False
        if launch.token_mint in self.blacklisted_tokens:
            return False

        # Name pattern blacklist
        for pattern in self.name_blacklist_patterns:
            if re.search(pattern, launch.name, re.IGNORECASE):
                return False
            if re.search(pattern, launch.symbol, re.IGNORECASE):
                return False

        return True


class LaunchDetector:
    """Unified service for detecting token launches across platforms.

    Usage:
        detector = launch_detector  # Global instance

        # Register callback for launches
        detector.on_launch(async_callback)

        # Set filters
        detector.set_filter(SnipeFilter(min_liquidity_sol=5))

        # Start monitoring
        await detector.start()
    """

    def __init__(self):
        self._running = False
        self._callbacks: List[Callable[[TokenLaunch], None]] = []
        self._filter = SnipeFilter()
        self._recent_launches: Dict[str, TokenLaunch] = {}  # mint -> launch
        self._max_cache_size = 1000
        self._cache_ttl = 3600  # 1 hour

        # Track migration candidates
        self._migration_candidates: Dict[str, PumpFunToken] = {}

    def on_launch(self, callback: Callable[[TokenLaunch], None]):
        """Register callback for new token launches."""
        self._callbacks.append(callback)

    def set_filter(self, filter: SnipeFilter):
        """Set filter for which launches to alert on."""
        self._filter = filter

    def get_filter(self) -> SnipeFilter:
        """Get current filter."""
        return self._filter

    def get_recent_launches(
        self,
        limit: int = 50,
        platform: Optional[LaunchPlatform] = None,
    ) -> List[TokenLaunch]:
        """Get recently detected launches."""
        launches = list(self._recent_launches.values())

        # Filter by platform
        if platform:
            launches = [l for l in launches if l.platform == platform]

        # Sort by detection time (newest first)
        launches.sort(key=lambda l: l.detected_at, reverse=True)

        return launches[:limit]

    def get_launch(self, token_mint: str) -> Optional[TokenLaunch]:
        """Get a specific launch by token mint."""
        return self._recent_launches.get(token_mint)

    async def start(self):
        """Start monitoring all platforms for launches."""
        if self._running:
            return

        self._running = True

        # Register callbacks with platform monitors
        pump_fun_api.on_token_created(self._handle_pump_fun_launch)
        pump_fun_api.on_trade(self._handle_pump_fun_trade)
        pump_fun_api.on_migration(self._handle_pump_fun_migration)
        raydium_monitor.on_pool_created(self._handle_raydium_pool)

        # Start platform monitors
        await asyncio.gather(
            pump_fun_api.start(),
            raydium_monitor.start(),
        )

        # Start cleanup task
        asyncio.create_task(self._cleanup_loop())

        logger.info("Launch detector started")

    async def stop(self):
        """Stop monitoring."""
        self._running = False

        await asyncio.gather(
            pump_fun_api.stop(),
            raydium_monitor.stop(),
        )

        logger.info("Launch detector stopped")

    async def _handle_pump_fun_launch(self, token: PumpFunToken):
        """Handle new pump.fun token creation."""
        try:
            launch = TokenLaunch(
                token_mint=token.mint,
                platform=LaunchPlatform.PUMP_FUN,
                name=token.name,
                symbol=token.symbol,
                creator=token.creator,
                initial_liquidity_sol=0,  # pump.fun starts with 0 liquidity
                detected_at=datetime.utcnow(),
                initial_price_sol=token.price_sol,
                current_price_sol=token.price_sol,
                description=token.description,
                image_uri=token.image_uri,
                twitter=token.twitter,
                telegram=token.telegram,
                website=token.website,
                bonding_curve=token.bonding_curve,
                progress_percent=0,
            )

            # Score the launch
            self._score_launch(launch)

            # Cache it
            self._cache_launch(launch)

            # Check filter and notify
            if self._filter.matches(launch):
                await self._notify_launch(launch)

        except Exception as e:
            logger.error(f"Error handling pump.fun launch: {e}")

    async def _handle_pump_fun_trade(self, trade: PumpFunTrade):
        """Handle pump.fun trade - track progress toward migration."""
        try:
            # Update cached launch if exists
            launch = self._recent_launches.get(trade.mint)
            if launch:
                launch.current_price_sol = trade.price_sol
                # Estimate progress (rough calculation)
                total_sol = trade.virtual_sol_reserves / 1e9
                launch.progress_percent = min(100, (total_sol / 85) * 100)

                # Track migration candidates
                if launch.progress_percent >= 90:
                    token = await pump_fun_api.get_token(trade.mint)
                    if token:
                        self._migration_candidates[trade.mint] = token

        except Exception as e:
            logger.debug(f"Error handling pump.fun trade: {e}")

    async def _handle_pump_fun_migration(self, mint: str):
        """Handle pump.fun -> Raydium migration."""
        try:
            # Get token info
            token = self._migration_candidates.get(mint)
            if not token:
                token = await pump_fun_api.get_token(mint)

            if not token:
                return

            launch = TokenLaunch(
                token_mint=mint,
                platform=LaunchPlatform.PUMP_FUN_MIGRATION,
                name=token.name,
                symbol=token.symbol,
                creator=token.creator,
                initial_liquidity_sol=85,  # ~85 SOL at migration
                detected_at=datetime.utcnow(),
                initial_price_sol=token.price_sol,
                current_price_sol=token.price_sol,
                description=token.description,
                image_uri=token.image_uri,
                twitter=token.twitter,
                telegram=token.telegram,
                website=token.website,
                bonding_curve=token.bonding_curve,
                progress_percent=100,
            )

            # Migration events are high priority
            launch.quality = LaunchQuality.HIGH
            launch.quality_score = 80

            self._cache_launch(launch)

            if self._filter.matches(launch):
                await self._notify_launch(launch)

            # Remove from migration candidates
            self._migration_candidates.pop(mint, None)

        except Exception as e:
            logger.error(f"Error handling pump.fun migration: {e}")

    async def _handle_raydium_pool(self, event: PoolCreationEvent):
        """Handle new Raydium pool creation."""
        try:
            pool = event.pool

            # Only care about SOL pairs
            if not pool.is_sol_pair:
                return

            launch = TokenLaunch(
                token_mint=pool.token_mint,
                platform=LaunchPlatform.RAYDIUM,
                name="",  # Need to fetch metadata
                symbol="",
                creator=event.creator,
                initial_liquidity_sol=event.initial_liquidity_sol,
                detected_at=event.timestamp,
                slot=event.slot,
                signature=event.signature,
                initial_price_sol=pool.initial_price,
                current_price_sol=pool.initial_price,
                pool_id=pool.pool_id,
                pool_type=pool.pool_type,
            )

            # Score the launch
            self._score_launch(launch)

            self._cache_launch(launch)

            if self._filter.matches(launch):
                await self._notify_launch(launch)

        except Exception as e:
            logger.error(f"Error handling Raydium pool: {e}")

    def _score_launch(self, launch: TokenLaunch):
        """Calculate quality score for a launch."""
        score = 50.0
        reasons = []

        # Liquidity scoring
        if launch.initial_liquidity_sol >= 50:
            score += 20
            reasons.append("High liquidity")
        elif launch.initial_liquidity_sol >= 10:
            score += 10
            reasons.append("Good liquidity")
        elif launch.initial_liquidity_sol < 1:
            score -= 20
            reasons.append("Very low liquidity")

        # Social presence
        if launch.twitter:
            score += 10
            reasons.append("Has Twitter")
        if launch.telegram:
            score += 5
            reasons.append("Has Telegram")
        if launch.website:
            score += 5
            reasons.append("Has website")

        # Platform scoring
        if launch.platform == LaunchPlatform.PUMP_FUN_MIGRATION:
            score += 15
            reasons.append("Graduated from pump.fun")
        elif launch.platform == LaunchPlatform.RAYDIUM:
            score += 5
            reasons.append("Direct Raydium launch")

        # Name/symbol quality (penalize obvious scams)
        suspicious_patterns = [
            r"\d{3,}",  # Multiple numbers
            r"test",  # Test tokens
            r"fake",
            r"scam",
            r"rug",
        ]
        for pattern in suspicious_patterns:
            if re.search(pattern, launch.name, re.IGNORECASE) or \
               re.search(pattern, launch.symbol, re.IGNORECASE):
                score -= 30
                reasons.append(f"Suspicious name/symbol")
                break

        # Clamp score
        score = max(0, min(100, score))

        # Determine quality tier
        if score >= 70:
            quality = LaunchQuality.HIGH
        elif score >= 50:
            quality = LaunchQuality.MEDIUM
        elif score >= 30:
            quality = LaunchQuality.LOW
        else:
            quality = LaunchQuality.RISKY

        launch.quality_score = score
        launch.quality = quality
        launch.quality_reasons = reasons

    def _cache_launch(self, launch: TokenLaunch):
        """Cache a launch."""
        self._recent_launches[launch.token_mint] = launch

        # Cleanup old entries if cache is too large
        if len(self._recent_launches) > self._max_cache_size:
            # Remove oldest entries
            sorted_launches = sorted(
                self._recent_launches.items(),
                key=lambda x: x[1].detected_at
            )
            for mint, _ in sorted_launches[:100]:
                self._recent_launches.pop(mint, None)

    async def _notify_launch(self, launch: TokenLaunch):
        """Notify all registered callbacks of a launch."""
        for callback in self._callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(launch)
                else:
                    callback(launch)
            except Exception as e:
                logger.error(f"Error in launch callback: {e}")

    async def _cleanup_loop(self):
        """Periodically cleanup old cached launches."""
        while self._running:
            try:
                cutoff = datetime.utcnow() - timedelta(seconds=self._cache_ttl)

                to_remove = [
                    mint for mint, launch in self._recent_launches.items()
                    if launch.detected_at < cutoff
                ]

                for mint in to_remove:
                    self._recent_launches.pop(mint, None)

                # Also cleanup migration candidates
                self._migration_candidates = {
                    k: v for k, v in self._migration_candidates.items()
                    if k in self._recent_launches
                }

            except Exception as e:
                logger.error(f"Error in cleanup loop: {e}")

            await asyncio.sleep(300)  # Run every 5 minutes


# Global instance
launch_detector = LaunchDetector()
