"""Admin commands: /help, /status, /broadcast."""

import logging
import platform
from datetime import datetime

import discord
from discord.ext import commands
from discord import app_commands

from bot.platforms.discord_embeds import build_help_embed, COLOR_INFO, COLOR_SUCCESS, COLOR_ERROR
from bot.config.settings import settings

logger = logging.getLogger(__name__)


def is_admin():
    """Check if user is a bot admin."""
    async def predicate(interaction: discord.Interaction) -> bool:
        admin_ids = getattr(settings, "admin_user_ids", None) or getattr(settings, "admin_discord_ids", None)
        if admin_ids:
            if isinstance(admin_ids, str):
                admin_ids = [a.strip() for a in admin_ids.split(",")]
            return str(interaction.user.id) in admin_ids

        # Fallback: check if user has admin permissions in the guild
        if interaction.guild and interaction.user.guild_permissions.administrator:
            return True

        return False

    return app_commands.check(predicate)


class Admin(commands.Cog):
    """Help and admin commands."""

    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="help", description="Show all bot commands")
    async def help_cmd(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        embed = build_help_embed()
        await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="status", description="Show bot status (admin only)")
    @is_admin()
    async def status(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        embed = discord.Embed(title="Bot Status", color=COLOR_INFO)

        # Basic info
        embed.add_field(name="Bot", value=str(self.bot.user), inline=True)
        embed.add_field(name="Guilds", value=str(len(self.bot.guilds)), inline=True)
        embed.add_field(name="Latency", value=f"{self.bot.latency * 1000:.0f}ms", inline=True)

        # System info
        embed.add_field(name="Python", value=platform.python_version(), inline=True)
        embed.add_field(name="discord.py", value=discord.__version__, inline=True)

        # Cog info
        loaded_cogs = list(self.bot.cogs.keys())
        embed.add_field(name="Loaded Cogs", value=str(len(loaded_cogs)), inline=True)

        # User stats
        try:
            from bot.models.user import User
            from database.db import get_session

            with get_session() as session:
                total_users = session.query(User).count()
                discord_users = session.query(User).filter(User.discord_id.isnot(None)).count()

            embed.add_field(name="Total Users", value=str(total_users), inline=True)
            embed.add_field(name="Discord Users", value=str(discord_users), inline=True)
        except Exception as e:
            logger.warning(f"Could not fetch user stats: {e}")
            embed.add_field(name="Users", value="N/A", inline=True)

        # Uptime / health
        try:
            from bot.services.health_monitor import health_monitor

            health = await health_monitor.get_health()
            if isinstance(health, dict):
                status_str = health.get("status", "unknown")
                embed.add_field(name="Health", value=status_str, inline=True)
        except Exception:
            pass

        embed.set_footer(text=f"Checked at {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
        await interaction.followup.send(embed=embed, ephemeral=True)

    @status.error
    async def status_error(self, interaction: discord.Interaction, error):
        if isinstance(error, app_commands.CheckFailure):
            await interaction.response.send_message(
                "You don't have permission to use this command.",
                ephemeral=True,
            )
        else:
            logger.error(f"Status command error: {error}", exc_info=True)

    @app_commands.command(name="broadcast", description="Send a message to all servers (admin only)")
    @app_commands.describe(message="Message to broadcast")
    @is_admin()
    async def broadcast(self, interaction: discord.Interaction, message: str):
        await interaction.response.defer(ephemeral=True)

        if len(message) > 2000:
            embed = discord.Embed(
                title="Message Too Long",
                description="Broadcast message must be under 2000 characters.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        embed = discord.Embed(
            title="Suwappu Announcement",
            description=message,
            color=COLOR_INFO,
        )
        embed.set_footer(text=f"From {interaction.user.display_name}")

        sent = 0
        failed = 0

        for guild in self.bot.guilds:
            # Try to find a general/announcements channel
            target_channel = None
            for channel in guild.text_channels:
                if channel.name in ("announcements", "general", "bot", "bot-commands"):
                    if channel.permissions_for(guild.me).send_messages:
                        target_channel = channel
                        break

            if not target_channel:
                # Fallback to first channel we can write to
                for channel in guild.text_channels:
                    if channel.permissions_for(guild.me).send_messages:
                        target_channel = channel
                        break

            if target_channel:
                try:
                    await target_channel.send(embed=embed)
                    sent += 1
                except Exception as e:
                    logger.warning(f"Failed to broadcast to {guild.name}: {e}")
                    failed += 1
            else:
                failed += 1

        result_embed = discord.Embed(title="Broadcast Complete", color=COLOR_SUCCESS)
        result_embed.add_field(name="Sent", value=str(sent), inline=True)
        result_embed.add_field(name="Failed", value=str(failed), inline=True)
        result_embed.add_field(name="Total Guilds", value=str(len(self.bot.guilds)), inline=True)

        await interaction.followup.send(embed=result_embed, ephemeral=True)

    @broadcast.error
    async def broadcast_error(self, interaction: discord.Interaction, error):
        if isinstance(error, app_commands.CheckFailure):
            await interaction.response.send_message(
                "You don't have permission to use this command.",
                ephemeral=True,
            )
        else:
            logger.error(f"Broadcast command error: {error}", exc_info=True)


async def setup(bot):
    await bot.add_cog(Admin(bot))
