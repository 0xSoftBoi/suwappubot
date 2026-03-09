"""Discord Cog for thread-based trade discussions."""

import logging
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands

from bot.config.settings import settings
from bot.models.swap import SwapTransaction
from bot.platforms.discord_embeds import COLOR_SWAP, COLOR_INFO
from bot.services.price_service import price_service
from bot.utils.formatters import format_usd
from database.db import get_session

logger = logging.getLogger(__name__)

# Minimum trade value to auto-create a thread
THREAD_TRADE_THRESHOLD_USD = 1_000


class Threads(commands.Cog):
    """Auto-create threads for large trades and token discussions."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get_alerts_channel(self) -> Optional[int]:
        """Return the configured channel for trade threads."""
        cid = settings.discord_alerts_channel_id
        return int(cid) if cid else None

    async def create_trade_thread(self, trade: SwapTransaction) -> Optional[discord.Thread]:
        """Auto-create a public thread for a large trade.

        Called externally (e.g., from swap engine) when a swap completes.
        Skips silently if the trade is below threshold or channel is not configured.
        """
        usd_value = trade.from_amount_usd or 0
        if usd_value < THREAD_TRADE_THRESHOLD_USD:
            return None

        channel_id = self._get_alerts_channel()
        if not channel_id:
            return None

        channel = self.bot.get_channel(channel_id)
        if channel is None:
            try:
                channel = await self.bot.fetch_channel(channel_id)
            except discord.NotFound:
                logger.warning(f"Alerts channel {channel_id} not found")
                return None

        if not isinstance(channel, discord.TextChannel):
            return None

        thread_name = f"\U0001F504 {trade.from_token}\u2192{trade.to_token} | {format_usd(usd_value)}"
        # Discord thread name max 100 chars
        thread_name = thread_name[:100]

        try:
            # Create a starter message in the channel
            embed = discord.Embed(
                title=f"\U0001F504 Large Trade Detected",
                description=(
                    f"**{trade.from_token}** \u2192 **{trade.to_token}**\n"
                    f"Value: **{format_usd(usd_value)}**\n"
                    f"Chain: `{trade.from_chain}`"
                    + (f" \u2192 `{trade.to_chain}`" if trade.is_cross_chain else "")
                ),
                color=COLOR_SWAP,
            )
            if trade.tx_hash:
                short = f"{trade.tx_hash[:10]}...{trade.tx_hash[-6:]}"
                embed.add_field(name="Tx", value=f"`{short}`", inline=False)

            msg = await channel.send(embed=embed)

            thread = await msg.create_thread(
                name=thread_name,
                auto_archive_duration=1440,  # 24 hours
                reason="Auto-thread for large trade",
            )
            logger.info(f"Created trade thread: {thread_name}")
            return thread

        except discord.Forbidden:
            logger.warning("Missing permissions to create thread in alerts channel")
        except Exception as e:
            logger.error(f"Failed to create trade thread: {e}")

        return None

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    @app_commands.command(
        name="discuss",
        description="Start a discussion thread for a token",
    )
    @app_commands.describe(token="Token symbol (e.g. ETH, SOL, ARB)")
    async def discuss(self, interaction: discord.Interaction, token: str):
        await interaction.response.defer()

        token = token.upper().strip()

        # Fetch current price
        prices = await price_service.get_prices([token])
        current_price = prices.get(token)

        # Build first message embed
        embed = discord.Embed(
            title=f"\U0001F4AC {token} Discussion",
            color=COLOR_INFO,
        )
        if current_price is not None:
            embed.add_field(name="Price", value=format_usd(current_price), inline=True)
        else:
            embed.add_field(name="Price", value="N/A", inline=True)

        embed.set_footer(text="Share your thoughts, charts, and analysis below.")

        # Get the trade volume for this token from the last 24h
        from datetime import datetime, timedelta

        with get_session() as session:
            from sqlalchemy import func

            cutoff = datetime.utcnow() - timedelta(hours=24)
            vol_result = (
                session.query(func.coalesce(func.sum(SwapTransaction.from_amount_usd), 0))
                .filter(
                    SwapTransaction.status == "completed",
                    SwapTransaction.created_at >= cutoff,
                    (SwapTransaction.from_token == token) | (SwapTransaction.to_token == token),
                )
                .scalar()
            )
            volume_24h = float(vol_result or 0)

        if volume_24h > 0:
            embed.add_field(name="24h Suwappu Volume", value=format_usd(volume_24h), inline=True)

        # Send message and create thread
        msg = await interaction.followup.send(embed=embed, wait=True)

        thread_name = f"\U0001F4AC {token} Discussion"
        try:
            thread = await msg.create_thread(
                name=thread_name[:100],
                auto_archive_duration=1440,
            )
            await thread.send(
                f"Welcome to the **{token}** discussion thread!\n"
                f"Drop your analysis, charts, and trade ideas here."
            )
        except discord.Forbidden:
            await interaction.followup.send(
                "I don't have permission to create threads in this channel.",
                ephemeral=True,
            )
        except Exception as e:
            logger.error(f"Failed to create discuss thread: {e}")


async def setup(bot: commands.Bot):
    await bot.add_cog(Threads(bot))
