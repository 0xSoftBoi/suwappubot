"""Gas tracker handlers."""

import logging

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler

from bot.services.gas_tracker import gas_tracker
from bot.services.price_service import PriceService
from bot.config.chains import get_chain_by_name
from bot.utils.formatters import format_usd
from bot.services.error_guidance import user_facing_error

logger = logging.getLogger(__name__)

price_service = PriceService()


async def gas_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /gas command - show current gas prices."""
    loading_msg = await update.message.reply_text("⛽ Fetching gas prices...")

    try:
        gas_prices = await gas_tracker.get_all_gas_prices()

        if not gas_prices:
            await loading_msg.edit_text(
                "❌ Unable to fetch gas prices. Try again later.",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("🔄 Retry", callback_data="gas_refresh")]]
                ),
            )
            return

        # Get native token prices for USD estimates
        native_tokens = ["ETH", "BNB", "MATIC"]
        prices = await price_service.get_prices(native_tokens)

        lines = ["⛽ *Current Gas Prices*\n"]

        for chain_name, gas in sorted(gas_prices.items()):
            chain = get_chain_by_name(chain_name)
            if not chain:
                continue

            native_price = prices.get(chain.native_token, 0) or 0

            # Estimate swap cost (assuming 300k gas for complex swap)
            swap_cost = gas.standard * 300000 * 1e-9 * native_price

            lines.append(
                f"{chain.logo_emoji} *{chain.display_name}*\n"
                f"   🐢 Slow: {gas.slow:.1f} gwei\n"
                f"   🚗 Standard: {gas.standard:.1f} gwei\n"
                f"   🚀 Fast: {gas.fast:.1f} gwei\n"
                f"   ⚡ Instant: {gas.instant:.1f} gwei\n"
                f"   💵 Swap est: ~{format_usd(swap_cost)}\n"
            )

        # Solana fee
        sol_fee = await gas_tracker.get_solana_fee()
        sol_price = (await price_service.get_prices(["SOL"])).get("SOL", 0) or 0
        sol_fee_usd = sol_fee * sol_price if sol_fee else 0

        lines.append(f"🟢 *SOL*\n" f"   Fee: ~{sol_fee:.6f} SOL (~{format_usd(sol_fee_usd)})\n")

        lines.append("\n_Prices update every 15 seconds_")

        keyboard = [
            [
                InlineKeyboardButton("🔄 Refresh", callback_data="gas_refresh"),
                InlineKeyboardButton("🔄 Swap", callback_data="swap_start"),
            ],
            [InlineKeyboardButton("« Back", callback_data="main_menu")],
        ]

        await loading_msg.edit_text(
            "\n".join(lines),
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    except Exception as e:
        logger.error(f"Error fetching gas prices: {e}", exc_info=True)
        await loading_msg.edit_text(
            user_facing_error(e),
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("🔄 Retry", callback_data="gas_refresh")]]
            ),
        )


async def gas_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle gas refresh callback."""
    query = update.callback_query
    await query.answer("Refreshing gas prices...")

    await query.edit_message_text("⛽ Fetching gas prices...")

    try:
        gas_prices = await gas_tracker.get_all_gas_prices()

        if not gas_prices:
            await query.edit_message_text(
                "❌ Unable to fetch gas prices.",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("🔄 Retry", callback_data="gas_refresh")]]
                ),
            )
            return

        native_tokens = ["ETH", "BNB", "MATIC"]
        prices = await price_service.get_prices(native_tokens)

        lines = ["⛽ *Current Gas Prices*\n"]

        for chain_name, gas in sorted(gas_prices.items()):
            chain = get_chain_by_name(chain_name)
            if not chain:
                continue

            native_price = prices.get(chain.native_token, 0) or 0
            swap_cost = gas.standard * 300000 * 1e-9 * native_price

            lines.append(
                f"{chain.logo_emoji} *{chain.display_name}*\n"
                f"   🐢 Slow: {gas.slow:.1f} gwei\n"
                f"   🚗 Standard: {gas.standard:.1f} gwei\n"
                f"   🚀 Fast: {gas.fast:.1f} gwei\n"
                f"   💵 Swap est: ~{format_usd(swap_cost)}\n"
            )

        sol_fee = await gas_tracker.get_solana_fee()
        sol_price = (await price_service.get_prices(["SOL"])).get("SOL", 0) or 0
        sol_fee_usd = sol_fee * sol_price if sol_fee else 0

        lines.append(f"🟢 *SOL*\n" f"   Fee: ~{sol_fee:.6f} SOL (~{format_usd(sol_fee_usd)})\n")

        lines.append("\n_Updated just now_")

        keyboard = [
            [
                InlineKeyboardButton("🔄 Refresh", callback_data="gas_refresh"),
                InlineKeyboardButton("🔄 Swap", callback_data="swap_start"),
            ],
            [InlineKeyboardButton("« Back", callback_data="main_menu")],
        ]

        await query.edit_message_text(
            "\n".join(lines),
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    except Exception as e:
        logger.error(f"Error in gas_callback: {e}", exc_info=True)
        await query.edit_message_text(
            "❌ An unexpected error occurred. Please try again.",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("🔄 Retry", callback_data="gas_refresh")]]
            ),
        )


async def gas_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle gas menu callback - redirect to gas command."""
    # Reuse the existing gas_callback functionality
    await gas_callback(update, context)


# Create handlers
gas_handler = CommandHandler("g", gas_command)
