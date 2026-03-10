"""Order commands: /limit, /dca, /orders list, /orders cancel."""

import logging
from typing import Optional

import discord
from discord.ext import commands
from discord import app_commands

from bot.platforms.discord_embeds import COLOR_INFO, COLOR_SUCCESS, COLOR_ERROR, COLOR_WARNING
from bot.utils.formatters import format_amount, format_usd

logger = logging.getLogger(__name__)

INTERVAL_CHOICES = [
    app_commands.Choice(name="Every hour", value="1h"),
    app_commands.Choice(name="Every 4 hours", value="4h"),
    app_commands.Choice(name="Every 12 hours", value="12h"),
    app_commands.Choice(name="Daily", value="1d"),
    app_commands.Choice(name="Weekly", value="7d"),
]


class OrdersGroup(commands.GroupCog, name="orders"):
    """Order management commands."""

    def __init__(self, bot):
        self.bot = bot
        super().__init__()

    @app_commands.command(name="list", description="View your active orders")
    async def list_orders(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.services.orders import OrderService

            order_service = OrderService()

            # Limit orders
            limit_orders = order_service.get_user_orders(user.id, status="pending")

            # DCA orders
            try:
                dca_orders = order_service.get_user_dca_orders(user.id, status="active")
            except Exception:
                dca_orders = []

            embed = discord.Embed(title="Your Orders", color=COLOR_INFO)

            if not limit_orders and not dca_orders:
                embed.description = "No active orders. Use `/limit` or `/dca` to create one."
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

            # Limit orders section
            if limit_orders:
                lines = []
                for order in limit_orders[:10]:
                    lines.append(
                        f"`#{order.id}` **{order.from_token} -> {order.to_token}** "
                        f"| {format_amount(float(order.amount))} @ {format_usd(order.trigger_price)}"
                    )
                embed.add_field(
                    name=f"Limit Orders ({len(limit_orders)})",
                    value="\n".join(lines),
                    inline=False,
                )

            # DCA orders section
            if dca_orders:
                lines = []
                for dca in dca_orders[:10]:
                    token = getattr(dca, "to_token", getattr(dca, "token_symbol", "?"))
                    amount = getattr(dca, "amount_per_execution", getattr(dca, "amount", 0))
                    interval = getattr(dca, "interval", "?")
                    lines.append(
                        f"`#{dca.id}` **{token}** | {format_usd(float(amount))} / {interval}"
                    )
                embed.add_field(
                    name=f"DCA Orders ({len(dca_orders)})",
                    value="\n".join(lines),
                    inline=False,
                )

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Order list failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Orders Error",
                description="Could not load orders. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="cancel", description="Cancel an active order")
    @app_commands.describe(order_id="Order ID to cancel (from /orders list)")
    async def cancel_order(self, interaction: discord.Interaction, order_id: int):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.services.orders import OrderService

            order_service = OrderService()
            cancelled = order_service.cancel_order(order_id, user.id)

            if cancelled:
                embed = discord.Embed(
                    title="Order Cancelled",
                    description=f"Order `#{order_id}` has been cancelled.",
                    color=COLOR_SUCCESS,
                )
            else:
                embed = discord.Embed(
                    title="Order Not Found",
                    description=f"Order `#{order_id}` not found or already completed.",
                    color=COLOR_WARNING,
                )

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Order cancel failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Cancel Error",
                description=f"Could not cancel order: {str(e)[:1000]}",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)


class Orders(commands.Cog):
    """Limit order and DCA commands."""

    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="limit", description="Place a limit order")
    @app_commands.describe(
        from_token="Token to sell (e.g. USDC)",
        to_token="Token to buy (e.g. ETH)",
        amount="Amount of from_token to spend",
        target_price="Execute when to_token reaches this USD price",
    )
    async def limit_order(
        self,
        interaction: discord.Interaction,
        from_token: str,
        to_token: str,
        amount: float,
        target_price: float,
    ):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)
        from_token = from_token.upper()
        to_token = to_token.upper()

        if not user.wallets:
            embed = discord.Embed(
                title="No Wallet",
                description="You need a wallet first. Use `/wallet create`.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        try:
            from bot.services.orders import OrderService

            order_service = OrderService()
            wallet = next((w for w in user.wallets if w.is_default and w.is_active), None)
            if not wallet:
                wallet = next((w for w in user.wallets if w.is_active), None)

            order = order_service.create_limit_order(
                user_id=user.id,
                wallet_id=wallet.id,
                order_type="limit_buy",
                from_chain="ethereum",
                from_token=from_token,
                to_chain="ethereum",
                to_token=to_token,
                amount=str(amount),
                trigger_price=target_price,
                slippage=user.default_slippage / 100,
            )

            embed = discord.Embed(title="Limit Order Created", color=COLOR_SUCCESS)
            embed.add_field(name="Order ID", value=f"`#{order.id}`", inline=True)
            embed.add_field(name="Pair", value=f"{from_token} -> {to_token}", inline=True)
            embed.add_field(name="Amount", value=f"{format_amount(amount)} {from_token}", inline=True)
            embed.add_field(name="Target Price", value=format_usd(target_price), inline=True)
            embed.set_footer(text="Order will execute automatically when the target price is reached.")

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Limit order failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Limit Order Error",
                description=f"Could not create limit order: {str(e)[:1000]}",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="dca", description="Set up dollar-cost averaging")
    @app_commands.describe(
        token="Token to DCA into (e.g. ETH, SOL)",
        amount="USD amount per purchase",
        interval="Purchase interval",
    )
    @app_commands.choices(interval=INTERVAL_CHOICES)
    async def dca(
        self,
        interaction: discord.Interaction,
        token: str,
        amount: float,
        interval: app_commands.Choice[str],
    ):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)
        token = token.upper()

        if not user.wallets:
            embed = discord.Embed(
                title="No Wallet",
                description="You need a wallet first. Use `/wallet create`.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        try:
            from bot.services.orders import OrderService

            order_service = OrderService()
            wallet = next((w for w in user.wallets if w.is_default and w.is_active), None)
            if not wallet:
                wallet = next((w for w in user.wallets if w.is_active), None)

            dca_order = order_service.create_dca_order(
                user_id=user.id,
                wallet_id=wallet.id,
                from_token="USDC",
                to_token=token,
                amount_per_execution=str(amount),
                interval=interval.value,
                from_chain="ethereum",
                to_chain="ethereum",
            )

            embed = discord.Embed(title="DCA Order Created", color=COLOR_SUCCESS)
            embed.add_field(name="Order ID", value=f"`#{dca_order.id}`", inline=True)
            embed.add_field(name="Token", value=token, inline=True)
            embed.add_field(name="Amount", value=f"{format_usd(amount)} per buy", inline=True)
            embed.add_field(name="Interval", value=interval.name, inline=True)
            embed.set_footer(text="DCA will execute automatically. Use /orders cancel to stop.")

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"DCA creation failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="DCA Error",
                description=f"Could not set up DCA: {str(e)[:1000]}",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(OrdersGroup(bot))
    await bot.add_cog(Orders(bot))
