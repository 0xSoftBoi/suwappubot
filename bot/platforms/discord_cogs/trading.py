"""Trading commands: /swap, /price, /trending, /gas."""

import asyncio
import logging
from typing import Optional

import discord
from discord.ext import commands
from discord import app_commands

from bot.platforms.discord_embeds import (
    build_swap_quote_embed,
    build_swap_result_embed,
    COLOR_SWAP,
    COLOR_SUCCESS,
    COLOR_ERROR,
    COLOR_INFO,
)
from bot.utils.formatters import format_amount, format_usd, format_chain_name

logger = logging.getLogger(__name__)

SUPPORTED_CHAINS = [
    app_commands.Choice(name="Ethereum", value="ethereum"),
    app_commands.Choice(name="Arbitrum", value="arbitrum"),
    app_commands.Choice(name="Optimism", value="optimism"),
    app_commands.Choice(name="Base", value="base"),
    app_commands.Choice(name="Polygon", value="polygon"),
    app_commands.Choice(name="BSC", value="bsc"),
    app_commands.Choice(name="Solana", value="solana"),
]


class SwapChainSelect(discord.ui.Select):
    """Dropdown for selecting the chain for a swap."""

    def __init__(self):
        options = [
            discord.SelectOption(label="Ethereum", value="ethereum", emoji="\u2b26"),
            discord.SelectOption(label="Arbitrum", value="arbitrum", emoji="\U0001f535"),
            discord.SelectOption(label="Optimism", value="optimism", emoji="\U0001f534"),
            discord.SelectOption(label="Base", value="base", emoji="\U0001f7e6"),
            discord.SelectOption(label="Polygon", value="polygon", emoji="\U0001f7e3"),
            discord.SelectOption(label="BSC", value="bsc", emoji="\U0001f7e1"),
            discord.SelectOption(label="Solana", value="solana", emoji="\U0001f7e2"),
        ]
        super().__init__(placeholder="Select chain...", options=options, min_values=1, max_values=1)

    async def callback(self, interaction: discord.Interaction):
        self.view.selected_chain = self.values[0]
        await interaction.response.defer()


class SwapConfirmView(discord.ui.View):
    """Confirm/Cancel view for swap execution."""

    def __init__(self, bot, user_id: str, quote, chain: str, timeout: float = 60):
        super().__init__(timeout=timeout)
        self.bot = bot
        self.user_id = user_id
        self.quote = quote
        self.chain = chain
        self.confirmed = False
        self.selected_chain = chain

    @discord.ui.button(label="Confirm Swap", style=discord.ButtonStyle.green, emoji="\u2705")
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        if str(interaction.user.id) != self.user_id:
            await interaction.response.send_message("This isn't your swap.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)
        self.confirmed = True

        try:
            from bot.services.swap_engine import SwapEngine

            engine = SwapEngine()
            user = self.bot.get_or_create_user(self.user_id, interaction.user.name)

            wallet = next((w for w in user.wallets if w.is_default and w.is_active), None)
            if not wallet:
                wallet = next((w for w in user.wallets if w.is_active), None)
            if not wallet:
                await interaction.followup.send(
                    embed=discord.Embed(
                        title="No Wallet",
                        description="Create a wallet first with `/wallet create`.",
                        color=COLOR_ERROR,
                    ),
                    ephemeral=True,
                )
                self.stop()
                return

            result = await engine.execute_swap(
                user_id=user.id,
                wallet=wallet,
                from_chain=self.chain,
                from_token=self.quote.from_token,
                to_chain=self.chain,
                to_token=self.quote.to_token,
                amount=str(self.quote.from_amount_human),
                slippage=user.default_slippage / 100,
            )

            embed = build_swap_result_embed(result, success=True)
            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Swap execution failed: {e}", exc_info=True)
            embed = discord.Embed(title="Swap Failed", description=str(e)[:2000], color=COLOR_ERROR)
            await interaction.followup.send(embed=embed, ephemeral=True)

        self.stop()

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.red, emoji="\u274c")
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        if str(interaction.user.id) != self.user_id:
            await interaction.response.send_message("This isn't your swap.", ephemeral=True)
            return

        embed = discord.Embed(title="Swap Cancelled", color=COLOR_ERROR)
        await interaction.response.edit_message(embed=embed, view=None)
        self.stop()

    async def on_timeout(self):
        self.stop()


