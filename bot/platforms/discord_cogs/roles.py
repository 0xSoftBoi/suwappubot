"""Discord Cog for auto-assigning roles based on trading volume/tier."""

import logging
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands
from sqlalchemy import func

from bot.config.settings import settings
from bot.models.user import User
from bot.models.swap import SwapTransaction
from bot.platforms.discord_embeds import COLOR_INFO, COLOR_SUCCESS
from database.db import get_session

logger = logging.getLogger(__name__)

# Tier definitions: (name, min_volume_usd, color, emoji)
TIERS = [
    ("Whale", 1_000_000, discord.Color.gold(), "\U0001F40B"),
    ("Diamond", 100_000, discord.Color.blue(), "\U0001F48E"),
    ("Pro", 10_000, discord.Color.purple(), "\U0001F680"),
    ("Trader", 0, discord.Color.green(), "\U0001F4C8"),
]

# Maps tier name -> minimum volume
TIER_THRESHOLDS = {t[0]: t[1] for t in TIERS}


def _tier_for_volume(volume_usd: float) -> tuple[str, str]:
    """Return (tier_name, emoji) for a given volume."""
    for name, threshold, _, emoji in TIERS:
        if volume_usd >= threshold:
            return name, emoji
    return TIERS[-1][0], TIERS[-1][3]


def _get_user_volume(user_id: int) -> float:
    """Sum completed swap volume for a user."""
    with get_session() as session:
        total = (
            session.query(func.coalesce(func.sum(SwapTransaction.from_amount_usd), 0))
            .filter(
                SwapTransaction.user_id == user_id,
                SwapTransaction.status == "completed",
            )
            .scalar()
        )
        return float(total or 0)


class Roles(commands.Cog):
    """Auto-assign Discord roles based on trading tier."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _ensure_role(self, guild: discord.Guild, tier_name: str) -> Optional[discord.Role]:
        """Get or create a tier role in the guild."""
        role_name = f"Suwappu {tier_name}"
        role = discord.utils.get(guild.roles, name=role_name)
        if role:
            return role

        # Find color for this tier
        color = discord.Color.default()
        for name, _, clr, _ in TIERS:
            if name == tier_name:
                color = clr
                break

        try:
            role = await guild.create_role(
                name=role_name,
                color=color,
                reason="Suwappu trading tier role",
            )
            logger.info(f"Created role '{role_name}' in guild {guild.id}")
            return role
        except discord.Forbidden:
            logger.warning(f"Missing permissions to create role in guild {guild.id}")
            return None

    async def _all_tier_roles(self, guild: discord.Guild) -> list[discord.Role]:
        """Return all tier roles that exist in the guild."""
        roles = []
        for name, *_ in TIERS:
            role = discord.utils.get(guild.roles, name=f"Suwappu {name}")
            if role:
                roles.append(role)
        return roles

    async def check_and_update_role(
        self, member: discord.Member, user: User
    ) -> Optional[str]:
        """Check a user's volume and assign the correct tier role.

        Removes old tier roles and assigns the new one.
        Returns the new tier name, or None if unchanged.
        """
        volume = _get_user_volume(user.id)
        tier_name, _ = _tier_for_volume(volume)

        target_role = await self._ensure_role(member.guild, tier_name)
        if target_role is None:
            return None

        # Remove all other tier roles
        existing_tier_roles = await self._all_tier_roles(member.guild)
        roles_to_remove = [r for r in existing_tier_roles if r.id != target_role.id and r in member.roles]

        try:
            if roles_to_remove:
                await member.remove_roles(*roles_to_remove, reason="Tier update")
            if target_role not in member.roles:
                await member.add_roles(target_role, reason=f"Reached {tier_name} tier")
                logger.info(f"Assigned {tier_name} role to {member} (vol=${volume:,.0f})")
                return tier_name
        except discord.Forbidden:
            logger.warning(f"Missing permissions to manage roles for {member}")

        return None

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    @app_commands.command(name="tier", description="Show your trading tier and progress")
    async def tier(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(
            str(interaction.user.id), interaction.user.display_name
        )
        volume = _get_user_volume(user.id)
        current_tier, current_emoji = _tier_for_volume(volume)

        embed = discord.Embed(
            title=f"{current_emoji} Your Trading Tier",
            color=COLOR_INFO,
        )
        embed.add_field(name="Tier", value=f"**{current_tier}**", inline=True)
        embed.add_field(name="Volume", value=f"${volume:,.2f}", inline=True)

        # Progress to next tier
        next_tier = None
        for i, (name, threshold, _, _) in enumerate(TIERS):
            if name == current_tier and i > 0:
                next_tier = TIERS[i - 1]
                break

        if next_tier:
            next_name, next_threshold, _, next_emoji = next_tier
            remaining = next_threshold - volume
            progress = volume / next_threshold if next_threshold > 0 else 1.0
            bar_len = 10
            filled = int(progress * bar_len)
            bar = "\u2588" * filled + "\u2591" * (bar_len - filled)
            embed.add_field(
                name=f"Next: {next_emoji} {next_name} (${next_threshold:,.0f})",
                value=f"{bar} {progress * 100:.1f}%\n${remaining:,.0f} remaining",
                inline=False,
            )
        else:
            embed.add_field(
                name="Status",
                value="\U0001F3C6 You're at the highest tier!",
                inline=False,
            )

        # Update role while we're here
        if interaction.guild and isinstance(interaction.user, discord.Member):
            await self.check_and_update_role(interaction.user, user)

        await interaction.followup.send(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(Roles(bot))
