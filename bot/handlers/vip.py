"""/vip — cross-line VIP status.

Shows the user's effective tier (the better of their paid subscription and the
activity band earned from cross-product trading volume this season), the loyalty
earn multiplier it grants, and how much more volume reaches the next band.
"""

import logging

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CommandHandler

from bot.services.x402_service import x402_service
from bot.services.vip_service import vip_service
from database.db import get_session
from bot.models.user import User

logger = logging.getLogger(__name__)

_TIER_EMOJI = {"free": "🆓", "pro": "⭐", "premium": "💎", "enterprise": "🏢"}
_TIER_FEE = {"free": "1.0%", "pro": "0.5%", "premium": "0.3%", "enterprise": "0.1%"}


def _fmt_usd(amount: float) -> str:
    return "$" + f"{amount:,.0f}"


async def vip_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /vip — show cross-line VIP status."""
    user = update.effective_user

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please use /start first to register.")
            return
        user_id = db_user.id

    tier = await x402_service.get_tier(user_id)
    status = vip_service.get_status(user_id, tier)

    eff = str(status["effective_tier"]).lower()
    emoji = _TIER_EMOJI.get(eff, "📋")
    mult = status["point_multiplier"]

    lines = [
        f"{emoji} **VIP Status: {eff.upper()}**",
        "",
        f"**Swap fee:** {_TIER_FEE.get(eff, '—')}",
        f"**Loyalty earn:** {mult:g}× points on every trade",
        f"**Season volume:** {_fmt_usd(status['season_volume_usd'])} "
        "_(swaps + perps + predict + P2P)_",
    ]

    if status.get("is_boosted_by_activity"):
        lines.append("")
        lines.append("🔥 _Your trading volume has upgraded you above your paid tier._")

    if status.get("next_tier") and status.get("volume_to_next_usd") is not None:
        nxt = str(status["next_tier"]).upper()
        lines.append("")
        lines.append(
            f"📈 **{_fmt_usd(status['volume_to_next_usd'])}** more volume this season "
            f"unlocks **{nxt}** ({_TIER_FEE.get(str(status['next_tier']).lower(), '—')} fee)."
        )

    if not status.get("enabled"):
        lines.append("")
        lines.append("_Activity upgrades are currently paused; status reflects your plan._")

    lines.append("")
    lines.append("💡 _Status is the better of your plan and your trading. Trade more, or upgrade._")

    keyboard = [
        [InlineKeyboardButton("⬆️ Upgrade Plan", callback_data="sub_upgrade")],
        [InlineKeyboardButton("📊 Compare Plans", callback_data="sub_compare")],
    ]

    await update.message.reply_text(
        "\n".join(lines),
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )


vip_handler = CommandHandler("vip", vip_command)