class Trading(commands.Cog):
    """Trading commands for swapping tokens and checking prices."""

    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="swap", description="Swap tokens across chains")
    @app_commands.describe(
        from_token="Token to sell (e.g. ETH, USDC)",
        to_token="Token to buy (e.g. USDC, WBTC)",
        amount="Amount to swap",
        chain="Chain to swap on (default: ethereum)",
    )
    @app_commands.choices(chain=SUPPORTED_CHAINS)
    async def swap(
        self,
        interaction: discord.Interaction,
        from_token: str,
        to_token: str,
        amount: float,
        chain: Optional[app_commands.Choice[str]] = None,
    ):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)
        chain_name = chain.value if chain else "ethereum"
        from_token = from_token.upper()
        to_token = to_token.upper()

        try:
            from bot.services.swap_engine import SwapEngine

            engine = SwapEngine()

            wallet = next((w for w in user.wallets if w.is_default and w.is_active), None)
            if not wallet:
                wallet = next((w for w in user.wallets if w.is_active), None)
            if not wallet:
                embed = discord.Embed(
                    title="No Wallet",
                    description="You need a wallet first. Use `/wallet create`.",
                    color=COLOR_ERROR,
                )
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

            quote = await engine.get_quote(
                from_chain=chain_name,
                from_token=from_token,
                to_chain=chain_name,
                to_token=to_token,
                amount=str(amount),
                wallet_address=wallet.address,
                slippage=user.default_slippage / 100,
            )

            embed = build_swap_quote_embed(quote)
            embed.set_footer(text="This quote expires in 60 seconds.")

            view = SwapConfirmView(
                bot=self.bot,
                user_id=str(interaction.user.id),
                quote=quote,
                chain=chain_name,
            )
            await interaction.followup.send(embed=embed, view=view, ephemeral=True)

        except Exception as e:
            logger.error(f"Swap quote failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Quote Failed",
                description=f"Could not get a quote: {str(e)[:1000]}",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="price", description="Check token price")
    @app_commands.describe(token="Token symbol (e.g. ETH, SOL, PEPE)")
    async def price(self, interaction: discord.Interaction, token: str):
        await interaction.response.defer(ephemeral=False)

        token = token.upper()

        try:
            from bot.services.price_service import price_service

            price_data = await price_service.get_price(token)

            if price_data is None:
                embed = discord.Embed(
                    title=f"{token} Price",
                    description=f"Could not find price data for **{token}**.",
                    color=COLOR_ERROR,
                )
                await interaction.followup.send(embed=embed)
                return

            if isinstance(price_data, dict):
                usd_price = price_data.get("usd", 0)
                change_24h = price_data.get("usd_24h_change", 0)
            else:
                usd_price = float(price_data)
                change_24h = 0

            arrow = "\u2b06\ufe0f" if change_24h >= 0 else "\u2b07\ufe0f"
            change_str = f"{arrow} {abs(change_24h):.2f}%" if change_24h else "N/A"

            embed = discord.Embed(title=f"{token} Price", color=COLOR_INFO)
            embed.add_field(name="Price", value=format_usd(usd_price), inline=True)
            embed.add_field(name="24h Change", value=change_str, inline=True)
            await interaction.followup.send(embed=embed)

        except Exception as e:
            logger.error(f"Price lookup failed: {e}", exc_info=True)
            embed = discord.Embed(
                title=f"{token} Price",
                description=f"Price lookup failed: {str(e)[:500]}",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed)

    @app_commands.command(name="trending", description="Show trending tokens")
    async def trending(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=False)

        try:
            from bot.services.price_service import price_service

            trending_data = await price_service.get_trending()

            embed = discord.Embed(title="Trending Tokens", color=COLOR_INFO)

            if trending_data and isinstance(trending_data, list):
                lines = []
                for i, item in enumerate(trending_data[:15], 1):
                    if isinstance(item, dict):
                        name = item.get("name", item.get("symbol", "Unknown"))
                        symbol = item.get("symbol", "???")
                        price_val = item.get("price_usd", item.get("price", 0))
                        lines.append(f"`#{i}` **{symbol}** ({name}) — {format_usd(float(price_val)) if price_val else 'N/A'}")
                    else:
                        lines.append(f"`#{i}` {item}")
                embed.description = "\n".join(lines) if lines else "No trending data available."
            else:
                embed.description = "No trending data available right now. Check back later."

            await interaction.followup.send(embed=embed)

        except Exception as e:
            logger.error(f"Trending lookup failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Trending Tokens",
                description="Could not fetch trending data. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed)

    @app_commands.command(name="gas", description="Show gas prices across chains")
    async def gas(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=False)

        try:
            from bot.services.gas_tracker import GasTracker

            tracker = GasTracker()

            chains_to_check = ["ethereum", "arbitrum", "optimism", "base", "polygon", "bsc"]
            embed = discord.Embed(title="Gas Prices", color=COLOR_INFO)

            results = await asyncio.gather(
                *[tracker.get_evm_gas_price(c) for c in chains_to_check],
                return_exceptions=True,
            )

            has_data = False
            for chain_name, result in zip(chains_to_check, results):
                if isinstance(result, Exception) or result is None:
                    continue
                has_data = True
                chain_display = format_chain_name(chain_name)
                value = (
                    f"Slow: `{result.slow:.1f}` gwei\n"
                    f"Standard: `{result.standard:.1f}` gwei\n"
                    f"Fast: `{result.fast:.1f}` gwei"
                )
                embed.add_field(name=chain_display, value=value, inline=True)

            if not has_data:
                embed.description = "Gas data unavailable. Try again shortly."

            embed.set_footer(text="Gas prices in Gwei. Refresh with /gas")
            await interaction.followup.send(embed=embed)

        except Exception as e:
            logger.error(f"Gas tracker failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Gas Prices",
                description="Could not fetch gas prices. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed)


async def setup(bot):
    await bot.add_cog(Trading(bot))
