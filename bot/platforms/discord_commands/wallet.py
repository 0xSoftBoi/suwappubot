"""Discord wallet slash commands."""

import logging

logger = logging.getLogger(__name__)

try:
    import discord
    from discord import app_commands
    from discord.ext import commands
    DISCORD_AVAILABLE = True
except ImportError:
    DISCORD_AVAILABLE = False


def register_wallet_commands(bot: "commands.Bot", get_or_create_user):
    """Register wallet-related slash commands on the bot."""

    @bot.tree.command(name="wallet", description="Manage your wallets")
    @app_commands.describe(action="create, balance, or deposit")
    async def wallet_command(
        interaction: discord.Interaction,
        action: str = "balance",
    ):
        await interaction.response.defer(ephemeral=True)

        try:
            user_id = await get_or_create_user(str(interaction.user.id), interaction.user.name)

            if action == "create":
                from bot.services.wallet import WalletService
                wallet_service = WalletService()

                wallet = wallet_service.create_wallet(user_id, chain_type="evm", name="Discord Wallet")

                embed = discord.Embed(
                    title="Wallet Created",
                    color=discord.Color.green(),
                )
                embed.add_field(name="Address", value=f"`{wallet.address}`", inline=False)
                embed.add_field(name="Type", value="EVM (Ethereum, Base, Arbitrum...)", inline=True)
                embed.set_footer(text="Keep your wallet secure! Only use in DMs.")

                await interaction.followup.send(embed=embed, ephemeral=True)

            elif action == "balance":
                from bot.services.wallet import WalletService
                wallet_service = WalletService()

                wallets = wallet_service.get_user_wallets(user_id)

                if not wallets:
                    await interaction.followup.send(
                        "No wallets found. Use `/wallet create` to create one.",
                        ephemeral=True,
                    )
                    return

                embed = discord.Embed(
                    title="Your Wallets",
                    color=discord.Color.gold(),
                )

                for w in wallets:
                    balance = await wallet_service.get_native_balance(w.address, w.chain_type)
                    native_token = "ETH" if w.chain_type == "evm" else "SOL"
                    embed.add_field(
                        name=f"{w.name} ({w.chain_type.upper()})",
                        value=f"`{w.address[:6]}...{w.address[-4:]}`\n{balance} {native_token}",
                        inline=False,
                    )

                await interaction.followup.send(embed=embed, ephemeral=True)

            elif action == "deposit":
                from bot.services.wallet import WalletService
                wallet_service = WalletService()

                wallets = wallet_service.get_user_wallets(user_id)

                if not wallets:
                    await interaction.followup.send(
                        "No wallets found. Use `/wallet create` first.",
                        ephemeral=True,
                    )
                    return

                embed = discord.Embed(
                    title="Deposit",
                    description="Send tokens to your wallet address:",
                    color=discord.Color.blue(),
                )

                for w in wallets:
                    embed.add_field(
                        name=f"{w.chain_type.upper()} Wallet",
                        value=f"`{w.address}`",
                        inline=False,
                    )

                await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Discord wallet error: {e}")
            await interaction.followup.send(f"Error: {str(e)[:200]}", ephemeral=True)
