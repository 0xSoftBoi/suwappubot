"""Wallet commands: /wallet create, balance, deposit, list, export."""

import logging
from typing import Optional

import discord
from discord.ext import commands
from discord import app_commands

from bot.platforms.discord_embeds import (
    build_balance_embed,
    build_wallet_embed,
    COLOR_INFO,
    COLOR_SUCCESS,
    COLOR_ERROR,
    COLOR_WARNING,
)
from bot.utils.formatters import format_amount, format_usd

logger = logging.getLogger(__name__)

CHAIN_CHOICES = [
    app_commands.Choice(name="EVM (Ethereum, Arbitrum, etc.)", value="evm"),
    app_commands.Choice(name="Solana", value="solana"),
]


class Wallet(commands.GroupCog, name="wallet"):
    """Wallet management commands."""

    def __init__(self, bot):
        self.bot = bot
        super().__init__()

    @app_commands.command(name="create", description="Create a new wallet")
    @app_commands.describe(chain="Wallet type: EVM or Solana")
    @app_commands.choices(chain=CHAIN_CHOICES)
    async def create(
        self,
        interaction: discord.Interaction,
        chain: Optional[app_commands.Choice[str]] = None,
    ):
        # DM-only for wallet creation
        if interaction.guild is not None:
            await interaction.response.send_message(
                "Wallet creation must be done in DMs for security. Please DM me `/wallet create`.",
                ephemeral=True,
            )
            return

        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)
        chain_type = chain.value if chain else "evm"

        try:
            from bot.services.wallet import WalletService

            wallet_service = WalletService()
            new_wallet = await wallet_service.create_wallet(
                user_id=user.id,
                chain_type=chain_type,
            )

            short_addr = f"{new_wallet.address[:6]}...{new_wallet.address[-4:]}"
            chain_label = "EVM" if chain_type == "evm" else "Solana"

            embed = discord.Embed(title="Wallet Created", color=COLOR_SUCCESS)
            embed.add_field(name="Type", value=chain_label, inline=True)
            embed.add_field(name="Address", value=f"`{short_addr}`", inline=True)
            embed.add_field(
                name="Full Address",
                value=f"```{new_wallet.address}```",
                inline=False,
            )
            embed.set_footer(text="Keep your wallet safe. Use /wallet export to back up your key.")
            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Wallet creation failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Wallet Creation Failed",
                description=str(e)[:2000],
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="balance", description="Show wallet balances")
    async def balance(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        if not user.wallets:
            embed = discord.Embed(
                title="No Wallets",
                description="You don't have any wallets yet. Use `/wallet create` to get started.",
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
                    logger.warning(f"Failed to fetch balance for wallet {wallet.id}: {e}")

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

    @app_commands.command(name="deposit", description="Show deposit addresses")
    async def deposit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        if not user.wallets:
            embed = discord.Embed(
                title="No Wallets",
                description="Create a wallet first with `/wallet create`.",
                color=COLOR_WARNING,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        embed = discord.Embed(title="Deposit Addresses", color=COLOR_INFO)
        embed.description = "Send tokens to the addresses below. Make sure you use the correct chain."

        for wallet in user.wallets:
            if not wallet.is_active:
                continue
            chain_label = "EVM" if wallet.chain_type == "evm" else "Solana"
            icon = "\U0001f537" if wallet.chain_type == "evm" else "\U0001f7e2"
            name_label = wallet.name or chain_label
            default_tag = " (Default)" if wallet.is_default else ""

            embed.add_field(
                name=f"{icon} {name_label}{default_tag}",
                value=f"```{wallet.address}```",
                inline=False,
            )

        if any(w.chain_type == "evm" for w in user.wallets if w.is_active):
            embed.set_footer(
                text="EVM wallets work on Ethereum, Arbitrum, Optimism, Base, Polygon, and BSC."
            )

        await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="list", description="List all your wallets")
    async def list_wallets(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        if not user.wallets:
            embed = discord.Embed(
                title="No Wallets",
                description="Create a wallet with `/wallet create`.",
                color=COLOR_WARNING,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        embed = build_wallet_embed(user.wallets)
        await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="export", description="Export wallet private key (DM only)")
    async def export(self, interaction: discord.Interaction):
        # DM-only
        if interaction.guild is not None:
            await interaction.response.send_message(
                "For security, wallet export only works in DMs. Please DM me `/wallet export`.",
                ephemeral=True,
            )
            return

        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        if not user.wallets:
            embed = discord.Embed(
                title="No Wallets",
                description="No wallets to export.",
                color=COLOR_WARNING,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        # Show warning first
        embed = discord.Embed(
            title="Export Private Key",
            color=COLOR_WARNING,
        )
        embed.description = (
            "**WARNING:** Your private key gives full access to your wallet.\n\n"
            "- Never share it with anyone\n"
            "- Never paste it into unknown websites\n"
            "- Store it securely offline\n"
            "- Suwappu staff will **never** ask for your key"
        )

        view = ExportConfirmView(self.bot, str(interaction.user.id), user)
        await interaction.followup.send(embed=embed, view=view, ephemeral=True)


class ExportConfirmView(discord.ui.View):
    """Confirmation view for private key export."""

    def __init__(self, bot, user_id: str, user, timeout: float = 30):
        super().__init__(timeout=timeout)
        self.bot = bot
        self.user_id = user_id
        self.user = user

    @discord.ui.button(label="I understand, show my key", style=discord.ButtonStyle.danger)
    async def confirm_export(self, interaction: discord.Interaction, button: discord.ui.Button):
        if str(interaction.user.id) != self.user_id:
            await interaction.response.send_message("This isn't your wallet.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)

        try:
            from bot.services.wallet import WalletService

            wallet_service = WalletService()

            for wallet in self.user.wallets:
                if not wallet.is_active:
                    continue
                try:
                    private_key = wallet_service.get_private_key(wallet)
                    chain_label = "EVM" if wallet.chain_type == "evm" else "Solana"
                    short_addr = f"{wallet.address[:6]}...{wallet.address[-4:]}"

                    embed = discord.Embed(
                        title=f"{chain_label} Wallet — {short_addr}",
                        color=COLOR_WARNING,
                    )
                    embed.add_field(
                        name="Private Key",
                        value=f"||`{private_key}`||",
                        inline=False,
                    )
                    embed.set_footer(text="This message will be deleted in 60 seconds.")
                    msg = await interaction.followup.send(embed=embed, ephemeral=True)
                except Exception as e:
                    logger.warning(f"Could not export wallet {wallet.id}: {e}")

        except Exception as e:
            logger.error(f"Export failed: {e}", exc_info=True)
            await interaction.followup.send(
                embed=discord.Embed(title="Export Failed", description=str(e)[:1000], color=COLOR_ERROR),
                ephemeral=True,
            )

        self.stop()

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary)
    async def cancel_export(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(
            embed=discord.Embed(title="Export Cancelled", color=COLOR_INFO),
            view=None,
        )
        self.stop()

    async def on_timeout(self):
        self.stop()


async def setup(bot):
    await bot.add_cog(Wallet(bot))
