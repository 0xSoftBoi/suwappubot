"""Perpetual trading commands: /long, /short, /positions, /close."""

import logging
from typing import Optional

import discord
from discord.ext import commands
from discord import app_commands

from bot.platforms.discord_embeds import (
    build_perps_embed,
    COLOR_PERPS_LONG,
    COLOR_PERPS_SHORT,
    COLOR_INFO,
    COLOR_SUCCESS,
    COLOR_ERROR,
    COLOR_WARNING,
)
from bot.utils.formatters import format_usd

logger = logging.getLogger(__name__)


class PerpsConfirmView(discord.ui.View):
    """Confirmation view for opening a perps position."""

    def __init__(self, bot, user_id: str, side: str, asset: str, size: float, leverage: int, timeout: float = 60):
        super().__init__(timeout=timeout)
        self.bot = bot
        self.user_id = user_id
        self.side = side
        self.asset = asset
        self.size = size
        self.leverage = leverage

    @discord.ui.button(label="Confirm Position", style=discord.ButtonStyle.green, emoji="\u2705")
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        if str(interaction.user.id) != self.user_id:
            await interaction.response.send_message("This isn't your position.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)

        try:
            from bot.services.perps_service import PerpsService

            perps_service = PerpsService()
            user = self.bot.get_or_create_user(self.user_id, interaction.user.name)

            position = await perps_service.open_position(
                user_id=user.id,
                market=self.asset,
                side=self.side,
                size=self.size,
                leverage=self.leverage,
            )

            if position:
                pos_data = {
                    "asset": self.asset,
                    "side": self.side,
                    "size": self.size,
                    "leverage": self.leverage,
                    "entry_price": getattr(position, "entry_price", 0),
                    "pnl": 0.0,
                }
                embed = build_perps_embed(pos_data, is_open=True)
                embed.title = "Position Opened"
            else:
                embed = discord.Embed(title="Position Opened", color=COLOR_SUCCESS)
                embed.add_field(name="Asset", value=self.asset, inline=True)
                embed.add_field(name="Side", value=self.side.upper(), inline=True)
                embed.add_field(name="Size", value=format_usd(self.size), inline=True)
                embed.add_field(name="Leverage", value=f"{self.leverage}x", inline=True)

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Position open failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Position Failed",
                description=str(e)[:2000],
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

        self.stop()

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.red, emoji="\u274c")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        if str(interaction.user.id) != self.user_id:
            await interaction.response.send_message("This isn't your position.", ephemeral=True)
            return

        embed = discord.Embed(title="Position Cancelled", color=COLOR_ERROR)
        await interaction.response.edit_message(embed=embed, view=None)
        self.stop()

    async def on_timeout(self):
        self.stop()


