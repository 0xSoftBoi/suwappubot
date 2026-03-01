"""Discord portfolio slash commands."""

import logging

logger = logging.getLogger(__name__)

try:
    import discord
    from discord.ext import commands
    DISCORD_AVAILABLE = True
except ImportError:
    DISCORD_AVAILABLE = False


def register_portfolio_commands(bot: "commands.Bot", get_or_create_user):
    """Register portfolio-related slash commands on the bot."""

    @bot.tree.command(name="portfolio", description="View your portfolio")
    async def portfolio_command(interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        try:
            user_id = await get_or_create_user(str(interaction.user.id), interaction.user.name)

            from bot.services.wallet import WalletService
            wallet_service = WalletService()
            wallets = wallet_service.get_user_wallets(user_id)

            embed = discord.Embed(
                title="Portfolio",
                color=discord.Color.purple(),
            )

            if not wallets:
                embed.description = "No wallets found. Use `/wallet create` to get started."
            else:
                for w in wallets:
                    balance = await wallet_service.get_native_balance(w.address, w.chain_type)
                    native_token = "ETH" if w.chain_type == "evm" else "SOL"
                    embed.add_field(
                        name=f"{w.name}",
                        value=f"{balance} {native_token}",
                        inline=True,
                    )

                embed.set_footer(text="Use /swap to trade tokens")

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Discord portfolio error: {e}")
            await interaction.followup.send(f"Error: {str(e)[:200]}", ephemeral=True)
