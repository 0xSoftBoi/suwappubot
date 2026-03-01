"""Discord slash command modules."""

from bot.platforms.discord_commands.swap import register_swap_commands
from bot.platforms.discord_commands.wallet import register_wallet_commands
from bot.platforms.discord_commands.portfolio import register_portfolio_commands
from bot.platforms.discord_commands.alerts import register_alerts_commands
from bot.platforms.discord_commands.perps import register_perps_commands

__all__ = [
    "register_swap_commands",
    "register_wallet_commands",
    "register_portfolio_commands",
    "register_alerts_commands",
    "register_perps_commands",
]
