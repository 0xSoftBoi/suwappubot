"""Discord Cog for embedded app / Activities integration."""

import logging
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands

from bot.config.settings import settings
from bot.platforms.discord_embeds import COLOR_INFO, COLOR_SUCCESS

logger = logging.getLogger(__name__)

# The URL that the Discord Activity will embed
SUWAPPU_APP_URL = "https://app.suwappu.bot"


class Activities(commands.Cog):
    """Launch the Suwappu webapp as a Discord Activity."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _link_discord_account(
        self, discord_id: str, discord_username: str
    ) -> None:
        """Ensure the Discord user has a linked Suwappu account.

        This is the OAuth placeholder. In production the flow would be:
        1. User clicks "Connect" in the Activity
        2. Discord OAuth2 code grant -> exchange for token
        3. Suwappu backend verifies token, links discord_id to user record

        For now we just call get_or_create_user which handles the mapping.
        """
        self.bot.get_or_create_user(discord_id, discord_username)

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    @app_commands.command(
        name="dashboard",
        description="Launch the Suwappu trading dashboard inside Discord",
    )
    async def dashboard(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        # Ensure user account exists
        await self._link_discord_account(
            str(interaction.user.id), interaction.user.display_name
        )

        # Build Activity invite URL.
        # Discord Activities require an Application ID and the activity to be
        # registered in the Developer Portal (Embedded App SDK).
        # When properly configured, the bot can launch the activity in a voice
        # channel or create an activity invite link.
        #
        # For now we send a direct link + an explanatory embed.
        app_id = self.bot.application_id

        embed = discord.Embed(
            title="\U0001F680 Suwappu Dashboard",
            description=(
                "Trade tokens across 7+ chains right inside Discord.\n\n"
                "**Features:**\n"
                "\u2022 Swap any token, any chain\n"
                "\u2022 Portfolio & balance overview\n"
                "\u2022 Price alerts & limit orders\n"
                "\u2022 Perps trading\n"
                "\u2022 Referrals & XP rewards"
            ),
            color=COLOR_INFO,
        )

        # Try to start an embedded activity in the user's voice channel
        view = _DashboardView(app_url=SUWAPPU_APP_URL, app_id=app_id)

        if interaction.user.voice and interaction.user.voice.channel:
            voice_channel = interaction.user.voice.channel
            try:
                invite = await voice_channel.create_activity_invite(
                    self.bot.application,  # type: ignore[arg-type]
                    reason="Suwappu dashboard launch",
                )
                embed.add_field(
                    name="Activity",
                    value=f"[Join Activity]({invite.url})",
                    inline=False,
                )
                embed.set_footer(text="Activity launched in your voice channel.")
                await interaction.followup.send(embed=embed, view=view, ephemeral=True)
                return
            except Exception as e:
                logger.debug(f"Could not create activity invite: {e}")

        # Fallback: send a link to the web app
        embed.add_field(
            name="Open in Browser",
            value=f"[\U0001F310 Launch Dashboard]({SUWAPPU_APP_URL})",
            inline=False,
        )
        embed.set_footer(
            text="Join a voice channel and run /dashboard again to use the embedded Activity."
        )
        await interaction.followup.send(embed=embed, view=view, ephemeral=True)

    @app_commands.command(
        name="connect",
        description="Link your Discord account to Suwappu",
    )
    async def connect(self, interaction: discord.Interaction):
        """OAuth flow placeholder: link Discord user to Suwappu account."""
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(
            str(interaction.user.id), interaction.user.display_name
        )

        embed = discord.Embed(
            title="\u2705 Account Linked",
            description=(
                f"Your Discord account **{interaction.user.display_name}** "
                f"is linked to Suwappu.\n\n"
                "You can now use all bot commands and the embedded dashboard."
            ),
            color=COLOR_SUCCESS,
        )
        embed.set_footer(text=f"Suwappu User ID: {user.id}")

        await interaction.followup.send(embed=embed, ephemeral=True)


class _DashboardView(discord.ui.View):
    """Persistent view with a button to open the webapp."""

    def __init__(self, app_url: str, app_id: Optional[int] = None):
        super().__init__(timeout=None)
        self.add_item(
            discord.ui.Button(
                label="Open Dashboard",
                style=discord.ButtonStyle.link,
                url=app_url,
                emoji="\U0001F680",
            )
        )


async def setup(bot: commands.Bot):
    await bot.add_cog(Activities(bot))
