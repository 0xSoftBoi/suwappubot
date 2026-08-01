"""MPP (Machine Payments Protocol) handler for Telegram bot.

Commands:
    /mpp list [category]  — Browse MPP services directory
    /mpp pay <service> <amount>  — One-time payment to a service
    /mpp session <service>  — Start streaming payment session
    /mpp status  — View active sessions
"""

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler, CallbackQueryHandler

from bot.models.user import User
from bot.services.tempo_mpp import tempo_mpp
from bot.utils.formatters import format_usd
from database.db import get_session


async def mpp_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /mpp command — Machine Payments Protocol interactions."""
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first.")
            return

    args = context.args or []

    if not args:
        await _show_mpp_help(update)
        return

    subcommand = args[0].lower()

    if subcommand == "list":
        category = args[1] if len(args) > 1 else None
        await _list_services(update, category)
    elif subcommand == "pay":
        if len(args) < 3:
            await update.message.reply_text(
                "❌ Usage: `/mpp pay <service_url> <amount>`",
                parse_mode="Markdown",
            )
            return
        await _pay_service(update, args[1], float(args[2]))
    elif subcommand == "session":
        if len(args) < 2:
            await update.message.reply_text(
                "❌ Usage: `/mpp session <service_url>`",
                parse_mode="Markdown",
            )
            return
        await _start_session(update, args[1])
    elif subcommand == "status":
        await _show_status(update)
    else:
        await _show_mpp_help(update)


async def _show_mpp_help(update: Update) -> None:
    """Show MPP help text."""
    text = (
        "⚡ *Machine Payments Protocol (MPP)*\n\n"
        "Pay services and agents on Tempo with streaming micropayments.\n\n"
        "*Commands:*\n"
        "`/mpp list [category]` — Browse services\n"
        "`/mpp pay <url> <amount>` — One-time payment\n"
        "`/mpp session <url>` — Start streaming session\n"
        "`/mpp status` — View active sessions\n\n"
        "*Categories:* ai, data, compute, api"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def _list_services(update: Update, category: str = None) -> None:
    """List available MPP services."""
    services = await tempo_mpp.get_directory(category=category, limit=10)

    if not services:
        cat_text = f" in category '{category}'" if category else ""
        await update.message.reply_text(
            f"📭 No MPP services found{cat_text}.\n\n"
            "The MPP directory is still being populated as Tempo mainnet just launched."
        )
        return

    lines = ["⚡ *MPP Services Directory*\n"]
    for svc in services:
        features = []
        if svc.supports_streaming:
            features.append("🔄 streaming")
        if svc.supports_one_time:
            features.append("💳 one-time")
        feat_str = " | ".join(features)

        lines.append(
            f"*{svc.name}*\n"
            f"  {svc.description}\n"
            f"  Token: {svc.fee_token} | {feat_str}\n"
            f"  `{svc.url}`\n"
        )

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def _pay_service(update: Update, service_url: str, amount: float) -> None:
    """Make a one-time MPP payment."""
    await update.message.reply_text(
        f"💳 Sending {format_usd(amount)} to `{service_url}`...",
        parse_mode="Markdown",
    )

    result = await tempo_mpp.pay_one_time(
        service_url=service_url,
        amount=amount,
    )

    if result.success:
        text = (
            f"✅ *Payment Successful*\n\n"
            f"Amount: {format_usd(result.amount)}\n"
            f"Token: {result.fee_token}\n"
            f"Service: `{result.service_url}`"
        )
        if result.tx_hash:
            text += f"\nTx: [View](https://explore.tempo.xyz/tx/{result.tx_hash})"
    else:
        text = f"❌ Payment failed: {result.error}"

    await update.message.reply_text(text, parse_mode="Markdown")


async def _start_session(update: Update, service_url: str) -> None:
    """Start a streaming MPP session."""
    default_deposit = 5.0  # $5 default deposit

    await update.message.reply_text(
        f"🔄 Opening streaming session with `{service_url}`...\n"
        f"Deposit: {format_usd(default_deposit)}",
        parse_mode="Markdown",
    )

    session = await tempo_mpp.create_session(
        service_url=service_url,
        deposit_amount=default_deposit,
    )

    if session:
        text = (
            f"✅ *Session Active*\n\n"
            f"ID: `{session.session_id}`\n"
            f"Service: {session.service_name}\n"
            f"Deposit: {format_usd(session.deposit_amount)}\n"
            f"Status: 🟢 Active\n\n"
            f"Use `/mpp status` to check usage."
        )
    else:
        text = "❌ Failed to create session. The service may be unavailable."

    await update.message.reply_text(text, parse_mode="Markdown")


async def _show_status(update: Update) -> None:
    """Show active MPP sessions."""
    sessions = tempo_mpp.get_active_sessions()

    if not sessions:
        await update.message.reply_text(
            "📭 No active MPP sessions.\n\n" "Start one with `/mpp session <service_url>`",
            parse_mode="Markdown",
        )
        return

    lines = ["⚡ *Active MPP Sessions*\n"]
    for s in sessions:
        lines.append(
            f"*{s.service_name}*\n"
            f"  ID: `{s.session_id}`\n"
            f"  Deposit: {format_usd(s.deposit_amount)}\n"
            f"  Spent: {format_usd(s.spent_amount)}\n"
            f"  Status: 🟢 {s.status}\n"
        )

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


def get_mpp_handlers():
    """Return handlers for the /mpp command."""
    return [
        CommandHandler("mpp", mpp_command),
    ]
