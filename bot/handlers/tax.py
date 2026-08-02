"""Tax export handlers."""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler
from datetime import datetime
import io

from bot.models.user import User
from bot.models.subscription import SubscriptionTier
from bot.services.tax_export import tax_export_service
from bot.utils.formatters import format_usd
from bot.utils.gating import require_tier
from database.db import get_session


@require_tier(SubscriptionTier.PREMIUM)
async def tax_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /tax command - show tax export options. PREMIUM+ feature."""
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return
        user_id = db_user.id

    # Get available years
    years = tax_export_service.get_available_years(user_id)
    current_year = datetime.now().year

    if not years:
        years = [current_year]

    # Get summary for current/latest year
    summary = tax_export_service.generate_summary(user_id, year=years[0] if years else current_year)

    text = (
        f"📊 *Tax Export Center*\n\n"
        f"*{summary['year']} Summary*\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"📈 Total Transactions: *{summary['total_transactions']}*\n"
        f"💰 Total Volume: *{format_usd(summary['total_volume_usd'])}*\n"
        f"⛽ Gas Paid: *{format_usd(summary['total_gas_usd'])}*\n\n"
        f"🔗 Chains: {', '.join(summary['chains_used'][:5]) if summary['chains_used'] else 'None'}\n"
        f"🪙 Tokens: {', '.join(summary['tokens_traded'][:5]) if summary['tokens_traded'] else 'None'}"
    )

    # Year selection buttons
    year_buttons = []
    for y in years[:4]:
        year_buttons.append(InlineKeyboardButton(str(y), callback_data=f"tax_year_{y}"))

    keyboard = []
    if year_buttons:
        keyboard.append(year_buttons)

    keyboard.extend(
        [
            [
                InlineKeyboardButton(
                    "📥 Download CSV",
                    callback_data=f"tax_csv_{years[0] if years else current_year}",
                )
            ],
            [
                InlineKeyboardButton(
                    "Koinly Format",
                    callback_data=f"tax_koinly_{years[0] if years else current_year}",
                ),
                InlineKeyboardButton(
                    "CoinTracker",
                    callback_data=f"tax_cointracker_{years[0] if years else current_year}",
                ),
            ],
            [InlineKeyboardButton("« Back", callback_data="main_menu")],
        ]
    )

    await update.message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def tax_year_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle year selection."""
    query = update.callback_query
    await query.answer()

    year = int(query.data.replace("tax_year_", ""))
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        user_id = db_user.id

    summary = tax_export_service.generate_summary(user_id, year=year)

    text = (
        f"📊 *Tax Export - {year}*\n\n"
        f"📈 Transactions: *{summary['total_transactions']}*\n"
        f"💰 Volume: *{format_usd(summary['total_volume_usd'])}*\n"
        f"⛽ Gas: *{format_usd(summary['total_gas_usd'])}*"
    )

    keyboard = [
        [InlineKeyboardButton("📥 Download CSV", callback_data=f"tax_csv_{year}")],
        [
            InlineKeyboardButton("Koinly", callback_data=f"tax_koinly_{year}"),
            InlineKeyboardButton("CoinTracker", callback_data=f"tax_cointracker_{year}"),
        ],
        [InlineKeyboardButton("« Back", callback_data="tax_menu")],
    ]

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def tax_download_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle CSV download."""
    query = update.callback_query
    await query.answer("Generating export...")

    # Parse callback data
    try:
        parts = query.data.split("_")
        format_type = parts[1]
        year = int(parts[2])
    except (IndexError, ValueError):
        await query.edit_message_text("❌ Invalid export request.")
        return

    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.answer("❌ Please use /start first.", show_alert=True)
            return
        user_id = db_user.id

    # Generate CSV
    if format_type == "csv":
        csv_output = tax_export_service.generate_csv(user_id, year=year, format_type="standard")
        filename = f"suwappu_transactions_{year}.csv"
    elif format_type == "koinly":
        csv_output = tax_export_service.generate_csv(user_id, year=year, format_type="koinly")
        filename = f"suwappu_koinly_{year}.csv"
    else:
        csv_output = tax_export_service.generate_csv(user_id, year=year, format_type="cointracker")
        filename = f"suwappu_cointracker_{year}.csv"

    # Convert to bytes
    csv_bytes = io.BytesIO(csv_output.getvalue().encode("utf-8"))
    csv_bytes.name = filename

    # Send document
    await context.bot.send_document(
        chat_id=query.message.chat_id,
        document=csv_bytes,
        filename=filename,
        caption=f"📊 Your {year} transaction export ({format_type.upper()} format)",
    )


async def tax_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Return to tax menu."""
    query = update.callback_query
    await query.answer()

    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await query.edit_message_text("❌ Please use /start first.")
            return
        user_id = db_user.id

    years = tax_export_service.get_available_years(user_id)
    current_year = datetime.now().year

    if not years:
        years = [current_year]

    summary = tax_export_service.generate_summary(user_id, year=years[0])

    text = (
        f"📊 *Tax Export Center*\n\n"
        f"*{summary['year']} Summary*\n"
        f"📈 Transactions: *{summary['total_transactions']}*\n"
        f"💰 Volume: *{format_usd(summary['total_volume_usd'])}*"
    )

    keyboard = [
        [InlineKeyboardButton("📥 Download CSV", callback_data=f"tax_csv_{years[0]}")],
        [InlineKeyboardButton("« Back", callback_data="main_menu")],
    ]

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


# Create handlers
tax_handler = CommandHandler("tax", tax_command)
tax_year_callback_handler = CallbackQueryHandler(tax_year_callback, pattern="^tax_year_")
tax_download_callback_handler = CallbackQueryHandler(
    tax_download_callback, pattern="^tax_(csv|koinly|cointracker)_"
)
tax_menu_callback_handler = CallbackQueryHandler(tax_menu_callback, pattern="^tax_menu$")
