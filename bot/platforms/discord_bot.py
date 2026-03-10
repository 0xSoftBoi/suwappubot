"""Core Discord bot using discord.py with Cogs architecture."""

import asyncio
import logging
from typing import Optional

import discord
from discord.ext import commands

from bot.config.settings import settings
from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)


class SuwappuDiscordBot(commands.Bot):
    """Main Discord bot class for Suwappu."""

    def __init__(self):
        intents = discord.Intents.default()
        intents.guilds = True
        intents.guild_messages = True
        intents.dm_messages = True
        intents.message_content = True

        super().__init__(
            command_prefix="!",
            intents=intents,
            help_command=None,
        )
        self._ready_event = asyncio.Event()

    async def setup_hook(self) -> None:
        """Load all cogs and sync slash commands."""
        cog_modules = [
            "bot.platforms.discord_cogs.trading",
            "bot.platforms.discord_cogs.wallet",
            "bot.platforms.discord_cogs.portfolio",
            "bot.platforms.discord_cogs.alerts",
            "bot.platforms.discord_cogs.orders",
            "bot.platforms.discord_cogs.perps",
            "bot.platforms.discord_cogs.social",
            "bot.platforms.discord_cogs.snipe",
            "bot.platforms.discord_cogs.settings_cog",
            "bot.platforms.discord_cogs.custodial",
            "bot.platforms.discord_cogs.tax",
            "bot.platforms.discord_cogs.admin",
            "bot.platforms.discord_cogs.roles",
            "bot.platforms.discord_cogs.threads",
            "bot.platforms.discord_cogs.leaderboard",
            "bot.platforms.discord_cogs.forum",
            "bot.platforms.discord_cogs.activities",
        ]

        for module in cog_modules:
            try:
                await self.load_extension(module)
                logger.debug(f"Loaded cog: {module}")
            except Exception as e:
                logger.warning(f"Failed to load cog {module}: {e}")

        # Sync commands to specific guilds (faster) or globally
        guild_ids = settings.get_discord_guild_ids()
        if guild_ids:
            for gid in guild_ids:
                guild = discord.Object(id=gid)
                self.tree.copy_global_to(guild=guild)
                await self.tree.sync(guild=guild)
                logger.info(f"Synced commands to guild {gid}")
        else:
            await self.tree.sync()
            logger.info("Synced commands globally (may take up to 1 hour)")

    async def on_ready(self) -> None:
        logger.info(f"Discord bot ready: {self.user} (ID: {self.user.id})")
        logger.info(f"Connected to {len(self.guilds)} guild(s)")
        self._ready_event.set()

    async def on_app_command_error(
        self, interaction: discord.Interaction, error: discord.app_commands.AppCommandError
    ) -> None:
        """Global error handler for slash commands."""
        if isinstance(error, discord.app_commands.CommandOnCooldown):
            await interaction.response.send_message(
                f"Cooldown — try again in {error.retry_after:.0f}s",
                ephemeral=True,
            )
            return

        logger.error(f"Discord command error: {error}", exc_info=error)
        msg = "Something went wrong. Please try again."
        if interaction.response.is_done():
            await interaction.followup.send(msg, ephemeral=True)
        else:
            await interaction.response.send_message(msg, ephemeral=True)

    # === User Helpers ===

    def get_or_create_user(self, discord_id: str, username: str = "") -> User:
        """Map a Discord user to the DB user, creating if needed."""
        with get_session() as session:
            user = session.query(User).filter(User.discord_id == discord_id).first()
            if user:
                if username and user.discord_username != username:
                    user.discord_username = username
                    session.commit()
                return user

            user = User(discord_id=discord_id, discord_username=username)
            session.add(user)
            session.commit()
            session.refresh(user)
            return user

    def get_user(self, discord_id: str) -> Optional[User]:
        """Look up user by Discord ID. Returns None if not found."""
        with get_session() as session:
            return session.query(User).filter(User.discord_id == discord_id).first()

    # === Lifecycle ===

    async def start(self) -> None:  # type: ignore[override]
        """Start the bot (runs until stopped)."""
        token = settings.discord_bot_token
        if not token:
            logger.warning("No DISCORD_BOT_TOKEN set — Discord bot not starting")
            return
        await super().start(token, reconnect=True)

    async def stop(self) -> None:
        """Gracefully shut down."""
        await self.close()

    async def wait_until_ready_timeout(self, timeout: float = 30.0) -> bool:
        """Wait for the bot to be ready, with a timeout."""
        try:
            await asyncio.wait_for(self._ready_event.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False
