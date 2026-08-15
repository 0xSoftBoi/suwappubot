"""Background alert service for Discord channels.

Posts whale alerts, trending tokens, daily leaderboards, new listings,
and a real-time trade feed to configured Discord channels.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import discord
from discord.ext import tasks
from sqlalchemy import func, desc

from bot.config.settings import settings
from bot.models.swap import SwapTransaction
from bot.models.user import User
from bot.models.points import UserPoints
from bot.platforms.discord_embeds import (
    COLOR_ALERT,
    COLOR_LEADERBOARD,
    COLOR_SUCCESS,
    COLOR_INFO,
    build_leaderboard_embed,
)
from bot.utils.formatters import format_usd
from database.db import get_session

logger = logging.getLogger(__name__)

# Whale tiers
WHALE_TIERS = [
    (1_000_000, "\U0001f3e6"),  # $1M+  bank
    (500_000, "\U0001f433"),  # $500K+ whale
    (50_000, "\U0001f40b"),  # $50K+  whale
]

# Minimum USD value for the real-time trade feed (configurable at runtime)
DEFAULT_TRADE_FEED_THRESHOLD = 500.0


class DiscordAlertService:
    """Scheduled and event-driven Discord channel alerts."""

    def __init__(self):
        self._bot: Optional[discord.Client] = None
        self._trade_feed_threshold: float = DEFAULT_TRADE_FEED_THRESHOLD

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self, bot: discord.Client) -> None:
        """Attach to a running bot and start background loops."""
        self._bot = bot

        if not self.trending_tokens.is_running():
            self.trending_tokens.start()
        if not self.daily_leaderboard.is_running():
            self.daily_leaderboard.start()

        logger.info("DiscordAlertService started")

    def stop(self) -> None:
        """Cancel background loops."""
        self.trending_tokens.cancel()
        self.daily_leaderboard.cancel()
        logger.info("DiscordAlertService stopped")

    # ------------------------------------------------------------------
    # Channel helpers
    # ------------------------------------------------------------------

    async def _get_channel(self, channel_id_str: Optional[str]) -> Optional[discord.TextChannel]:
        """Resolve a settings channel ID string to a TextChannel."""
        if not channel_id_str or not self._bot:
            return None
        try:
            cid = int(channel_id_str)
        except (ValueError, TypeError):
            return None

        channel = self._bot.get_channel(cid)
        if channel is None:
            try:
                channel = await self._bot.fetch_channel(cid)
            except (discord.NotFound, discord.Forbidden):
                return None

        return channel if isinstance(channel, discord.TextChannel) else None

    # ------------------------------------------------------------------
    # Event-driven alerts (called externally)
    # ------------------------------------------------------------------

    async def whale_alert(self, trade: SwapTransaction) -> None:
        """Post to whale channel when a trade exceeds $50K."""
        usd_value = trade.from_amount_usd or 0
        if usd_value < 50_000:
            return

        channel = await self._get_channel(settings.discord_whale_channel_id)
        if channel is None:
            return

        # Pick emoji by tier
        emoji = "\U0001f40b"
        for threshold, tier_emoji in WHALE_TIERS:
            if usd_value >= threshold:
                emoji = tier_emoji
                break

        # Resolve username
        username = "Anonymous"
        with get_session() as session:
            user = session.query(User).filter(User.id == trade.user_id).first()
            if user:
                username = user.discord_username or user.username or f"User#{user.id}"

        embed = discord.Embed(
            title=f"{emoji} Whale Alert",
            description=(
                f"**{trade.from_token}** \u2192 **{trade.to_token}**\n"
                f"Value: **{format_usd(usd_value)}**"
            ),
            color=COLOR_ALERT,
        )
        embed.add_field(name="Trader", value=username, inline=True)
        embed.add_field(name="Chain", value=trade.from_chain, inline=True)
        if trade.is_cross_chain:
            embed.add_field(name="Dest Chain", value=trade.to_chain, inline=True)
        embed.timestamp = datetime.now(timezone.utc)

        try:
            await channel.send(embed=embed)
        except Exception as e:
            logger.error(f"Failed to send whale alert: {e}")

    async def new_listing_alert(self, token: Dict[str, Any]) -> None:
        """Post a new token listing to the alerts channel.

        `token` dict expected keys: name, symbol, chain, address, source.
        """
        channel = await self._get_channel(settings.discord_alerts_channel_id)
        if channel is None:
            return

        name = token.get("name", "Unknown")
        symbol = token.get("symbol", "???")
        chain = token.get("chain", "unknown")
        address = token.get("address", "")
        source = token.get("source", "launch_detector")

        embed = discord.Embed(
            title="\U0001f195 New Token Listing",
            description=f"**{name}** (`{symbol}`)",
            color=COLOR_SUCCESS,
        )
        embed.add_field(name="Chain", value=chain, inline=True)
        if address:
            short_addr = f"{address[:6]}...{address[-4:]}" if len(address) > 12 else address
            embed.add_field(name="Contract", value=f"`{short_addr}`", inline=True)
        embed.add_field(name="Source", value=source, inline=True)
        embed.timestamp = datetime.now(timezone.utc)

        try:
            await channel.send(embed=embed)
        except Exception as e:
            logger.error(f"Failed to send listing alert: {e}")

    async def trade_feed(self, trade: SwapTransaction) -> None:
        """Post trade to the real-time trade feed if above threshold."""
        usd_value = trade.from_amount_usd or 0
        if usd_value < self._trade_feed_threshold:
            return

        channel = await self._get_channel(settings.discord_alerts_channel_id)
        if channel is None:
            return

        # Resolve username
        username = "Anonymous"
        with get_session() as session:
            user = session.query(User).filter(User.id == trade.user_id).first()
            if user:
                username = user.discord_username or user.username or f"User#{user.id}"

        embed = discord.Embed(
            title="\U0001f504 Trade",
            description=(
                f"**{trade.from_token}** \u2192 **{trade.to_token}** | "
                f"**{format_usd(usd_value)}**"
            ),
            color=0x00BFFF,
        )
        embed.set_footer(text=f"{username} \u2022 {trade.from_chain}")
        embed.timestamp = datetime.now(timezone.utc)

        try:
            await channel.send(embed=embed)
        except Exception as e:
            logger.error(f"Failed to send trade feed: {e}")

    # ------------------------------------------------------------------
    # Scheduled tasks
    # ------------------------------------------------------------------

    @tasks.loop(hours=1)
    async def trending_tokens(self) -> None:
        """Post top trending tokens every hour."""
        channel = await self._get_channel(settings.discord_trending_channel_id)
        if channel is None:
            return

        # Aggregate most-traded tokens in the last hour
        with get_session() as session:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
            rows = (
                session.query(
                    SwapTransaction.to_token,
                    func.count(SwapTransaction.id).label("trade_count"),
                    func.coalesce(func.sum(SwapTransaction.from_amount_usd), 0).label("volume"),
                )
                .filter(
                    SwapTransaction.status == "completed",
                    SwapTransaction.created_at >= cutoff,
                )
                .group_by(SwapTransaction.to_token)
                .order_by(desc("volume"))
                .limit(10)
                .all()
            )

        if not rows:
            return

        lines = []
        medals = ["\U0001f947", "\U0001f948", "\U0001f949"]
        for i, (token, count, vol) in enumerate(rows):
            prefix = medals[i] if i < 3 else f"`#{i + 1}`"
            lines.append(
                f"{prefix} **{token}** \u2014 {count} trades \u2022 {format_usd(float(vol))}"
            )

        embed = discord.Embed(
            title="\U0001f525 Trending Tokens (Last Hour)",
            description="\n".join(lines),
            color=COLOR_INFO,
        )
        embed.timestamp = datetime.now(timezone.utc)

        try:
            await channel.send(embed=embed)
        except Exception as e:
            logger.error(f"Failed to send trending tokens: {e}")

    @trending_tokens.before_loop
    async def _before_trending(self) -> None:
        if self._bot:
            await self._bot.wait_until_ready()

    @tasks.loop(hours=24)
    async def daily_leaderboard(self) -> None:
        """Post the daily leaderboard."""
        channel = await self._get_channel(settings.discord_leaderboard_channel_id)
        if channel is None:
            return

        # Top 10 by 24h volume
        with get_session() as session:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
            rows = (
                session.query(
                    User,
                    func.coalesce(func.sum(SwapTransaction.from_amount_usd), 0).label("volume"),
                )
                .join(SwapTransaction, SwapTransaction.user_id == User.id)
                .filter(
                    SwapTransaction.status == "completed",
                    SwapTransaction.created_at >= cutoff,
                )
                .group_by(User.id)
                .order_by(desc("volume"))
                .limit(10)
                .all()
            )

        if not rows:
            return

        leaders = []
        for user, vol in rows:
            leaders.append(
                {
                    "username": user.discord_username or user.username or f"User#{user.id}",
                    "discord_username": user.discord_username,
                    "volume": float(vol),
                }
            )

        embed = build_leaderboard_embed(
            leaders, title="\U0001f3c6 Daily Leaderboard", category="volume"
        )
        embed.timestamp = datetime.now(timezone.utc)

        try:
            await channel.send(embed=embed)
        except Exception as e:
            logger.error(f"Failed to send daily leaderboard: {e}")

    @daily_leaderboard.before_loop
    async def _before_leaderboard(self) -> None:
        if self._bot:
            await self._bot.wait_until_ready()


# Global instance
discord_alert_service = DiscordAlertService()
