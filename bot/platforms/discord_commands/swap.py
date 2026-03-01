"""Discord swap slash commands."""

import logging
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import discord
    from discord import app_commands
    from discord.ext import commands
    DISCORD_AVAILABLE = True
except ImportError:
    DISCORD_AVAILABLE = False


def register_swap_commands(bot: "commands.Bot", get_or_create_user):
    """Register swap-related slash commands on the bot."""

    @bot.tree.command(name="swap", description="Swap tokens across chains")
    @app_commands.describe(
        from_token="Token to swap from (e.g., ETH)",
        to_token="Token to swap to (e.g., USDC)",
        amount="Amount to swap",
        chain="Blockchain (ethereum, base, solana, etc.)",
    )
    async def swap_command(
        interaction: discord.Interaction,
        from_token: str,
        to_token: str,
        amount: float,
        chain: str = "ethereum",
    ):
        await interaction.response.defer(ephemeral=True)

        try:
            from bot.services.swap_engine import SwapEngine

            user_id = await get_or_create_user(str(interaction.user.id), interaction.user.name)

            if not user_id:
                await interaction.followup.send(
                    "Please set up your wallet first with `/wallet create`",
                    ephemeral=True,
                )
                return

            swap_engine = SwapEngine()

            quote = await swap_engine.get_best_quote(
                from_token=from_token.upper(),
                to_token=to_token.upper(),
                amount=str(amount),
                from_chain=chain,
                to_chain=chain,
            )

            if not quote:
                await interaction.followup.send(
                    f"No route found for {from_token} -> {to_token} on {chain}",
                    ephemeral=True,
                )
                return

            embed = discord.Embed(
                title="Swap Confirmation",
                color=discord.Color.blue(),
            )
            embed.add_field(name="From", value=f"{amount} {from_token.upper()}", inline=True)
            embed.add_field(name="To", value=f"{quote.get('expected_output', '?')} {to_token.upper()}", inline=True)
            embed.add_field(name="Chain", value=chain.title(), inline=True)
            embed.add_field(name="Route", value=quote.get("provider", "Best Route"), inline=True)
            embed.add_field(name="Price Impact", value=f"{quote.get('price_impact', 0):.2f}%", inline=True)
            embed.set_footer(text="Suwappu DEX Bot")

            view = SwapConfirmView(user_id, quote)

            await interaction.followup.send(
                embed=embed,
                view=view,
                ephemeral=True,
            )

        except Exception as e:
            logger.error(f"Discord swap error: {e}")
            await interaction.followup.send(
                f"Error: {str(e)[:200]}",
                ephemeral=True,
            )

    @bot.tree.command(name="price", description="Check token price")
    @app_commands.describe(token="Token symbol (e.g., ETH, SOL, BTC)")
    async def price_command(interaction: discord.Interaction, token: str):
        await interaction.response.defer()

        try:
            from bot.services.price_service import price_service

            price_data = await price_service.get_price(token.upper())

            if price_data:
                embed = discord.Embed(
                    title=f"{token.upper()} Price",
                    color=discord.Color.green() if price_data.get("change_24h", 0) >= 0 else discord.Color.red(),
                )
                embed.add_field(name="Price", value=f"${price_data.get('price', 0):,.4f}", inline=True)
                embed.add_field(name="24h Change", value=f"{price_data.get('change_24h', 0):+.2f}%", inline=True)
                embed.add_field(name="Market Cap", value=f"${price_data.get('market_cap', 0):,.0f}", inline=True)

                await interaction.followup.send(embed=embed)
            else:
                await interaction.followup.send(f"Price not found for {token.upper()}")

        except Exception as e:
            logger.error(f"Discord price error: {e}")
            await interaction.followup.send(f"Error fetching price: {str(e)[:200]}")


if DISCORD_AVAILABLE:
    class SwapConfirmView(discord.ui.View):
        """View with confirm/cancel buttons for swap."""

        def __init__(self, user_id: int, quote: dict):
            super().__init__(timeout=60)
            self.user_id = user_id
            self.quote = quote

        @discord.ui.button(label="Confirm Swap", style=discord.ButtonStyle.green)
        async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
            await interaction.response.edit_message(
                content="Executing swap...",
                embed=None,
                view=None,
            )

            try:
                from bot.services.swap_engine import SwapEngine
                swap_engine = SwapEngine()

                result = await swap_engine.execute_swap(
                    user_id=self.user_id,
                    from_token=self.quote.get("from_token"),
                    to_token=self.quote.get("to_token"),
                    amount=self.quote.get("amount"),
                    from_chain=self.quote.get("from_chain"),
                    to_chain=self.quote.get("to_chain"),
                    slippage=self.quote.get("slippage", 0.5),
                )

                if result and result.get("status") != "failed":
                    embed = discord.Embed(
                        title="Swap Successful!",
                        color=discord.Color.green(),
                    )
                    embed.add_field(name="TX Hash", value=f"`{result.get('tx_hash', 'pending')}`")
                    await interaction.edit_original_response(content=None, embed=embed)
                else:
                    await interaction.edit_original_response(
                        content=f"Swap failed: {result.get('error', 'Unknown error')}"
                    )
            except Exception as e:
                await interaction.edit_original_response(content=f"Error: {str(e)[:200]}")

        @discord.ui.button(label="Cancel", style=discord.ButtonStyle.red)
        async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
            await interaction.response.edit_message(
                content="Swap cancelled.",
                embed=None,
                view=None,
            )
