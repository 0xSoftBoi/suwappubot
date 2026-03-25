"""Discord Cog for leaderboard with scheduled posts and role rewards."""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands, tasks
from sqlalchemy import func, desc

from bot.config.settings import settings
from bot.models.user import User
from bot.models.swap import SwapTransaction
from bot.models.points import UserPoints
from bot.models.referral import Referral
from bot.platforms.discord_embeds import (
    COLOR_LEADERBOARD,
    build_leaderboard_embed,
)
from bot.utils.formatters import format_usd
from database.db import get_session

logger = logging.getLogger(__name__)

# Leaderboard role names for top 3
TOP_ROLE_NAMES = [
    "Suwappu #1",
    "Suwappu #2",
    "Suwappu #3",
]

VALID_CATEGORIES = ("volume", "pnl", "xp", "referrals")


def _query_volume_leaders(session, limit: int = 10, days: Optional[int] = None):
    """Top users by completed swap volume."""
    query = (
        session.query(
            User,
            func.coalesce(func.sum(SwapTransaction.from_amount_usd), 0).label("volume"),
        )
        .join(SwapTransaction, SwapTransaction.user_id == User.id)
        .filter(SwapTransaction.status == "completed")
    )
    if days:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        query = query.filter(SwapTransaction.created_at >= cutoff)

    return query.group_by(User.id).order_by(desc("volume")).limit(limit).all()


def _query_pnl_leaders(session, limit: int = 10, days: Optional[int] = None):
    """Approximate PnL: sum(to_amount_usd) - sum(from_amount_usd) for completed swaps."""
    query = (
        session.query(
            User,
            (
                func.coalesce(func.sum(SwapTransaction.to_amount_usd), 0)
                - func.coalesce(func.sum(SwapTransaction.from_amount_usd), 0)
            ).label("pnl"),
        )
        .join(SwapTransaction, SwapTransaction.user_id == User.id)
        .filter(SwapTransaction.status == "completed")
    )
    if days:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        query = query.filter(SwapTransaction.created_at >= cutoff)

    return query.group_by(User.id).order_by(desc("pnl")).limit(limit).all()


def _query_xp_leaders(session, limit: int = 10):
    """Top users by XP."""
    return (
        session.query(User, UserPoints.xp)
        .join(UserPoints, UserPoints.user_id == User.id)
        .order_by(desc(UserPoints.xp))
        .limit(limit)
        .all()
    )


def _query_referral_leaders(session, limit: int = 10):
    """Top users by referral count."""
    return (
        session.query(
            User,
            func.count(Referral.id).label("referrals"),
        )
        .join(Referral, Referral.referrer_id == User.id)
        .filter(Referral.is_active == True)
        .group_by(User.id)
        .order_by(desc("referrals"))
        .limit(limit)
        .all()
    )


def _build_leaders_list(rows, category: str) -> list[dict]:
    """Convert query rows to the list format expected by build_leaderboard_embed."""
    leaders = []
    for user, value in rows:
        leaders.append(
            {
                "username": user.discord_username or user.username or f"User#{user.id}",
                "discord_username": user.discord_username,
                "discord_id": user.discord_id,
                category: float(value),
            }
        )
    return leaders


