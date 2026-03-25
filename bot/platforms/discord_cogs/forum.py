"""Discord Cog for forum-based token analysis posts."""

import logging
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import func

from bot.config.settings import settings
from bot.models.swap import SwapTransaction
from bot.platforms.discord_embeds import COLOR_INFO, COLOR_WARNING, COLOR_ERROR, COLOR_SUCCESS
from bot.services.price_service import price_service
from bot.utils.formatters import format_usd
from database.db import get_session

logger = logging.getLogger(__name__)

# Risk level tag mapping
RISK_TAGS = {
    "safe": ("\u2705 Safe", COLOR_SUCCESS),
    "caution": ("\u26A0\uFE0F Caution", COLOR_WARNING),
    "danger": ("\u274C Danger", COLOR_ERROR),
}


def _assess_risk(security_data: dict) -> str:
    """Simple risk assessment from security data.

    Returns 'safe', 'caution', or 'danger'.
    """
    if not security_data:
        return "caution"

    flags = 0
    if not security_data.get("is_verified", False):
        flags += 1
    if security_data.get("is_honeypot", False):
        flags += 3
    if security_data.get("has_mint_function", False):
        flags += 1
    if security_data.get("has_proxy", False):
        flags += 1
    top_holder_pct = security_data.get("top_holder_pct", 0)
    if top_holder_pct > 50:
        flags += 2
    elif top_holder_pct > 20:
        flags += 1

    if flags >= 3:
        return "danger"
    elif flags >= 1:
        return "caution"
    return "safe"


