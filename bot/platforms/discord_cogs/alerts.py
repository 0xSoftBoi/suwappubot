"""Alert commands: /alert set, list, delete."""

import logging
from typing import Optional

import discord
from discord.ext import commands
from discord import app_commands

from bot.platforms.discord_embeds import COLOR_ALERT, COLOR_SUCCESS, COLOR_ERROR, COLOR_INFO, COLOR_WARNING
from bot.utils.formatters import format_usd

logger = logging.getLogger(__name__)

DIRECTION_CHOICES = [
    app_commands.Choice(name="Above", value="price_above"),
    app_commands.Choice(name="Below", value="price_below"),
]


class Alert(commands.GroupCog, name="alert"):
    """Price alert management commands."""

    def __init__(self, bot):
        self.bot = bot
        super().__init__()

    @app_commands.command(name="set", description="Set a price alert")
    @app_commands.describe(
        token="Token symbol (e.g. ETH, SOL)",
        price="Target price in USD",
        direction="Alert when price goes above or below target",
    )
    @app_commands.choices(direction=DIRECTION_CHOICES)
    async def set_alert(
        self,
        interaction: discord.Interaction,
        token: str,
        price: float,
        direction: Optional[app_commands.Choice[str]] = None,
    ):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)
        token = token.upper()
        alert_type = direction.value if direction else "price_above"

        try:
            from bot.services.alerts import AlertService

            alert_service = AlertService()
            alert = alert_service.create_alert(
                user_id=user.id,
                token_symbol=token,
                alert_type=alert_type,
                target_price=price,
            )

            direction_label = "above" if "above" in alert_type else "below"
            embed = discord.Embed(title="Alert Created", color=COLOR_SUCCESS)
            embed.add_field(name="Token", value=token, inline=True)
            embed.add_field(name="Condition", value=f"Price {direction_label} {format_usd(price)}", inline=True)
            embed.add_field(name="Alert ID", value=f"`#{alert.id}`", inline=True)
            embed.set_footer(text="You'll be notified when the condition is met.")

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Alert creation failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Alert Error",
                description=f"Could not create alert: {str(e)[:1000]}",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="list", description="View your active alerts")
    async def list_alerts(self, interaction: discord.Interaction):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.services.alerts import AlertService

            alert_service = AlertService()
            alerts = alert_service.get_user_alerts(user.id, active_only=True)

            embed = discord.Embed(title="Your Alerts", color=COLOR_ALERT)

            if not alerts:
                embed.description = "No active alerts. Use `/alert set` to create one."
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

            lines = []
            for alert in alerts:
                direction = "above" if "above" in alert.alert_type else "below"
                target = format_usd(alert.target_price) if alert.target_price else "N/A"
                status = "Active" if alert.is_active and not alert.is_triggered else "Triggered"
                lines.append(
                    f"`#{alert.id}` **{alert.token_symbol}** — {direction} {target} [{status}]"
                )

            embed.description = "\n".join(lines)
            embed.set_footer(text=f"{len(alerts)} active alert(s)")
            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Alert list failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Alert Error",
                description="Could not load alerts. Try again later.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

    @app_commands.command(name="delete", description="Delete a price alert")
    @app_commands.describe(alert_id="Alert ID to delete (from /alert list)")
    async def delete_alert(self, interaction: discord.Interaction, alert_id: int):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        try:
            from bot.services.alerts import AlertService

            alert_service = AlertService()
            deleted = alert_service.delete_alert(alert_id, user.id)

            if deleted:
                embed = discord.Embed(
                    title="Alert Deleted",
                    description=f"Alert `#{alert_id}` has been removed.",
                    color=COLOR_SUCCESS,
                )
            else:
                embed = discord.Embed(
                    title="Alert Not Found",
                    description=f"Alert `#{alert_id}` not found or doesn't belong to you.",
                    color=COLOR_WARNING,
                )

            await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Alert deletion failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Alert Error",
                description=f"Could not delete alert: {str(e)[:1000]}",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(Alert(bot))