class Leaderboard(commands.Cog):
    """Leaderboard with slash commands and scheduled channel posts."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    async def cog_load(self) -> None:
        self.weekly_post.start()

    async def cog_unload(self) -> None:
        self.weekly_post.cancel()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _ensure_top_role(self, guild: discord.Guild, index: int) -> Optional[discord.Role]:
        """Get or create the top-N role."""
        name = TOP_ROLE_NAMES[index]
        role = discord.utils.get(guild.roles, name=name)
        if role:
            return role
        try:
            role = await guild.create_role(
                name=name,
                color=discord.Color.gold(),
                hoist=True,
                reason="Suwappu leaderboard reward",
            )
            return role
        except discord.Forbidden:
            return None

    async def _assign_top_roles(self, guild: discord.Guild, leaders: list[dict]) -> None:
        """Assign special roles to top 3 and remove from everyone else."""
        for i in range(min(3, len(TOP_ROLE_NAMES))):
            role = await self._ensure_top_role(guild, i)
            if role is None:
                continue

            # Remove role from all current holders
            for member in role.members:
                try:
                    await member.remove_roles(role, reason="Leaderboard rotation")
                except discord.Forbidden:
                    pass

            # Assign to new holder
            if i < len(leaders):
                discord_id = leaders[i].get("discord_id")
                if discord_id:
                    try:
                        member = guild.get_member(int(discord_id))
                        if member is None:
                            member = await guild.fetch_member(int(discord_id))
                        if member:
                            await member.add_roles(role, reason="Leaderboard top 3")
                    except (discord.NotFound, discord.Forbidden, ValueError):
                        pass

    def _get_leaders(self, category: str, limit: int = 10, days: Optional[int] = None) -> list[dict]:
        """Query leaders for a given category."""
        with get_session() as session:
            if category == "volume":
                rows = _query_volume_leaders(session, limit, days)
            elif category == "pnl":
                rows = _query_pnl_leaders(session, limit, days)
            elif category == "xp":
                rows = _query_xp_leaders(session, limit)
            elif category == "referrals":
                rows = _query_referral_leaders(session, limit)
            else:
                return []
            return _build_leaders_list(rows, category)

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    @app_commands.command(
        name="leaderboard",
        description="Show the Suwappu leaderboard",
    )
    @app_commands.describe(category="Category: volume, pnl, xp, referrals")
    @app_commands.choices(
        category=[
            app_commands.Choice(name="Volume", value="volume"),
            app_commands.Choice(name="PnL", value="pnl"),
            app_commands.Choice(name="XP", value="xp"),
            app_commands.Choice(name="Referrals", value="referrals"),
        ]
    )
    async def leaderboard_cmd(
        self,
        interaction: discord.Interaction,
        category: str = "volume",
    ):
        await interaction.response.defer(ephemeral=False)

        if category not in VALID_CATEGORIES:
            category = "volume"

        leaders = self._get_leaders(category, limit=10)
        title_map = {
            "volume": "\U0001F3C6 Volume Leaderboard",
            "pnl": "\U0001F4B0 PnL Leaderboard",
            "xp": "\u2B50 XP Leaderboard",
            "referrals": "\U0001F465 Referral Leaderboard",
        }
        embed = build_leaderboard_embed(
            leaders,
            title=title_map.get(category, "\U0001F3C6 Leaderboard"),
            category=category,
        )
        embed.timestamp = datetime.now(timezone.utc)

        await interaction.followup.send(embed=embed)

    # ------------------------------------------------------------------
    # Scheduled posts
    # ------------------------------------------------------------------

    @tasks.loop(hours=168)  # weekly
    async def weekly_post(self) -> None:
        """Post weekly leaderboard and assign top-3 roles."""
        channel_id_str = settings.discord_leaderboard_channel_id
        if not channel_id_str:
            return

        try:
            cid = int(channel_id_str)
        except (ValueError, TypeError):
            return

        channel = self.bot.get_channel(cid)
        if channel is None:
            try:
                channel = await self.bot.fetch_channel(cid)
            except (discord.NotFound, discord.Forbidden):
                return
        if not isinstance(channel, discord.TextChannel):
            return

        for category in ("volume", "pnl", "xp"):
            leaders = self._get_leaders(category, limit=10, days=7)
            if not leaders:
                continue

            title_map = {
                "volume": "\U0001F3C6 Weekly Volume Leaderboard",
                "pnl": "\U0001F4B0 Weekly PnL Leaderboard",
                "xp": "\u2B50 Weekly XP Leaderboard",
            }
            embed = build_leaderboard_embed(
                leaders,
                title=title_map[category],
                category=category,
            )
            embed.timestamp = datetime.now(timezone.utc)

            try:
                await channel.send(embed=embed)
            except Exception as e:
                logger.error(f"Failed to post weekly {category} leaderboard: {e}")

            # Assign roles for volume leaders only
            if category == "volume" and channel.guild:
                await self._assign_top_roles(channel.guild, leaders)

    @weekly_post.before_loop
    async def _before_weekly(self) -> None:
        await self.bot.wait_until_ready()


async def setup(bot: commands.Bot):
    await bot.add_cog(Leaderboard(bot))
