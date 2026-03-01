"""Discord channel alerts for whale trades and trending tokens."""

import logging
import asyncio
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import discord
    DISCORD_AVAILABLE = True
except ImportError:
    DISCORD_AVAILABLE = False


class DiscordAlertService:
    """Service for posting alerts to Discord channels."""

    def __init__(self):
        self._bot = None
        self._whale_channel_id: Optional[int] = None
        self._trending_channel_id: Optional[int] = None
        self._leaderboard_channel_id: Optional[int] = None

    def configure(
        self,
        bot,
        whale_channel_id: Optional[str] = None,
        trending_channel_id: Optional[str] = None,
        leaderboard_channel_id: Optional[str] = None,
    ):
        """Configure alert channels."""
        self._bot = bot
        self._whale_channel_id = int(whale_channel_id) if whale_channel_id else None
        self._trending_channel_id = int(trending_channel_id) if trending_channel_id else None
        self._leaderboard_channel_id = int(leaderboard_channel_id) if leaderboard_channel_id else None

    async def post_whale_alert(
        self,
        token: str,
        amount_usd: float,
        direction: str,  # "buy" or "sell"
        chain: str,
        tx_hash: Optional[str] = None,
    ):
        """Post a whale trade alert to Discord."""
        if not DISCORD_AVAILABLE or not self._bot or not self._whale_channel_id:
            return

        if amount_usd < 50_000:  # Only alert for trades > $50K
            return

        try:
            channel = self._bot.get_channel(self._whale_channel_id)
            if not channel:
                return

            emoji = "\U0001f40b" if amount_usd >= 500_000 else "\U0001f433" if amount_usd >= 100_000 else "\U0001f42c"
            direction_emoji = "\U0001f7e2" if direction == "buy" else "\U0001f534"

            embed = discord.Embed(
                title=f"{emoji} Whale Alert!",
                color=discord.Color.green() if direction == "buy" else discord.Color.red(),
            )
            embed.add_field(name="Token", value=token.upper(), inline=True)
            embed.add_field(name="Amount", value=f"${amount_usd:,.0f}", inline=True)
            embed.add_field(name="Direction", value=f"{direction_emoji} {direction.upper()}", inline=True)
            embed.add_field(name="Chain", value=chain.title(), inline=True)

            if tx_hash:
                embed.add_field(name="TX", value=f"`{tx_hash[:16]}...`", inline=True)

            embed.set_footer(text="Suwappu Whale Tracker")

            await channel.send(embed=embed)

        except Exception as e:
            logger.error(f"Failed to post whale alert: {e}")

    async def post_trending_tokens(self, tokens: list[dict]):
        """Post trending tokens to Discord channel."""
        if not DISCORD_AVAILABLE or not self._bot or not self._trending_channel_id:
            return

        try:
            channel = self._bot.get_channel(self._trending_channel_id)
            if not channel:
                return

            embed = discord.Embed(
                title="\U0001f525 Trending Tokens",
                color=discord.Color.orange(),
            )

            for i, token in enumerate(tokens[:10], 1):
                change = token.get("change_24h", 0)
                change_emoji = "\U0001f7e2" if change >= 0 else "\U0001f534"
                embed.add_field(
                    name=f"#{i} {token.get('symbol', '?')}",
                    value=f"${token.get('price', 0):,.4f} ({change_emoji} {change:+.1f}%)",
                    inline=True,
                )

            embed.set_footer(text="Updated hourly | Suwappu")

            await channel.send(embed=embed)

        except Exception as e:
            logger.error(f"Failed to post trending tokens: {e}")

    async def post_daily_leaderboard(self, leaders: list[dict]):
        """Post daily leaderboard to Discord channel."""
        if not DISCORD_AVAILABLE or not self._bot or not self._leaderboard_channel_id:
            return

        try:
            channel = self._bot.get_channel(self._leaderboard_channel_id)
            if not channel:
                return

            embed = discord.Embed(
                title="\U0001f3c6 Daily Trading Leaderboard",
                color=discord.Color.gold(),
            )

            medals = ["\U0001f947", "\U0001f948", "\U0001f949"]

            text = ""
            for i, leader in enumerate(leaders[:10]):
                medal = medals[i] if i < 3 else f"**{i+1}.**"
                text += (
                    f"{medal} {leader.get('username', 'Anon')} — "
                    f"${leader.get('volume', 0):,.0f} volume | "
                    f"{leader.get('xp', 0):,} XP\n"
                )

            embed.description = text or "No trading activity today."
            embed.set_footer(text="Suwappu Daily Leaderboard")

            await channel.send(embed=embed)

        except Exception as e:
            logger.error(f"Failed to post leaderboard: {e}")


# Global instance
discord_alerts = DiscordAlertService()
