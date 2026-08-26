"""/positions — Suwappu Positions: live position cards on Robinhood Chain."""

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import CommandHandler, ContextTypes

from bot.services.position_cards_service import PRICED_TICKERS, position_cards_service

logger = logging.getLogger(__name__)

MINT_URL = "https://suwappu.bot/positions"


def _fmt_return(pos: dict) -> str:
    if not pos["priced"]:
        return "unpriced"
    pct = pos["return_bps"] / 100.0
    return f"{'+' if pct >= 0 else '−'}{abs(pct):,.1f}%"


async def position_cards_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show the user's position cards, their live P&L, and the fee perk."""
    user = update.effective_user

    # Rate limited like /bindwallet and /subscribe. One uncapped invocation can
    # drive ~100 eth_calls (get_positions reads returnBps + grade for up to 50
    # cards) plus four remaining_for_ticker calls and an indexer fetch, so
    # spamming it burns Robinhood Chain RPC quota and saturates the positions
    # executor for everyone else.
    try:
        from bot.utils.rate_limiter import enforce_rate_limit_for_update, swap_limiter

        if not await enforce_rate_limit_for_update(update, swap_limiter):
            return
    except ImportError:  # pragma: no cover - limiter is optional at import time
        pass

    from bot.models.user import User
    from database.db import get_session, run_in_db

    def _load_user_id():
        with get_session() as session:
            db_user = session.query(User).filter(User.telegram_id == user.id).first()
            return db_user.id if db_user else None

    # Off the event loop: a synchronous session here blocked every other user's
    # swap for the duration of the query, which is the defect the positions
    # service was just hardened against — its only caller should not reintroduce
    # it one line up.
    user_id = await run_in_db(_load_user_id)
    if user_id is None:
        await update.message.reply_text("❌ Please start the bot first with /start")
        return

    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("📈 Open a position", url=MINT_URL)]])

    if not position_cards_service.enabled:
        await update.message.reply_text(
            "📈 *Suwappu Positions*\n\n"
            f"Pick any of the {len(PRICED_TICKERS)} tokenized equities with a live "
            "Chainlink feed on Robinhood Chain and open a position on it. Your entry "
            "price is stamped on-chain at mint and never "
            "changes — the card re-renders against the live price forever.\n\n"
            "_Not live yet._",
            parse_mode="Markdown",
        )
        return

    discount_fraction = await position_cards_service.warm_for_user(user_id)

    if discount_fraction <= 0:
        al = position_cards_service.allowlist_status(user_id)
        phase = al["phase"]
        if phase == "Founder":
            head = (
                "🏆 *You're on the Founder list*\n\n"
                f"Earned by: {', '.join(al['reasons'])}\n"
                "*1 card, free* — Founder mints first."
            )
        elif phase == "Allowlist":
            head = (
                "✅ *You're on the allowlist*\n\n"
                f"Earned by: {', '.join(al['reasons'])}\n"
                "*Up to 2 cards at $19* — before public."
            )
        else:
            nxt = []
            if al["swaps"] < 5:
                nxt.append(f"{5 - al['swaps']} more swaps")
            if al["volume_usd"] < 1000:
                nxt.append(f"${1000 - al['volume_usd']:,.0f} more volume")
            if al["referrals"] < 1:
                nxt.append("1 referral (/ref)")
            head = "🃏 *Suwappu Position Cards*\n\n" "You're on the *public* mint.\n" + (
                f"Reach the allowlist with: {' or '.join(nxt)}\n" if nxt else ""
            )
        # Live scarcity on the names people actually ask for. remaining_for_ticker
        # existed with no callers — a supply signal nobody could see.
        scarce = []
        for symbol in ("NVDA", "TSLA", "AAPL", "SPCX"):
            left = await position_cards_service.remaining_for_ticker(symbol)
            if left is not None:
                scarce.append(f"`{symbol}` {left} left")
        if scarce:
            head += "\n" + " · ".join(scarce) + "\n"
        msg = (
            f"{head}\n"
            "Pick a ticker you actually believe in — no random assignment. Your entry "
            "price is stamped on-chain at mint and never changes, so the card is a "
            "permanent record of the call you made, and it re-renders against the live "
            "price forever.\n\n"
            "*Holding one takes 40% off your swap fee on Free, Pro and Premium* — "
            "on Free that's $4 back per $1,000 traded (100 bps → 60 bps). "
            "*Founders' Gold* ($119, the premium tier) takes *55%* off instead.\n\n"
            "_4,444 cards total. Collectible cards. Not equity, not a security, pays "
            "nothing._"
        )
    else:
        # Another DB round-trip — same rule, off the loop.
        address = await run_in_db(lambda: position_cards_service.evm_address_for_user(user_id))
        cards = await position_cards_service.get_positions(address)
        lines = [f"🃏 *Your position cards* — {len(cards)}\n"]
        for pos in cards[:10]:
            lines.append(f"`#{pos['token_id']:<5}` {_fmt_return(pos):>8}  {pos['grade']}")
        if len(cards) > 10:
            lines.append(f"_…and {len(cards) - 10} more_")
        lines.append(f"\nSwap fee discount: *−{discount_fraction * 100:.0f}%* on every swap")
        lines.append("_Stacks with your tier and points — never reaches zero._")
        msg = "\n".join(lines)

    await update.message.reply_text(msg, parse_mode="Markdown", reply_markup=keyboard)


position_cards_handler = CommandHandler("cards", position_cards_command)
