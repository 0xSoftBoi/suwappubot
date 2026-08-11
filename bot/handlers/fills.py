"""/fills — Suwappu Fills NFT tickets and the perks they grant.

Shows the tickets a user's EVM wallet holds on Robinhood Chain (chain 4663),
the swap-fee discount the best one grants, and the tickers currently earning
an XP boost. Read-only.
"""

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import CommandHandler, ContextTypes

from bot.services.fills_service import fills_service

logger = logging.getLogger(__name__)

MINT_URL = "https://suwappu.bot/fills"


async def fills_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show the user's Fills tickets and active perks."""
    user = update.effective_user

    from bot.models.user import User
    from database.db import get_session

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.message.reply_text("❌ Please start the bot first with /start")
            return
        user_id = db_user.id

    if not fills_service.enabled:
        await update.message.reply_text(
            "🎟 *Suwappu Fills*\n\n"
            "10,000 order tickets for the tokenized equities on Robinhood Chain.\n"
            "Hold one and every swap gets cheaper.\n\n"
            "_The collection is not live yet._",
            parse_mode="Markdown",
        )
        return

    bps = await fills_service.warm_for_user(user_id)

    if bps <= 0:
        msg = (
            "🎟 *Suwappu Fills*\n\n"
            "No tickets found in your EVM wallet.\n\n"
            "Each Fill is a filled order ticket for one of the ~96 tokenized "
            "equities on Robinhood Chain. Holding one runs a desk:\n\n"
            "`Retail`  −5 bps · +2.5% ticker XP\n"
            "`Desk`   −10 bps · +5% ticker XP\n"
            "`Prime`  −20 bps · +10% ticker XP\n"
            "`Whale`  −35 bps · +20% ticker XP\n"
            "`House`  −50 bps · +35% ticker XP\n\n"
            "_Collectible tickets. Not equity — no shareholder rights._"
        )
    else:
        desk = {5: "Retail", 10: "Desk", 20: "Prime", 35: "Whale", 50: "House"}.get(bps, "Retail")
        xp = {5: "2.5", 10: "5", 20: "10", 35: "20", 50: "35"}.get(bps, "2.5")
        msg = (
            f"🎟 *Suwappu Fills — {desk} desk*\n\n"
            f"Swap fee: *−{bps} bps* on every swap\n"
            f"Ticker XP: *+{xp}%* on swaps of a ticker you hold a ticket for\n\n"
            "_Applied automatically at quote time. Discounts stack with your tier "
            "and points, floored at 0.1%._"
        )

    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("🎟 View collection", url=MINT_URL)]])
    await update.message.reply_text(msg, parse_mode="Markdown", reply_markup=keyboard)


fills_handler = CommandHandler("fills", fills_command)
