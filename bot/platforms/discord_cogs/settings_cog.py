"""Settings commands: /settings, /settings slippage, /settings 2fa, /settings notifications."""

import logging

import discord
from discord.ext import commands
from discord import app_commands

from bot.platforms.discord_embeds import COLOR_INFO, COLOR_SUCCESS, COLOR_ERROR, COLOR_WARNING
from database.db import get_session

logger = logging.getLogger(__name__)


class SettingsCog(commands.GroupCog, name="settings"):
    """User settings and configuration commands."""

    def __init__(self, bot):
        self.bot = bot
        super().__init__()

    @app_commands.command(name="view", description="View your current settings")
    async def view(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        embed = discord.Embed(title="Your Settings", color=COLOR_INFO)

        slippage_pct = user.default_slippage / 100
        embed.add_field(name="Default Slippage", value=f"{slippage_pct:.2f}%", inline=True)
        embed.add_field(
            name="Notifications",
            value="On" if user.notifications_enabled else "Off",
            inline=True,
        )
        embed.add_field(
            name="2FA",
            value="Enabled" if user.two_fa_enabled else "Disabled",
            inline=True,
        )
        embed.add_field(
            name="Panic Sell",
            value="Enabled" if user.panic_sell_enabled else "Disabled",
            inline=True,
        )

        if user.two_fa_enabled and user.two_fa_threshold:
            embed.add_field(
                name="2FA Threshold",
                value=f"${user.two_fa_threshold:,}",
                inline=True,
            )

        embed.add_field(
            name="Wallets",
            value=str(len([w for w in user.wallets if w.is_active])),
            inline=True,
        )

        embed.set_footer(text="Use /settings slippage, /settings 2fa, /settings notifications to change.")
        await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="slippage", description="Set default slippage tolerance")
    @app_commands.describe(value="Slippage in percent (e.g. 0.5 for 0.5%)")
    async def slippage(self, interaction: discord.Interaction, value: float):
        await interaction.response.defer(ephemeral=True)

        if value < 0.01 or value > 50:
            embed = discord.Embed(
                title="Invalid Slippage",
                description="Slippage must be between 0.01% and 50%.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.models.user import User

            slippage_bps = int(value * 100)

            with get_session() as session:
                db_user = session.query(User).filter(User.id == user.id).first()
                if db_user:
                    db_user.default_slippage = slippage_bps
                    session.commit()

            embed = discord.Embed(title="Slippage Updated", color=COLOR_SUCCESS)
            embed.description = f"Default slippage set to **{value:.2f}%** ({slippage_bps} bps)."
            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Slippage update failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Settings Error",
                description="Could not update slippage. Try again.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="2fa", description="Enable or disable two-factor authentication")
    @app_commands.describe(action="Enable or disable 2FA")
    @app_commands.choices(action=[
        app_commands.Choice(name="Enable", value="enable"),
        app_commands.Choice(name="Disable", value="disable"),
    ])
    async def two_fa(self, interaction: discord.Interaction, action: app_commands.Choice[str]):
        # DM-only for 2FA
        if interaction.guild is not None:
            await interaction.response.send_message(
                "2FA setup must be done in DMs for security. Please DM me.",
                ephemeral=True,
            )
            return

        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        if action.value == "enable":
            if user.two_fa_enabled:
                embed = discord.Embed(
                    title="2FA Already Enabled",
                    description="Two-factor authentication is already active on your account.",
                    color=COLOR_WARNING,
                )
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

            try:
                from bot.services.twofa import TwoFactorService

                twofa_service = TwoFactorService()
                secret, uri = twofa_service.setup_2fa(user.id)

                embed = discord.Embed(title="2FA Setup", color=COLOR_INFO)
                embed.description = (
                    "Scan the QR code or enter the secret in your authenticator app "
                    "(Google Authenticator, Authy, etc.).\n\n"
                    f"**Secret:** ||`{secret}`||\n\n"
                    "After adding it to your app, use the code to verify."
                )
                embed.set_footer(text="2FA will protect large transactions above your threshold.")

                view = TwoFAVerifyView(self.bot, str(interaction.user.id), user.id, secret)
                await interaction.followup.send(embed=embed, view=view, ephemeral=True)

            except Exception as e:
                logger.error(f"2FA setup failed: {e}", exc_info=True)
                embed = discord.Embed(
                    title="2FA Error",
                    description=f"Could not set up 2FA: {str(e)[:1000]}",
                    color=COLOR_ERROR,
                )
                await interaction.followup.send(embed=embed, ephemeral=True)

        else:  # disable
            if not user.two_fa_enabled:
                embed = discord.Embed(
                    title="2FA Not Enabled",
                    description="Two-factor authentication is not active.",
                    color=COLOR_WARNING,
                )
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

            try:
                from bot.models.user import User

                with get_session() as session:
                    db_user = session.query(User).filter(User.id == user.id).first()
                    if db_user:
                        db_user.two_fa_enabled = False
                        db_user.totp_secret = None
                        session.commit()

                embed = discord.Embed(title="2FA Disabled", color=COLOR_SUCCESS)
                embed.description = "Two-factor authentication has been disabled."
                await interaction.followup.send(embed=embed, ephemeral=True)

            except Exception as e:
                logger.error(f"2FA disable failed: {e}", exc_info=True)
                embed = discord.Embed(
                    title="2FA Error",
                    description="Could not disable 2FA. Try again.",
                    color=COLOR_ERROR,
                )
                await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="notifications", description="Toggle notifications on or off")
    @app_commands.describe(state="Turn notifications on or off")
    @app_commands.choices(state=[
        app_commands.Choice(name="On", value="on"),
        app_commands.Choice(name="Off", value="off"),
    ])
    async def notifications(self, interaction: discord.Interaction, state: app_commands.Choice[str]):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)
        enabled = state.value == "on"

        try:
            from bot.models.user import User

            with get_session() as session:
                db_user = session.query(User).filter(User.id == user.id).first()
                if db_user:
                    db_user.notifications_enabled = enabled
                    session.commit()

            status = "enabled" if enabled else "disabled"
            embed = discord.Embed(title="Notifications Updated", color=COLOR_SUCCESS)
            embed.description = f"Notifications have been **{status}**."
            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Notifications update failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Settings Error",
                description="Could not update notifications. Try again.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)


