"""Custodial commands: /custodial deposit, withdraw, balance."""

import logging

import discord
from discord.ext import commands
from discord import app_commands

from bot.platforms.discord_embeds import COLOR_INFO, COLOR_SUCCESS, COLOR_ERROR, COLOR_WARNING
from bot.utils.formatters import format_amount, format_usd

logger = logging.getLogger(__name__)

CHAIN_CHOICES = [
    app_commands.Choice(name="Ethereum", value="ethereum"),
    app_commands.Choice(name="Arbitrum", value="arbitrum"),
    app_commands.Choice(name="Base", value="base"),
    app_commands.Choice(name="Polygon", value="polygon"),
    app_commands.Choice(name="BSC", value="bsc"),
]


class Custodial(commands.GroupCog, name="custodial"):
    """Custodial wallet commands for gasless trading."""

    def __init__(self, bot):
        self.bot = bot
        super().__init__()

    @app_commands.command(name="balance", description="View your custodial balance")
    async def balance(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.models.custodial import CustodialBalance
            from database.db import get_session

            with get_session() as session:
                balances = (
                    session.query(CustodialBalance)
                    .filter(CustodialBalance.user_id == user.id)
                    .all()
                )

            embed = discord.Embed(title="Custodial Balance", color=COLOR_INFO)

            if not balances:
                embed.description = "No custodial balances. Use `/custodial deposit` to add funds."
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

            # Group by chain
            by_chain = {}
            for bal in balances:
                if bal.balance_float <= 0:
                    continue
                if bal.chain not in by_chain:
                    by_chain[bal.chain] = []
                by_chain[bal.chain].append(bal)

            if not by_chain:
                embed.description = "All custodial balances are zero."
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

            for chain_name, chain_bals in by_chain.items():
                lines = []
                for bal in chain_bals:
                    lines.append(f"`{format_amount(bal.balance_float)}` {bal.token_symbol}")
                embed.add_field(name=chain_name.title(), value="\n".join(lines), inline=True)

            embed.set_footer(text="Custodial balances are held by the bot for gasless trading.")
            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Custodial balance failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Balance Error",
                description="Could not load custodial balances. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="deposit", description="Get deposit address for custodial account")
    @app_commands.describe(chain="Chain to deposit on")
    @app_commands.choices(chain=CHAIN_CHOICES)
    async def deposit(
        self,
        interaction: discord.Interaction,
        chain: app_commands.Choice[str] = None,
    ):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)
        chain_name = chain.value if chain else "ethereum"

        try:
            from bot.services.hot_wallet import HotWalletService

            hw_service = HotWalletService()

            # Get the deposit hot wallet for this chain
            try:
                deposit_wallet = hw_service.get_deposit_wallet(chain_name)
                deposit_address = deposit_wallet.address if deposit_wallet else None
            except Exception:
                deposit_address = None

            embed = discord.Embed(title="Custodial Deposit", color=COLOR_INFO)

            if deposit_address:
                embed.description = (
                    f"Send tokens to the address below on **{chain_name.title()}**.\n\n"
                    "Your custodial balance will be credited after confirmation."
                )
                embed.add_field(
                    name=f"{chain_name.title()} Deposit Address",
                    value=f"```{deposit_address}```",
                    inline=False,
                )
                embed.set_footer(text="Only send supported tokens. Unsupported tokens may be lost.")
            else:
                embed.description = (
                    f"Custodial deposits on **{chain_name.title()}** are not yet available.\n"
                    "Please try another chain or check back later."
                )

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Custodial deposit failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Deposit Error",
                description="Could not get deposit address. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="withdraw", description="Withdraw from custodial balance (DM only)")
    @app_commands.describe(
        token="Token to withdraw (e.g. USDC, ETH)",
        amount="Amount to withdraw",
        to_address="Destination wallet address",
        chain="Chain to withdraw on",
    )
    @app_commands.choices(chain=CHAIN_CHOICES)
    async def withdraw(
        self,
        interaction: discord.Interaction,
        token: str,
        amount: float,
        to_address: str,
        chain: app_commands.Choice[str] = None,
    ):
        # DM-only for withdrawals
        if interaction.guild is not None:
            await interaction.response.send_message(
                "Custodial withdrawals must be done in DMs for security. Please DM me.",
                ephemeral=True,
            )
            return

        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)
        token = token.upper()
        chain_name = chain.value if chain else "ethereum"

        # Basic address validation
        if not (to_address.startswith("0x") and len(to_address) == 42):
            embed = discord.Embed(
                title="Invalid Address",
                description="Please provide a valid EVM address (0x...).",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        try:
            # Check custodial balance
            from bot.models.custodial import CustodialBalance
            from database.db import get_session

            with get_session() as session:
                bal = (
                    session.query(CustodialBalance)
                    .filter(
                        CustodialBalance.user_id == user.id,
                        CustodialBalance.token_symbol == token,
                        CustodialBalance.chain == chain_name,
                    )
                    .first()
                )

            if not bal or bal.balance_float < amount:
                current = bal.balance_float if bal else 0
                embed = discord.Embed(
                    title="Insufficient Balance",
                    description=(
                        f"You have `{format_amount(current)}` {token} on {chain_name.title()}.\n"
                        f"Requested: `{format_amount(amount)}` {token}."
                    ),
                    color=COLOR_ERROR,
                )
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

            # Confirm withdrawal
            embed = discord.Embed(title="Confirm Withdrawal", color=COLOR_WARNING)
            embed.add_field(name="Token", value=token, inline=True)
            embed.add_field(name="Amount", value=format_amount(amount), inline=True)
            embed.add_field(name="Chain", value=chain_name.title(), inline=True)
            embed.add_field(
                name="To Address",
                value=f"`{to_address[:10]}...{to_address[-6:]}`",
                inline=False,
            )

            view = WithdrawConfirmView(
                bot=self.bot,
                user_id=str(interaction.user.id),
                db_user_id=user.id,
                token=token,
                amount=amount,
                to_address=to_address,
                chain=chain_name,
            )
            await interaction.followup.send(embed=embed, view=view, ephemeral=True)

        except Exception as e:
            logger.error(f"Custodial withdraw failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Withdrawal Error",
                description=f"Could not process withdrawal: {str(e)[:1000]}",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)


class WithdrawConfirmView(discord.ui.View):
    """Confirmation view for custodial withdrawal."""

    def __init__(
        self, bot, user_id: str, db_user_id: int,
        token: str, amount: float, to_address: str, chain: str,
        timeout: float = 60,
    ):
        super().__init__(timeout=timeout)
        self.bot = bot
        self.user_id = user_id
        self.db_user_id = db_user_id
        self.token = token
        self.amount = amount
        self.to_address = to_address
        self.chain = chain

    @discord.ui.button(label="Confirm Withdrawal", style=discord.ButtonStyle.green)
    async def confirm(self, interaction: discord.Interaction, button: discord.ui.Button):
        if str(interaction.user.id) != self.user_id:
            await interaction.response.send_message("This isn't your withdrawal.", ephemeral=True)
            return

        await interaction.response.defer(ephemeral=True)

        try:
            from bot.services.hot_wallet import HotWalletService

            hw_service = HotWalletService()
            tx = await hw_service.process_withdrawal(
                user_id=self.db_user_id,
                chain=self.chain,
                token_symbol=self.token,
                amount=str(self.amount),
                to_address=self.to_address,
            )

            embed = discord.Embed(title="Withdrawal Submitted", color=COLOR_SUCCESS)
            embed.add_field(name="Amount", value=f"{format_amount(self.amount)} {self.token}", inline=True)
            embed.add_field(name="Chain", value=self.chain.title(), inline=True)
            if tx and hasattr(tx, "tx_hash") and tx.tx_hash:
                embed.add_field(name="Tx Hash", value=f"`{tx.tx_hash[:16]}...`", inline=False)
            embed.set_footer(text="Withdrawal is being processed. You'll be notified when complete.")

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Withdrawal execution failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Withdrawal Failed",
                description=str(e)[:2000],
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

        self.stop()

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.red)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button):
        embed = discord.Embed(title="Withdrawal Cancelled", color=COLOR_INFO)
        await interaction.response.edit_message(embed=embed, view=None)
        self.stop()

    async def on_timeout(self):
        self.stop()


async def setup(bot):
    await bot.add_cog(Custodial(bot))
