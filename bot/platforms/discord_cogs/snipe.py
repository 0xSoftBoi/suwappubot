"""Snipe commands: /snipe, /snipe watch, /snipe config."""

import logging
from typing import Optional

import discord
from discord.ext import commands
from discord import app_commands

from bot.platforms.discord_embeds import COLOR_INFO, COLOR_SUCCESS, COLOR_ERROR, COLOR_WARNING
from bot.utils.formatters import format_amount, format_usd

logger = logging.getLogger(__name__)

SNIPE_PLATFORM_CHOICES = [
    app_commands.Choice(name="Any Platform", value="any"),
    app_commands.Choice(name="Pump.fun", value="pump_fun"),
    app_commands.Choice(name="Raydium", value="raydium"),
]


class Snipe(commands.GroupCog, name="snipe"):
    """Token sniping commands."""

    def __init__(self, bot):
        self.bot = bot
        super().__init__()

    @app_commands.command(name="buy", description="Quick snipe a token")
    @app_commands.describe(
        token="Token address or symbol to snipe",
        amount="Amount of SOL to spend",
        slippage="Slippage tolerance in % (default: 10)",
    )
    async def buy(
        self,
        interaction: discord.Interaction,
        token: str,
        amount: float = 0.1,
        slippage: float = 10.0,
    ):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        # Need a Solana wallet
        sol_wallet = next(
            (w for w in user.wallets if w.chain_type == "solana" and w.is_active), None
        )
        if not sol_wallet:
            embed = discord.Embed(
                title="No Solana Wallet",
                description="Sniping requires a Solana wallet. Use `/wallet create` and select Solana.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        try:
            from bot.models.snipe import SnipeOrder
            from database.db import get_session

            slippage_bps = int(slippage * 100)

            with get_session() as session:
                order = SnipeOrder(
                    user_id=user.id,
                    wallet_id=sol_wallet.id,
                    token_mint=token if len(token) > 20 else None,
                    token_symbol=token if len(token) <= 20 else None,
                    sol_amount=amount,
                    slippage_bps=slippage_bps,
                    mode="instant",
                    use_jito=True,
                )
                session.add(order)
                session.flush()
                order_id = order.id

            embed = discord.Embed(title="Snipe Order Created", color=COLOR_SUCCESS)
            embed.add_field(name="Order ID", value=f"`#{order_id}`", inline=True)
            embed.add_field(name="Token", value=f"`{token}`", inline=True)
            embed.add_field(name="Amount", value=f"{amount} SOL", inline=True)
            embed.add_field(name="Slippage", value=f"{slippage}%", inline=True)
            embed.add_field(name="MEV Protection", value="Jito Bundle", inline=True)
            embed.set_footer(text="Executing snipe...")

            await interaction.followup.send(embed=embed, ephemeral=True)

            # Trigger execution in background
            try:
                from bot.services.sniping.snipe_executor import SnipeExecutor

                executor = SnipeExecutor()
                # Fire and forget
                self.bot.loop.create_task(
                    self._execute_snipe(interaction, executor, order_id, user.id)
                )
            except Exception as e:
                logger.warning(f"Could not start snipe executor: {e}")

        except Exception as e:
            logger.error(f"Snipe creation failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Snipe Error",
                description=f"Could not create snipe order: {str(e)[:1000]}",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    async def _execute_snipe(self, interaction, executor, order_id, user_id):
        """Background task to execute a snipe and notify the user."""
        try:
            result = await executor.execute_order(order_id)
            if result:
                embed = discord.Embed(title="Snipe Executed", color=COLOR_SUCCESS)
                embed.description = f"Order `#{order_id}` completed."
                if hasattr(result, "tx_hash") and result.tx_hash:
                    embed.add_field(name="Tx", value=f"`{result.tx_hash[:16]}...`", inline=False)
                await interaction.followup.send(embed=embed, ephemeral=True)
        except Exception as e:
            logger.error(f"Snipe execution failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Snipe Failed",
                description=f"Order `#{order_id}` failed: {str(e)[:500]}",
                color=COLOR_ERROR,
            )
            try:
                await interaction.followup.send(embed=embed, ephemeral=True)
            except Exception:
                pass

    @app_commands.command(name="watch", description="Watch for a token listing to snipe")
    @app_commands.describe(
        token="Token address or name to watch",
        amount="SOL amount to snipe with when detected",
        platform="Platform to watch",
    )
    @app_commands.choices(platform=SNIPE_PLATFORM_CHOICES)
    async def watch(
        self,
        interaction: discord.Interaction,
        token: str,
        amount: float = 0.1,
        platform: Optional[app_commands.Choice[str]] = None,
    ):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)
        platform_val = platform.value if platform else "any"

        sol_wallet = next(
            (w for w in user.wallets if w.chain_type == "solana" and w.is_active), None
        )
        if not sol_wallet:
            embed = discord.Embed(
                title="No Solana Wallet",
                description="Create a Solana wallet first with `/wallet create`.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        try:
            from bot.models.snipe import SnipeOrder
            from database.db import get_session

            with get_session() as session:
                order = SnipeOrder(
                    user_id=user.id,
                    wallet_id=sol_wallet.id,
                    token_mint=token if len(token) > 20 else None,
                    token_name=token if len(token) <= 20 else None,
                    token_symbol=token.upper() if len(token) <= 10 else None,
                    platform=platform_val,
                    sol_amount=amount,
                    mode="conditional",
                    use_jito=True,
                )
                session.add(order)
                session.flush()
                order_id = order.id

            embed = discord.Embed(title="Snipe Watch Set", color=COLOR_SUCCESS)
            embed.add_field(name="Order ID", value=f"`#{order_id}`", inline=True)
            embed.add_field(name="Watching", value=f"`{token}`", inline=True)
            embed.add_field(name="Amount", value=f"{amount} SOL", inline=True)
            embed.add_field(name="Platform", value=platform_val.replace("_", " ").title(), inline=True)
            embed.set_footer(text="You'll be notified when the token is detected and the snipe executes.")

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Snipe watch failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Watch Error",
                description=f"Could not set up watch: {str(e)[:1000]}",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="config", description="Configure snipe settings")
    async def config(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        embed = discord.Embed(title="Snipe Configuration", color=COLOR_INFO)
        embed.description = "Current snipe settings for your account."

        # Show current config from user/snipe settings
        try:
            from bot.models.snipe import SnipeOrder
            from database.db import get_session

            with get_session() as session:
                active_watches = (
                    session.query(SnipeOrder)
                    .filter(
                        SnipeOrder.user_id == user.id,
                        SnipeOrder.mode == "conditional",
                    )
                    .count()
                )
                active_snipes = (
                    session.query(SnipeOrder)
                    .filter(
                        SnipeOrder.user_id == user.id,
                        SnipeOrder.mode == "instant",
                    )
                    .count()
                )

            embed.add_field(name="Default Slippage", value=f"{user.default_slippage / 100:.1f}%", inline=True)
            embed.add_field(name="MEV Protection", value="Jito Bundles", inline=True)
            embed.add_field(name="Active Watches", value=str(active_watches), inline=True)
            embed.add_field(name="Active Snipes", value=str(active_snipes), inline=True)
            embed.set_footer(text="Use /settings slippage to adjust default slippage.")

        except Exception as e:
            logger.warning(f"Could not load snipe config: {e}")
            embed.add_field(name="Default Slippage", value=f"{user.default_slippage / 100:.1f}%", inline=True)
            embed.add_field(name="MEV Protection", value="Jito Bundles", inline=True)

        await interaction.followup.send(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(Snipe(bot))