class TwoFAVerifyView(discord.ui.View):
    """View with a button to open a modal for 2FA code verification."""

    def __init__(self, bot, discord_user_id: str, user_id: int, secret: str, timeout: float = 300):
        super().__init__(timeout=timeout)
        self.bot = bot
        self.discord_user_id = discord_user_id
        self.user_id = user_id
        self.secret = secret

    @discord.ui.button(label="Enter Verification Code", style=discord.ButtonStyle.green)
    async def verify(self, interaction: discord.Interaction, button: discord.ui.Button):
        if str(interaction.user.id) != self.discord_user_id:
            await interaction.response.send_message("This isn't your setup.", ephemeral=True)
            return

        modal = TwoFAModal(self.bot, self.user_id, self.secret)
        await interaction.response.send_modal(modal)
        self.stop()

    async def on_timeout(self):
        self.stop()


class TwoFAModal(discord.ui.Modal, title="Verify 2FA Code"):
    """Modal for entering the 2FA TOTP code."""

    code = discord.ui.TextInput(
        label="Authentication Code",
        placeholder="Enter the 6-digit code from your authenticator app",
        min_length=6,
        max_length=6,
    )

    def __init__(self, bot, user_id: int, secret: str):
        super().__init__()
        self.bot = bot
        self.user_id = user_id
        self.secret = secret

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        try:
            from bot.services.twofa import TwoFactorService

            twofa_service = TwoFactorService()
            is_valid = twofa_service.verify_totp(self.secret, self.code.value)

            if is_valid:
                from bot.models.user import User

                with get_session() as session:
                    db_user = session.query(User).filter(User.id == self.user_id).first()
                    if db_user:
                        db_user.two_fa_enabled = True
                        db_user.totp_secret = self.secret
                        session.commit()

                embed = discord.Embed(title="2FA Enabled", color=COLOR_SUCCESS)
                embed.description = (
                    "Two-factor authentication is now active.\n"
                    "You'll be prompted for a code on transactions above your threshold."
                )
                await interaction.followup.send(embed=embed, ephemeral=True)

            else:
                embed = discord.Embed(title="Invalid Code", color=COLOR_ERROR)
                embed.description = "The code you entered is incorrect. Please try the setup again."
                await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"2FA verification failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Verification Error",
                description="Could not verify the code. Try again.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(SettingsCog(bot))
