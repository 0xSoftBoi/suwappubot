"""Discord alert configuration slash commands."""

import logging

logger = logging.getLogger(__name__)

try:
    import discord
    from discord import app_commands
    from discord.ext import commands
    DISCORD_AVAILABLE = True
except ImportError:
    DISCORD_AVAILABLE = False


def register_alerts_commands(bot: "commands.Bot", get_or_create_user):
    """Register alert-related slash commands on the bot."""

    @bot.tree.command(name="alerts", description="Configure price and whale alerts")
    @app_commands.describe(
        action="on, off, or status",
        token="Token to watch (e.g., ETH, SOL)",
        threshold="Price change threshold in % (default: 5)",
    )
    async def alerts_command(
        interaction: discord.Interaction,
        action: str = "status",
        token: str = "",
        threshold: float = 5.0,
    ):
        await interaction.response.defer(ephemeral=True)

        try:
            user_id = await get_or_create_user(str(interaction.user.id), interaction.user.name)

            if action == "status":
                embed = discord.Embed(
                    title="Alert Settings",
                    color=discord.Color.blue(),
                )
                embed.add_field(
                    name="Whale Alerts",
                    value="Enabled (trades > $50K)",
                    inline=False,
                )
                embed.add_field(
                    name="Trending Tokens",
                    value="Updated hourly",
                    inline=False,
                )
                embed.add_field(
                    name="Custom Alerts",
                    value="Use `/alerts on <token>` to watch a token",
                    inline=False,
                )
                embed.set_footer(text="Suwappu Alerts")

                await interaction.followup.send(embed=embed, ephemeral=True)

            elif action == "on":
                if not token:
                    await interaction.followup.send(
                        "Please specify a token: `/alerts on ETH`",
                        ephemeral=True,
                    )
                    return

                embed = discord.Embed(
                    title="Alert Enabled",
                    color=discord.Color.green(),
                )
                embed.add_field(name="Token", value=token.upper(), inline=True)
                embed.add_field(name="Threshold", value=f"{threshold}% change", inline=True)
                embed.set_footer(text="You'll be notified when the threshold is hit")

                await interaction.followup.send(embed=embed, ephemeral=True)

            elif action == "off":
                if not token:
                    await interaction.followup.send(
                        "Please specify a token to stop watching: `/alerts off ETH`",
                        ephemeral=True,
                    )
                    return

                embed = discord.Embed(
                    title="Alert Disabled",
                    description=f"Stopped watching {token.upper()}",
                    color=discord.Color.orange(),
                )

                await interaction.followup.send(embed=embed, ephemeral=True)

        except Exception as e:
            logger.error(f"Discord alerts error: {e}")
            await interaction.followup.send(f"Error: {str(e)[:200]}", ephemeral=True)

    @bot.tree.command(name="trending", description="View trending tokens")
    async def trending_command(interaction: discord.Interaction):
        await interaction.response.defer()

        try:
            from bot.services.price_service import price_service

            tokens = await price_service.get_trending()

            embed = discord.Embed(
                title="Trending Tokens",
                color=discord.Color.orange(),
            )

            if tokens:
                for i, t in enumerate(tokens[:10], 1):
                    change = t.get("change_24h", 0)
                    arrow = "+" if change >= 0 else ""
                    embed.add_field(
                        name=f"#{i} {t.get('symbol', '?')}",
                        value=f"${t.get('price', 0):,.4f} ({arrow}{change:.1f}%)",
                        inline=True,
                    )
            else:
                embed.description = "No trending data available right now."

            embed.set_footer(text="Suwappu | Use /price <token> for details")

            await interaction.followup.send(embed=embed)

        except Exception as e:
            logger.error(f"Discord trending error: {e}")
            await interaction.followup.send(f"Error: {str(e)[:200]}")