class Perps(commands.Cog):
    """Perpetual trading commands."""

    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="long", description="Open a long position")
    @app_commands.describe(
        asset="Asset to trade (e.g. BTC, ETH, SOL)",
        size="Position size in USD",
        leverage="Leverage (1-20x, default: 1)",
    )
    async def long(
        self,
        interaction: discord.Interaction,
        asset: str,
        size: float,
        leverage: int = 1,
    ):
        await interaction.response.defer(ephemeral=True)

        asset = asset.upper()

        if leverage < 1 or leverage > 20:
            embed = discord.Embed(
                title="Invalid Leverage",
                description="Leverage must be between 1x and 20x.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        if size < 10:
            embed = discord.Embed(
                title="Minimum Size",
                description="Minimum position size is $10.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        embed = discord.Embed(title="Confirm Long Position", color=COLOR_PERPS_LONG)
        embed.add_field(name="Asset", value=asset, inline=True)
        embed.add_field(name="Size", value=format_usd(size), inline=True)
        embed.add_field(name="Leverage", value=f"{leverage}x", inline=True)
        embed.add_field(name="Effective Size", value=format_usd(size * leverage), inline=True)
        embed.set_footer(text="Confirm within 60 seconds.")

        view = PerpsConfirmView(
            bot=self.bot,
            user_id=str(interaction.user.id),
            side="long",
            asset=asset,
            size=size,
            leverage=leverage,
        )
        await interaction.followup.send(embed=embed, view=view, ephemeral=True)

    @app_commands.command(name="short", description="Open a short position")
    @app_commands.describe(
        asset="Asset to trade (e.g. BTC, ETH, SOL)",
        size="Position size in USD",
        leverage="Leverage (1-20x, default: 1)",
    )
    async def short(
        self,
        interaction: discord.Interaction,
        asset: str,
        size: float,
        leverage: int = 1,
    ):
        await interaction.response.defer(ephemeral=True)

        asset = asset.upper()

        if leverage < 1 or leverage > 20:
            embed = discord.Embed(
                title="Invalid Leverage",
                description="Leverage must be between 1x and 20x.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        if size < 10:
            embed = discord.Embed(
                title="Minimum Size",
                description="Minimum position size is $10.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        embed = discord.Embed(title="Confirm Short Position", color=COLOR_PERPS_SHORT)
        embed.add_field(name="Asset", value=asset, inline=True)
        embed.add_field(name="Size", value=format_usd(size), inline=True)
        embed.add_field(name="Leverage", value=f"{leverage}x", inline=True)
        embed.add_field(name="Effective Size", value=format_usd(size * leverage), inline=True)
        embed.set_footer(text="Confirm within 60 seconds.")

        view = PerpsConfirmView(
            bot=self.bot,
            user_id=str(interaction.user.id),
            side="short",
            asset=asset,
            size=size,
            leverage=leverage,
        )
        await interaction.followup.send(embed=embed, view=view, ephemeral=True)

    @app_commands.command(name="positions", description="View open perps positions")
    async def positions(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.services.perps_service import PerpsService

            perps_service = PerpsService()
            account = perps_service.get_account(user.id)

            if not account:
                embed = discord.Embed(
                    title="No Perps Account",
                    description="You don't have a perps account set up yet. Open a position with `/long` or `/short` to get started.",
                    color=COLOR_WARNING,
                )
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

            # Get open positions
            from bot.models.perps import PerpPosition
            from database.db import get_session

            with get_session() as session:
                positions = (
                    session.query(PerpPosition)
                    .filter(
                        PerpPosition.user_id == user.id,
                        PerpPosition.status == "open",
                    )
                    .all()
                )

            if not positions:
                embed = discord.Embed(
                    title="Positions",
                    description="No open positions.",
                    color=COLOR_INFO,
                )
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

            embeds = []
            for pos in positions[:5]:
                pos_data = {
                    "asset": pos.market,
                    "side": pos.side,
                    "size": pos.size,
                    "leverage": pos.leverage,
                    "entry_price": pos.entry_price,
                    "pnl": getattr(pos, "unrealized_pnl", 0) or 0,
                }
                if hasattr(pos, "mark_price") and pos.mark_price:
                    pos_data["mark_price"] = pos.mark_price
                if hasattr(pos, "liq_price") and pos.liq_price:
                    pos_data["liq_price"] = pos.liq_price

                embeds.append(build_perps_embed(pos_data, is_open=True))

            await interaction.followup.send(embeds=embeds, ephemeral=True)

        except Exception as e:
            logger.error(f"Positions fetch failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Positions Error",
                description="Could not load positions. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="close", description="Close a perps position")
    @app_commands.describe(position_id="Position ID to close (from /positions)")
    async def close(self, interaction: discord.Interaction, position_id: int):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.services.perps_service import PerpsService

            perps_service = PerpsService()
            result = await perps_service.close_position(user_id=user.id, position_id=position_id)

            if result:
                pos_data = {
                    "asset": getattr(result, "market", "?"),
                    "side": getattr(result, "side", "?"),
                    "size": getattr(result, "size", 0),
                    "leverage": getattr(result, "leverage", 1),
                    "entry_price": getattr(result, "entry_price", 0),
                    "pnl": getattr(result, "realized_pnl", 0) or 0,
                }
                embed = build_perps_embed(pos_data, is_open=False)
                embed.title = "Position Closed"
            else:
                embed = discord.Embed(
                    title="Position Closed",
                    description=f"Position `#{position_id}` has been closed.",
                    color=COLOR_SUCCESS,
                )

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Position close failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Close Error",
                description=f"Could not close position: {str(e)[:1000]}",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(Perps(bot))
