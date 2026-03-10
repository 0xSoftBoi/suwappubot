"""Portfolio commands: /portfolio, /balance, /history, /pnl."""

import logging

import discord
from discord.ext import commands
from discord import app_commands

from bot.platforms.discord_embeds import (
    build_portfolio_embed,
    build_balance_embed,
    build_history_embed,
    COLOR_INFO,
    COLOR_ERROR,
    COLOR_WARNING,
    COLOR_PORTFOLIO,
)
from bot.utils.formatters import format_usd

logger = logging.getLogger(__name__)


class Portfolio(commands.Cog):
    """Portfolio and balance tracking commands."""

    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="portfolio", description="View your portfolio summary")
    async def portfolio(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        if not user.wallets:
            embed = discord.Embed(
                title="Portfolio",
                description="No wallets found. Use `/wallet create` to get started.",
                color=COLOR_WARNING,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        try:
            from bot.services.wallet import WalletService

            wallet_service = WalletService()
            all_balances = {}
            total_usd = 0.0

            for wallet in user.wallets:
                if not wallet.is_active:
                    continue
                try:
                    balances = await wallet_service.get_balances(wallet)
                    if balances:
                        for chain_name, tokens in balances.items():
                            if chain_name not in all_balances:
                                all_balances[chain_name] = {}
                            all_balances[chain_name].update(tokens)
                except Exception as e:
                    logger.warning(f"Failed to get balances for wallet {wallet.id}: {e}")

            # Try to get USD values
            try:
                from bot.services.price_service import price_service

                for chain_name, tokens in all_balances.items():
                    for symbol, amount in tokens.items():
                        if amount > 0:
                            try:
                                price_data = await price_service.get_price(symbol)
                                if price_data:
                                    usd_price = price_data.get("usd", 0) if isinstance(price_data, dict) else float(price_data)
                                    total_usd += amount * usd_price
                            except Exception:
                                pass
            except Exception:
                pass

            embed = build_portfolio_embed(all_balances, total_usd)
            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Portfolio fetch failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Portfolio Error",
                description="Could not load portfolio. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="balance", description="Quick check wallet balances")
    async def balance(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        if not user.wallets:
            embed = discord.Embed(
                title="Balances",
                description="No wallets found. Use `/wallet create` to get started.",
                color=COLOR_WARNING,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        try:
            from bot.services.wallet import WalletService

            wallet_service = WalletService()
            all_balances = {}

            for wallet in user.wallets:
                if not wallet.is_active:
                    continue
                try:
                    balances = await wallet_service.get_balances(wallet)
                    if balances:
                        for chain_name, tokens in balances.items():
                            if chain_name not in all_balances:
                                all_balances[chain_name] = {}
                            all_balances[chain_name].update(tokens)
                except Exception as e:
                    logger.warning(f"Failed to get balance for wallet {wallet.id}: {e}")

            embed = build_balance_embed(all_balances)
            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Balance fetch failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Balance Error",
                description="Could not fetch balances. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="history", description="View recent transaction history")
    async def history(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.models.swap import SwapTransaction
            from database.db import get_session

            with get_session() as session:
                swaps = (
                    session.query(SwapTransaction)
                    .filter(SwapTransaction.user_id == user.id)
                    .order_by(SwapTransaction.created_at.desc())
                    .limit(10)
                    .all()
                )

            embed = build_history_embed(swaps)
            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"History fetch failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="History Error",
                description="Could not load transaction history. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="pnl", description="View profit and loss summary")
    @app_commands.describe(days="Number of days to look back (default: 30)")
    async def pnl(self, interaction: discord.Interaction, days: int = 30):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.services.pnl import PnLService

            pnl_service = PnLService()
            result = await pnl_service.calculate_swap_pnl(user.id, days=days)

            total_pnl = result.get("total_pnl_usd", 0)
            volume = result.get("total_volume_usd", 0)
            fees = result.get("total_fees_usd", 0)
            gas = result.get("total_gas_usd", 0)
            swap_count = result.get("swap_count", 0)

            color = 0x00CC66 if total_pnl >= 0 else 0xFF3333
            pnl_prefix = "+" if total_pnl >= 0 else ""

            embed = discord.Embed(
                title=f"P&L — Last {days} Days",
                color=color,
            )
            embed.add_field(name="Total P&L", value=f"{pnl_prefix}{format_usd(total_pnl)}", inline=True)
            embed.add_field(name="Volume", value=format_usd(volume), inline=True)
            embed.add_field(name="Swaps", value=str(swap_count), inline=True)
            embed.add_field(name="Fees Paid", value=format_usd(fees), inline=True)
            embed.add_field(name="Gas Paid", value=format_usd(gas), inline=True)

            # Per-token breakdown
            pnl_by_token = result.get("pnl_by_token", {})
            if pnl_by_token:
                lines = []
                for token, token_pnl in sorted(pnl_by_token.items(), key=lambda x: x[1], reverse=True)[:10]:
                    prefix = "+" if token_pnl >= 0 else ""
                    lines.append(f"**{token}**: {prefix}{format_usd(token_pnl)}")
                if lines:
                    embed.add_field(name="By Token", value="\n".join(lines), inline=False)

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"PnL calculation failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="P&L Error",
                description="Could not calculate P&L. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(Portfolio(bot))
