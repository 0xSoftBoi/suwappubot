"""Social commands: /ref, /xp, /checkin, /leaderboard."""

import logging

import discord
from discord.ext import commands
from discord import app_commands

from bot.platforms.discord_embeds import (
    build_leaderboard_embed,
    COLOR_INFO,
    COLOR_SUCCESS,
    COLOR_ERROR,
    COLOR_LEADERBOARD,
)
from bot.utils.formatters import format_usd

logger = logging.getLogger(__name__)

LEADERBOARD_CHOICES = [
    app_commands.Choice(name="Volume", value="volume"),
    app_commands.Choice(name="P&L", value="pnl"),
    app_commands.Choice(name="XP", value="xp"),
    app_commands.Choice(name="Referrals", value="referrals"),
]


class Social(commands.Cog):
    """Social and gamification commands."""

    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="ref", description="View your referral link and stats")
    async def ref(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.services.referral_service import ReferralService

            referral_service = ReferralService()

            # Get or generate referral code
            try:
                code = referral_service.get_user_code(user.id)
            except Exception:
                code = None

            if not code:
                try:
                    code = referral_service.generate_code(user.id, interaction.user.name)
                except Exception as e:
                    logger.warning(f"Could not generate referral code: {e}")
                    code = None

            embed = discord.Embed(title="Your Referral", color=COLOR_INFO)

            if code:
                ref_link = f"https://t.me/SuwappuBot?start=ref_{code}"
                embed.add_field(name="Referral Code", value=f"`{code}`", inline=True)
                embed.add_field(name="Referral Link", value=ref_link, inline=False)
            else:
                embed.add_field(name="Referral Code", value="Generating...", inline=True)

            # Stats from user model
            embed.add_field(name="Referrals", value=str(user.referral_count or 0), inline=True)
            embed.add_field(
                name="Total Rewards",
                value=format_usd(user.total_referral_rewards or 0),
                inline=True,
            )
            embed.set_footer(text="Earn 30% of all fees from your referrals!")

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Referral fetch failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Referral Error",
                description="Could not load referral info. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="xp", description="View your XP and level")
    async def xp(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.services.points_service import PointsService

            points_service = PointsService()
            account = points_service.get_or_create_points_account(user.id)

            level = getattr(account, "level", "bronze")
            xp = getattr(account, "xp", 0)
            total_points = getattr(account, "total_points_earned", 0)
            current_points = getattr(account, "current_points", 0)
            streak = getattr(account, "daily_streak", 0)

            level_emoji = {
                "bronze": "\U0001f7e4",
                "silver": "\u26aa",
                "gold": "\U0001f7e1",
                "platinum": "\U0001f535",
                "diamond": "\U0001f48e",
            }.get(level, "\u2b50")

            embed = discord.Embed(title="Your XP & Level", color=COLOR_INFO)
            embed.add_field(name="Level", value=f"{level_emoji} {level.title()}", inline=True)
            embed.add_field(name="XP", value=f"{xp:,}", inline=True)
            embed.add_field(name="Points", value=f"{current_points:,} / {total_points:,} earned", inline=True)
            embed.add_field(name="Daily Streak", value=f"{streak} day(s)", inline=True)
            embed.set_footer(text="Earn XP by swapping, checking in, and referring friends.")

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"XP fetch failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="XP Error",
                description="Could not load XP info. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="checkin", description="Daily check-in for XP")
    async def checkin(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.services.points_service import PointsService

            points_service = PointsService()
            result = points_service.daily_checkin(user.id)

            if result:
                points_earned = result.get("points", 0) if isinstance(result, dict) else 10
                streak = result.get("streak", 1) if isinstance(result, dict) else 1
                bonus = result.get("bonus", 0) if isinstance(result, dict) else 0

                embed = discord.Embed(title="Daily Check-in", color=COLOR_SUCCESS)
                embed.description = "Check-in successful!"
                embed.add_field(name="Points Earned", value=f"+{points_earned}", inline=True)
                embed.add_field(name="Streak", value=f"{streak} day(s)", inline=True)
                if bonus:
                    embed.add_field(name="Streak Bonus", value=f"+{bonus}", inline=True)
            else:
                embed = discord.Embed(title="Daily Check-in", color=COLOR_ERROR)
                embed.description = "You've already checked in today. Come back tomorrow!"

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Check-in failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Check-in Error",
                description="Could not process check-in. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="leaderboard", description="View the leaderboard")
    @app_commands.describe(category="Leaderboard category")
    @app_commands.choices(category=LEADERBOARD_CHOICES)
    async def leaderboard(
        self,
        interaction: discord.Interaction,
        category: app_commands.Choice[str] = None,
    ):
        await interaction.response.defer(ephemeral=False)

        cat = category.value if category else "volume"

        try:
            from bot.services.points_service import PointsService

            points_service = PointsService()

            try:
                leaders = points_service.get_leaderboard(category=cat, limit=25)
            except Exception:
                leaders = []

            if leaders:
                embed = build_leaderboard_embed(leaders, title=f"Leaderboard — {cat.title()}", category=cat)
            else:
                embed = discord.Embed(
                    title=f"Leaderboard — {cat.title()}",
                    description="No data yet. Start trading to climb the ranks!",
                    color=COLOR_LEADERBOARD,
                )

            await interaction.followup.send(embed=embed)

        except Exception as e:
            logger.error(f"Leaderboard failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Leaderboard",
                description="Could not load leaderboard. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed)


async def setup(bot):
    await bot.add_cog(Social(bot))
