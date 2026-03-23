"""Tax commands: /tax."""

import io
import logging
from datetime import datetime, timezone

import discord
from discord.ext import commands
from discord import app_commands

from bot.platforms.discord_embeds import COLOR_INFO, COLOR_SUCCESS, COLOR_ERROR, COLOR_WARNING
from bot.utils.formatters import format_usd

logger = logging.getLogger(__name__)


class Tax(commands.Cog):
    """Tax report generation commands."""

    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(name="tax", description="Generate a tax report for a given year")
    @app_commands.describe(
        year="Tax year (e.g. 2024, 2025)",
        format="Report format",
    )
    @app_commands.choices(format=[
        app_commands.Choice(name="CSV (Standard)", value="standard"),
        app_commands.Choice(name="CSV (TurboTax)", value="turbotax"),
        app_commands.Choice(name="CSV (Koinly)", value="koinly"),
    ])
    async def tax(
        self,
        interaction: discord.Interaction,
        year: int,
        format: app_commands.Choice[str] = None,
    ):
        await interaction.response.defer(ephemeral=True)

        user = self.bot.get_or_create_user(str(interaction.user.id), interaction.user.name)

        current_year = datetime.now(timezone.utc).year
        if year < 2020 or year > current_year:
            embed = discord.Embed(
                title="Invalid Year",
                description=f"Year must be between 2020 and {current_year}.",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)
            return

        format_type = format.value if format else "standard"

        try:
            from bot.services.tax_export import TaxExportService

            tax_service = TaxExportService()

            # Check if user has any transactions for this year
            transactions = tax_service.get_user_transactions(user.id, year=year)

            if not transactions:
                embed = discord.Embed(
                    title=f"Tax Report — {year}",
                    description=f"No completed transactions found for {year}.",
                    color=COLOR_WARNING,
                )
                await interaction.followup.send(embed=embed, ephemeral=True)
                return

            # Generate CSV
            csv_output = tax_service.generate_csv(
                user_id=user.id,
                year=year,
                format_type=format_type,
            )

            # Summary embed
            embed = discord.Embed(title=f"Tax Report — {year}", color=COLOR_SUCCESS)
            embed.add_field(name="Transactions", value=str(len(transactions)), inline=True)
            embed.add_field(name="Format", value=format_type.title(), inline=True)

            # Calculate totals if available
            total_volume = sum(
                getattr(t, "from_amount_usd", 0) or 0 for t in transactions
            )
            if total_volume > 0:
                embed.add_field(name="Total Volume", value=format_usd(total_volume), inline=True)

            embed.set_footer(text="This is for informational purposes only. Consult a tax professional.")

            # Send as file attachment
            csv_content = csv_output.getvalue()
            filename = f"suwappu_tax_{year}_{format_type}.csv"
            file = discord.File(
                fp=io.BytesIO(csv_content.encode("utf-8")),
                filename=filename,
            )

            await interaction.followup.send(embed=embed, file=file, ephemeral=True)

        except Exception as e:
            logger.error(f"Tax report generation failed: {e}", exc_info=True)
            embed = discord.Embed(
                title="Tax Report Error",
                description=f"Could not generate tax report: {str(e)[:1000]}",
                color=COLOR_ERROR,
            )
            await interaction.followup.send(embed=embed, ephemeral=True)


async def setup(bot):
    await bot.add_cog(Tax(bot))
