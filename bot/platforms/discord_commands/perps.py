"""Discord perpetual trading slash commands."""

import logging

logger = logging.getLogger(__name__)

try:
    import discord
    from discord import app_commands
    from discord.ext import commands
    DISCORD_AVAILABLE = True
except ImportError:
    DISCORD_AVAILABLE = False


def register_perps_commands(bot: "commands.Bot", get_or_create_user):
    """Register perpetual trading slash commands on the bot."""

    @bot.tree.command(name="long", description="Open a leveraged long position")
    @app_commands.describe(
        market="Market pair (e.g., ETH-USD, BTC-USD)",
        size="Position size in USD",
        leverage="Leverage multiplier (1-50x)",
        tp="Take profit price (optional)",
        sl="Stop loss price (optional)",
    )
    async def long_command(
        interaction: discord.Interaction,
        market: str,
        size: float,
        leverage: int = 1,
        tp: float = 0,
        sl: float = 0,
    ):
        await interaction.response.defer(ephemeral=True)

        try:
            user_id = await get_or_create_user(str(interaction.user.id), interaction.user.name)

            if leverage < 1 or leverage > 50:
                await interaction.followup.send("Leverage must be between 1x and 50x.", ephemeral=True)
                return

            embed = discord.Embed(
                title="Open Long Position",
                color=discord.Color.green(),
            )
            embed.add_field(name="Market", value=market.upper(), inline=True)
            embed.add_field(name="Size", value=f"${size:,.2f}", inline=True)
            embed.add_field(name="Leverage", value=f"{leverage}x", inline=True)
            if tp > 0:
                embed.add_field(name="Take Profit", value=f"${tp:,.2f}", inline=True)
            if sl > 0:
                embed.add_field(name="Stop Loss", value=f"${sl:,.2f}", inline=True)
            embed.set_footer(text="HyperLiquid | Suwappu")

            view = PerpConfirmView(user_id, "long", market.upper(), size, leverage, tp, sl)
            await interaction.followup.send(embed=embed, view=view, ephemeral=True)

        except Exception as e:
            logger.error(f"Discord long error: {e}")
            await interaction.followup.send(f"Error: {str(e)[:200]}", ephemeral=True)

    @bot.tree.command(name="short", description="Open a leveraged short position")
    @app_commands.describe(
        market="Market pair (e.g., ETH-USD, BTC-USD)",
        size="Position size in USD",
        leverage="Leverage multiplier (1-50x)",
        tp="Take profit price (optional)",
        sl="Stop loss price (optional)",
    )
    async def short_command(
        interaction: discord.Interaction,
        market: str,
        size: float,
        leverage: int = 1,
        tp: float = 0,
        sl: float = 0,
    ):
        await interaction.response.defer(ephemeral=True)

        try:
            user_id = await get_or_create_user(str(interaction.user.id), interaction.user.name)

            if leverage < 1 or leverage > 50:
                await interaction.followup.send("Leverage must be between 1x and 50x.", ephemeral=True)
                return

            embed = discord.Embed(
                title="Open Short Position",
                color=discord.Color.red(),
            )
            embed.add_field(name="Market", value=market.upper(), inline=True)
            embed.add_field(name="Size", value=f"${size:,.2f}", inline=True)
            embed.add_field(name="Leverage", value=f"{leverage}x", inline=True)
            if tp > 0:
                embed.add_field(name="Take Profit", value=f"${tp:,.2f}", inline=True)
            if sl > 0:
                embed.add_field(name="Stop Loss", value=f"${sl:,.2f}", inline=True)
            embed.set_footer(text="HyperLiquid | Suwappu")

            view = PerpConfirmView(user_id, "short", market.upper(), size, leverage, tp, sl)
            await interaction.followup.send(embed=embed, view=view, ephemeral=True)

        except Exception as e:
            logger.error(f"Discord short error: {e}")
            await interaction.followup.send(f"Error: {str(e)[:200]}", ephemeral=True)

    @bot.tree.command(name="positions", description="View your open perp positions")
    async def positions_command(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        try:
            user_id = await get_or_create_user(str(interaction.user.id), interaction.user.name)

            from bot.models.perps import PerpPosition
            from database.db import get_session

            with get_session() as session:
                positions = (
                    session.query(PerpPosition)
                    .filter_by(user_id=user_id, status="open")
                    .all()
                )

                embed = discord.Embed(
                    title="Open Positions",
                    color=discord.Color.blue(),
                )

                if not positions:
                    embed.description = "No open positions. Use `/long` or `/short` to open one."
                else:
                    for pos in positions:
                        pnl = float(pos.unrealized_pnl or 0)
                        pnl_str = f"+${pnl:,.2f}" if pnl >= 0 else f"-${abs(pnl):,.2f}"
                        side_indicator = "LONG" if pos.side == "long" else "SHORT"

                        embed.add_field(
                            name=f"{side_indicator} {pos.market} ({pos.leverage}x)",
                            value=(
                                f"Size: ${float(pos.size):,.2f}\n"
                                f"Entry: ${float(pos.entry_price):,.2f}\n"
                                f"PnL: {pnl_str}\n"
                                f"Liq: ${float(pos.liquidation_price or 0):,.2f}"
                            ),
                            inline=True,
                        )

                embed.set_footer(text="HyperLiquid | Suwappu")

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Discord positions error: {e}")
            await interaction.followup.send(f"Error: {str(e)[:200]}", ephemeral=True)

    @bot.tree.command(name="close", description="Close a perp position")
    @app_commands.describe(market="Market to close (e.g., ETH-USD)")
    async def close_command(interaction: discord.Interaction, market: str):
        await interaction.response.defer(ephemeral=True)

        try:
            user_id = await get_or_create_user(str(interaction.user.id), interaction.user.name)

            from bot.models.perps import PerpPosition
            from database.db import get_session

            with get_session() as session:
                position = (
                    session.query(PerpPosition)
                    .filter_by(user_id=user_id, market=market.upper(), status="open")
                    .first()
                )

                if not position:
                    await interaction.followup.send(
                        f"No open position found for {market.upper()}",
                        ephemeral=True,
                    )
                    return

                pnl = float(position.unrealized_pnl or 0)
                side_indicator = "LONG" if position.side == "long" else "SHORT"

                embed = discord.Embed(
                    title=f"Close {side_indicator} {position.market}?",
                    color=discord.Color.orange(),
                )
                embed.add_field(name="Size", value=f"${float(position.size):,.2f}", inline=True)
                embed.add_field(name="Entry", value=f"${float(position.entry_price):,.2f}", inline=True)
                pnl_str = f"+${pnl:,.2f}" if pnl >= 0 else f"-${abs(pnl):,.2f}"
                embed.add_field(name="Est. PnL", value=pnl_str, inline=True)

            view = CloseConfirmView(user_id, market.upper())
            await interaction.followup.send(embed=embed, view=view, ephemeral=True)

        except Exception as e:
            logger.error(f"Discord close error: {e}")
            await interaction.followup.send(f"Error: {str(e)[:200]}", ephemeral=True)


if DISCORD_AVAILABLE:
    class PerpConfirmView(discord.ui.View):
        """Confirmation view for opening a perp position."""

        def __init__(self, user_id: int, side: str, market: str, size: float,
                     leverage: int, tp: float, sl: float):
            super().__init__(timeout=60)
            self.user_id = user_id
            self.side = side
            self.market = market
            self.size = size
            self.leverage = leverage
            self.tp = tp
            self.sl = sl

        @discord.ui.button(label="Confirm", style=discord.ButtonStyle.green)
        async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
            await interaction.response.edit_message(
                content=f"Opening {self.side} position on {self.market}...",
                embed=None,
                view=None,
            )

            try:
                from bot.services.perps_service import PerpsService
                perps = PerpsService()

                result = await perps.open_position(
                    user_id=self.user_id,
                    market=self.market,
                    side=self.side,
                    size=self.size,
                    leverage=self.leverage,
                    tp_price=self.tp if self.tp > 0 else None,
                    sl_price=self.sl if self.sl > 0 else None,
                )

                if result and result.get("status") != "failed":
                    embed = discord.Embed(
                        title=f"{self.side.upper()} Opened!",
                        color=discord.Color.green() if self.side == "long" else discord.Color.red(),
                    )
                    embed.add_field(name="Market", value=self.market, inline=True)
                    embed.add_field(name="Size", value=f"${self.size:,.2f}", inline=True)
                    embed.add_field(name="Leverage", value=f"{self.leverage}x", inline=True)
                    embed.add_field(name="Entry", value=f"${result.get('entry_price', 0):,.2f}", inline=True)
                    await interaction.edit_original_response(content=None, embed=embed)
                else:
                    await interaction.edit_original_response(
                        content=f"Failed: {result.get('error', 'Unknown error')}"
                    )

            except Exception as e:
                await interaction.edit_original_response(content=f"Error: {str(e)[:200]}")

        @discord.ui.button(label="Cancel", style=discord.ButtonStyle.red)
        async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
            await interaction.response.edit_message(
                content="Position cancelled.",
                embed=None,
                view=None,
            )

    class CloseConfirmView(discord.ui.View):
        """Confirmation view for closing a perp position."""

        def __init__(self, user_id: int, market: str):
            super().__init__(timeout=60)
            self.user_id = user_id
            self.market = market

        @discord.ui.button(label="Close Position", style=discord.ButtonStyle.red)
        async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
            await interaction.response.edit_message(
                content=f"Closing {self.market} position...",
                embed=None,
                view=None,
            )

            try:
                from bot.services.perps_service import PerpsService
                perps = PerpsService()

                result = await perps.close_position(
                    user_id=self.user_id,
                    market=self.market,
                )

                if result and result.get("status") != "failed":
                    pnl = result.get("realized_pnl", 0)
                    pnl_str = f"+${pnl:,.2f}" if pnl >= 0 else f"-${abs(pnl):,.2f}"
                    embed = discord.Embed(
                        title="Position Closed",
                        color=discord.Color.green() if pnl >= 0 else discord.Color.red(),
                    )
                    embed.add_field(name="Market", value=self.market, inline=True)
                    embed.add_field(name="Realized PnL", value=pnl_str, inline=True)
                    await interaction.edit_original_response(content=None, embed=embed)
                else:
                    await interaction.edit_original_response(
                        content=f"Failed: {result.get('error', 'Unknown error')}"
                    )

            except Exception as e:
                await interaction.edit_original_response(content=f"Error: {str(e)[:200]}")

        @discord.ui.button(label="Keep Open", style=discord.ButtonStyle.grey)
        async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
            await interaction.response.edit_message(
                content="Position kept open.",
                embed=None,
                view=None,
            )
