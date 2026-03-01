"""Discord bot for Suwappu multi-platform support."""

import logging
import asyncio
from typing import Optional

try:
    import discord
    from discord.ext import commands
    from discord import app_commands
    DISCORD_AVAILABLE = True
except ImportError:
    DISCORD_AVAILABLE = False

logger = logging.getLogger(__name__)


class SuwappuDiscordBot:
    """Discord bot wrapper for Suwappu."""

    def __init__(self, token: str):
        if not DISCORD_AVAILABLE:
            raise ImportError("discord.py is not installed. Run: pip install discord.py")

        self.token = token
        self._bot: Optional[commands.Bot] = None
        self._task: Optional[asyncio.Task] = None
        self._ready = False

    def _create_bot(self) -> commands.Bot:
        """Create the Discord bot instance."""
        intents = discord.Intents.default()
        intents.message_content = True
        intents.guilds = True
        intents.dm_messages = True

        bot = commands.Bot(
            command_prefix="!",
            intents=intents,
            description="Suwappu — Cross-chain DEX Trading Bot",
        )

        @bot.event
        async def on_ready():
            self._ready = True
            logger.info(f"Discord bot logged in as {bot.user} (ID: {bot.user.id})")

            # Sync slash commands
            try:
                synced = await bot.tree.sync()
                logger.info(f"Synced {len(synced)} slash commands")
            except Exception as e:
                logger.error(f"Failed to sync commands: {e}")

        @bot.event
        async def on_message(message: discord.Message):
            if message.author.bot:
                return
            await bot.process_commands(message)

        # Register modular slash commands
        self._register_commands(bot)

        return bot

    def _register_commands(self, bot: commands.Bot):
        """Register all slash commands from modular command files."""
        from bot.platforms.discord_commands.swap import register_swap_commands
        from bot.platforms.discord_commands.wallet import register_wallet_commands
        from bot.platforms.discord_commands.portfolio import register_portfolio_commands
        from bot.platforms.discord_commands.alerts import register_alerts_commands
        from bot.platforms.discord_commands.perps import register_perps_commands

        get_user = self._get_or_create_user

        register_swap_commands(bot, get_user)
        register_wallet_commands(bot, get_user)
        register_portfolio_commands(bot, get_user)
        register_alerts_commands(bot, get_user)
        register_perps_commands(bot, get_user)

        # Help command stays here as it references all modules
        @bot.tree.command(name="help", description="Show help information")
        async def help_command(interaction: discord.Interaction):
            embed = discord.Embed(
                title="Suwappu Bot Commands",
                description="Cross-chain DEX trading at your fingertips!",
                color=discord.Color.blue(),
            )
            embed.add_field(
                name="Trading",
                value=(
                    "`/swap` — Swap tokens across chains\n"
                    "`/price` — Check token prices\n"
                    "`/trending` — View trending tokens\n"
                ),
                inline=False,
            )
            embed.add_field(
                name="Perpetuals",
                value=(
                    "`/long` — Open a long position\n"
                    "`/short` — Open a short position\n"
                    "`/positions` — View open positions\n"
                    "`/close` — Close a position\n"
                ),
                inline=False,
            )
            embed.add_field(
                name="Wallet",
                value=(
                    "`/wallet create` — Create a new wallet\n"
                    "`/wallet balance` — Check balances\n"
                    "`/wallet deposit` — Get deposit address\n"
                ),
                inline=False,
            )
            embed.add_field(
                name="Portfolio & Alerts",
                value=(
                    "`/portfolio` — View your holdings\n"
                    "`/alerts` — Configure price alerts\n"
                ),
                inline=False,
            )
            embed.set_footer(text="Suwappu — Trade anywhere, anytime")

            await interaction.response.send_message(embed=embed, ephemeral=True)

    async def _get_or_create_user(self, discord_id: str, username: str) -> Optional[int]:
        """Get or create a user from Discord ID."""
        from bot.models.user import User
        from database.db import get_session

        with get_session() as session:
            user = session.query(User).filter_by(discord_id=discord_id).first()

            if user:
                return user.id

            user = User(
                discord_id=discord_id,
                username=username,
            )
            session.add(user)
            session.flush()
            return user.id

    async def start(self):
        """Start the Discord bot in background."""
        if not DISCORD_AVAILABLE:
            logger.warning("discord.py not installed — Discord bot disabled")
            return

        self._bot = self._create_bot()
        self._task = asyncio.create_task(self._run())
        logger.info("Discord bot starting...")

    async def _run(self):
        """Run the bot."""
        try:
            await self._bot.start(self.token)
        except Exception as e:
            logger.error(f"Discord bot error: {e}")

    async def stop(self):
        """Stop the Discord bot."""
        if self._bot:
            await self._bot.close()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Discord bot stopped")

    @property
    def is_ready(self) -> bool:
        return self._ready