class Forum(commands.Cog):
    """Create forum posts with token security analysis."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _get_forum_channel(self) -> Optional[discord.ForumChannel]:
        """Resolve the configured forum channel."""
        cid = settings.discord_forum_channel_id
        if not cid:
            return None

        try:
            channel_id = int(cid)
        except (ValueError, TypeError):
            return None

        channel = self.bot.get_channel(channel_id)
        if channel is None:
            try:
                channel = await self.bot.fetch_channel(channel_id)
            except (discord.NotFound, discord.Forbidden):
                return None

        return channel if isinstance(channel, discord.ForumChannel) else None

    async def _get_security_data(self, token: str, chain: str) -> dict:
        """Placeholder for token security analysis.

        In production this would call bot.services.token_security
        (rug_service / simulation). Returns a stub for now.
        """
        try:
            from bot.services.token_security.rug_service import check_token_security
            data = await check_token_security(token, chain)
            if data:
                return data
        except Exception as e:
            logger.debug(f"Security check unavailable for {token}: {e}")

        # Stub response
        return {
            "is_verified": None,
            "is_honeypot": None,
            "has_mint_function": None,
            "has_proxy": None,
            "top_holder_pct": None,
            "holder_count": None,
            "total_supply": None,
        }

    def _format_security_field(self, data: dict) -> str:
        """Format security data into a readable field value."""
        lines = []

        verified = data.get("is_verified")
        if verified is True:
            lines.append("\u2705 Contract verified")
        elif verified is False:
            lines.append("\u274C Contract **not verified**")
        else:
            lines.append("\u2753 Verification unknown")

        honeypot = data.get("is_honeypot")
        if honeypot is True:
            lines.append("\U0001F6A8 **Honeypot detected**")
        elif honeypot is False:
            lines.append("\u2705 Not a honeypot")

        mint = data.get("has_mint_function")
        if mint is True:
            lines.append("\u26A0\uFE0F Mint function present")
        elif mint is False:
            lines.append("\u2705 No mint function")

        proxy = data.get("has_proxy")
        if proxy is True:
            lines.append("\u26A0\uFE0F Upgradeable proxy")
        elif proxy is False:
            lines.append("\u2705 Not upgradeable")

        return "\n".join(lines) if lines else "No data available"

    def _format_holder_field(self, data: dict) -> str:
        """Format holder distribution into a readable field value."""
        lines = []

        holder_count = data.get("holder_count")
        if holder_count is not None:
            lines.append(f"Holders: **{holder_count:,}**")

        top_pct = data.get("top_holder_pct")
        if top_pct is not None:
            lines.append(f"Top holder: **{top_pct:.1f}%**")

        total_supply = data.get("total_supply")
        if total_supply is not None:
            lines.append(f"Total supply: `{total_supply}`")

        return "\n".join(lines) if lines else "No holder data available"

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    @app_commands.command(
        name="analyze",
        description="Create a forum post with token security analysis",
    )
    @app_commands.describe(
        token="Token symbol (e.g. PEPE, ARB)",
        chain="Chain name (default: ethereum)",
    )
    async def analyze(
        self,
        interaction: discord.Interaction,
        token: str,
        chain: str = "ethereum",
    ):
        await interaction.response.defer(ephemeral=True)

        token = token.upper().strip()
        chain = chain.lower().strip()

        forum = await self._get_forum_channel()
        if forum is None:
            await interaction.followup.send(
                "Forum channel is not configured. Ask an admin to set `DISCORD_FORUM_CHANNEL_ID`.",
                ephemeral=True,
            )
            return

        # Gather data in parallel-ish fashion
        prices = await price_service.get_prices([token])
        security_data = await self._get_security_data(token, chain)
        current_price = prices.get(token)

        risk_level = _assess_risk(security_data)
        risk_label, risk_color = RISK_TAGS[risk_level]

        # Build the embed
        embed = discord.Embed(
            title=f"\U0001F50D {token} Analysis",
            description=f"Chain: **{chain.title()}** | Risk: **{risk_label}**",
            color=risk_color,
        )

        if current_price is not None:
            embed.add_field(name="Price", value=format_usd(current_price), inline=True)

        # Suwappu volume
        from datetime import datetime, timezone, timedelta

        with get_session() as session:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
            vol = float(
                session.query(func.coalesce(func.sum(SwapTransaction.from_amount_usd), 0))
                .filter(
                    SwapTransaction.status == "completed",
                    SwapTransaction.created_at >= cutoff,
                    (SwapTransaction.from_token == token) | (SwapTransaction.to_token == token),
                )
                .scalar()
                or 0
            )
        if vol > 0:
            embed.add_field(name="24h Volume", value=format_usd(vol), inline=True)

        embed.add_field(
            name="Security",
            value=self._format_security_field(security_data),
            inline=False,
        )
        embed.add_field(
            name="Holders",
            value=self._format_holder_field(security_data),
            inline=False,
        )
        embed.set_footer(text=f"Requested by {interaction.user.display_name}")
        embed.timestamp = datetime.now(timezone.utc)

        # Resolve or create forum tags
        applied_tags: list[discord.ForumTag] = []
        desired_tags = [chain.title(), risk_label]

        for tag_name in desired_tags:
            existing = discord.utils.get(forum.available_tags, name=tag_name)
            if existing:
                applied_tags.append(existing)
            else:
                # Try to create the tag (requires manage_threads)
                try:
                    new_tag = await forum.create_tag(name=tag_name)
                    applied_tags.append(new_tag)
                except (discord.Forbidden, discord.HTTPException):
                    pass

        # Create the forum post
        try:
            thread_with_message = await forum.create_thread(
                name=f"\U0001F50D {token} | {chain.title()} | {risk_label}",
                embed=embed,
                applied_tags=applied_tags[:5],  # Discord limit
                reason=f"Token analysis by {interaction.user}",
            )
            await interaction.followup.send(
                f"Analysis posted: {thread_with_message.thread.mention}",
                ephemeral=True,
            )
        except discord.Forbidden:
            await interaction.followup.send(
                "I don't have permission to post in the forum channel.",
                ephemeral=True,
            )
        except Exception as e:
            logger.error(f"Failed to create forum post for {token}: {e}")
            await interaction.followup.send(
                f"Failed to create analysis post: {e}",
                ephemeral=True,
            )


async def setup(bot: commands.Bot):
    await bot.add_cog(Forum(bot))
