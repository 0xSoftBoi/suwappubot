"""xStocks handler — tokenized equities on Solana via Backed Finance.

Commands:
  /stocks          — list available xStocks and enter the tap-to-trade flow

xStocks are SPL Token-2022 tokens issued by Backed Finance on Solana.  They
are routable via Jupiter, which Suwappu already aggregates.  This handler is
therefore a discovery and geo-gate surface only — it does NOT build new swap
execution.  Trade buttons funnel into the existing paste-to-trade / swap flow
via context.user_data["paste_token"] + "pbuy_<amount>" callbacks, exactly as
bot/handlers/trending.py and bot/handlers/paste_trade.py do.

COMPLIANCE
----------
US, UK, Canada, and Australia persons are PROHIBITED from xStocks at the
issuance level.  The on-chain Transfer Hook enforcement is currently DISABLED,
so geo-fencing is our responsibility.  The gate in this handler is fail-closed:

  * Known blocked region (US / GB / CA / AU) -> hard block, clear message.
  * Unknown / unset region (None or "")       -> hard block, ask user to
    contact support to confirm their region via /setregion (admin-only, KYC).

Fail-closed was chosen deliberately.  Polymarket (bot/handlers/predict.py) is
fail-open because Polymarket itself geo-blocks at the network edge.  xStocks
has NO on-chain enforcement fallback, so we must be the last line of defence.

MARKET-HOURS WARNING
--------------------
US equities regular hours are Mon-Fri 09:30-16:00 US/Eastern.  Off-hours
(evenings, weekends, holidays) liquidity on Jupiter can drop substantially and
spreads widen.  A visible warning is shown whenever the user initiates a trade
outside regular hours.
"""

import logging
from datetime import datetime, timezone, time as dtime

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import CallbackQueryHandler, CommandHandler, ContextTypes

from bot.config.xstocks import (
    XSTOCKS,
    XSTOCKS_BLOCKED_REGION_NAMES,
    XSTOCKS_BLOCKED_REGIONS,
    get_all_xstocks,
    get_xstock,
    xstocks_region_allowed,
)
from bot.utils.tos_utils import enforce_tos

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Geo-gate
# ---------------------------------------------------------------------------

# How to read User.region from the DB is the same pattern as fund.hyperunit_allowed:
#   - region is an ISO-3166 alpha-2 string set by /setregion (admin, KYC-driven).
#   - None / "" = unknown; we treat that as blocked (fail-closed).

_BLOCKED_REGIONS_MSG = (
    "*xStocks are not available in your region*\n\n"
    f"Trading of tokenized equities (xStocks) is restricted in {XSTOCKS_BLOCKED_REGION_NAMES} "
    "due to regulatory requirements from the token issuer (Backed Finance).\n\n"
    "If you believe this is an error, contact support — your account region "
    "must be set by a verified operator using the /setregion command."
)

_UNKNOWN_REGION_MSG = (
    "*xStocks require region verification*\n\n"
    "Tokenized equity trading (xStocks) is only available in jurisdictions outside "
    f"{XSTOCKS_BLOCKED_REGION_NAMES}.\n\n"
    "Your account region has not been set.  Please contact support to complete "
    "region verification before accessing xStocks."
)


def _xstocks_region_allowed(telegram_id: int) -> tuple[bool, str]:
    """Check whether this user may access xStocks.

    Thin delegation wrapper around the shared gate in bot.config.xstocks so
    that behavior is identical at every execution surface.  See
    xstocks_region_allowed() in that module for full documentation.
    """
    return xstocks_region_allowed(telegram_id)


# ---------------------------------------------------------------------------
# Market-hours helpers
# ---------------------------------------------------------------------------

# US Eastern offsets (we use fixed UTC offsets; good enough for a liquidity
# warning — we do NOT need to handle DST transitions precisely).
_ET_UTC_OFFSET_HOURS_STD = -5  # EST (Nov-Mar)
_ET_UTC_OFFSET_HOURS_DST = -4  # EDT (Mar-Nov)

# Market hours in ET: 09:30 – 16:00
_MARKET_OPEN_ET = dtime(9, 30)
_MARKET_CLOSE_ET = dtime(16, 0)


def _is_market_hours() -> bool:
    """Return True when US equity regular session is likely open.

    Uses a DST approximation: EDT applies roughly Mar (2nd Sun) to Nov (1st Sun).
    This is intentionally imprecise — it drives only a liquidity *warning*, not a
    hard block.
    """
    now_utc = datetime.now(timezone.utc)
    # Approximate DST: April–October = EDT (-4), else EST (-5).
    month = now_utc.month
    if 4 <= month <= 10:
        et_hour = now_utc.hour + _ET_UTC_OFFSET_HOURS_DST
    else:
        et_hour = now_utc.hour + _ET_UTC_OFFSET_HOURS_STD

    # Wrap to 0-23
    et_hour = et_hour % 24

    # Monday=0 … Sunday=6
    # The ET date can differ from UTC date at boundaries; for a simple hour
    # check the approximation is acceptable.
    weekday = now_utc.weekday()
    if weekday >= 5:  # Saturday or Sunday
        return False

    et_minute = now_utc.minute
    current_et = dtime(et_hour, et_minute)
    return _MARKET_OPEN_ET <= current_et < _MARKET_CLOSE_ET


def _market_hours_warning() -> str:
    """Return a warning string when the user is trading outside market hours, else ''."""
    if _is_market_hours():
        return ""
    return (
        "\n\n*Off-hours liquidity warning*: US equity markets are currently closed "
        "(regular session: Mon-Fri 09:30-16:00 ET).  Jupiter liquidity for xStocks "
        "typically drops ~70% outside regular hours — expect wider spreads and higher "
        "price impact.  Consider waiting for the market open or using a tighter slippage."
    )


# ---------------------------------------------------------------------------
# Keyboard helpers
# ---------------------------------------------------------------------------

_ITEMS_PER_PAGE = 5


def _stocks_keyboard(page: int = 0) -> InlineKeyboardMarkup:
    """Build the paginated xStocks listing keyboard."""
    stocks = get_all_xstocks()
    total = len(stocks)
    start = page * _ITEMS_PER_PAGE
    end = min(start + _ITEMS_PER_PAGE, total)
    page_stocks = stocks[start:end]

    rows: list[list[InlineKeyboardButton]] = []
    for entry in page_stocks:
        conf_tag = "" if entry["confidence"] == "high" else " *"
        rows.append(
            [
                InlineKeyboardButton(
                    f"{entry['ticker']}{conf_tag} — {entry['name']}",
                    callback_data=f"xs_view_{entry['ticker']}",
                )
            ]
        )

    nav: list[InlineKeyboardButton] = []
    if page > 0:
        nav.append(InlineKeyboardButton("Prev", callback_data=f"xs_page_{page - 1}"))
    if end < total:
        nav.append(InlineKeyboardButton("Next", callback_data=f"xs_page_{page + 1}"))
    if nav:
        rows.append(nav)

    rows.append([InlineKeyboardButton("Close", callback_data="xs_close")])
    return InlineKeyboardMarkup(rows)


def _trade_keyboard(ticker: str) -> InlineKeyboardMarkup:
    """Buy / Sell buttons for a single xStock.

    Buy  = SOL presets that trigger paste_buy_entry in the swap conversation.
           We stash paste_token pointing at the xStock mint and use pbuy_
           callbacks — identical path to trending.py's tbuy_ buttons.
    Sell = navigates user to /s and pre-populates a hint (the swap flow handles
           the sell side once the user pastes the token).
    """
    rows: list[list[InlineKeyboardButton]] = [
        [
            InlineKeyboardButton("Buy 0.5 SOL", callback_data="pbuy_0.5"),
            InlineKeyboardButton("Buy 1 SOL", callback_data="pbuy_1.0"),
        ],
        [
            InlineKeyboardButton("Buy 5 SOL", callback_data="pbuy_5.0"),
            InlineKeyboardButton("Custom amount", callback_data="pbuy_custom"),
        ],
        [
            InlineKeyboardButton("Sell (use /s)", callback_data="xs_sell_hint"),
        ],
        [InlineKeyboardButton("Back to list", callback_data="xs_list_0")],
    ]
    return InlineKeyboardMarkup(rows)


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


@enforce_tos
async def stocks_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/stocks — show xStocks listing with geo-gate."""
    user = update.effective_user
    if not user:
        return

    allowed, reason = _xstocks_region_allowed(user.id)
    if not allowed:
        msg = _UNKNOWN_REGION_MSG if reason == "unknown" else _BLOCKED_REGIONS_MSG
        await update.message.reply_text(msg, parse_mode="Markdown")
        return

    total = len(XSTOCKS)
    text = (
        "*xStocks — Tokenized Equities on Solana*\n\n"
        f"Trade {total} real-world assets as SPL tokens via Jupiter.\n"
        "Backed Finance issues and redeems each token 1-for-1 with the underlying equity.\n\n"
        "Tap any stock to see details and buy with SOL.\n\n"
        "_* = medium confidence — verify mint before large trades_"
    )
    text += _market_hours_warning()
    await update.message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=_stocks_keyboard(0),
    )


async def stocks_page_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle xs_page_<n> pagination callbacks."""
    query = update.callback_query
    await query.answer()

    allowed, reason = _xstocks_region_allowed(query.from_user.id)
    if not allowed:
        msg = _UNKNOWN_REGION_MSG if reason == "unknown" else _BLOCKED_REGIONS_MSG
        await query.edit_message_text(msg, parse_mode="Markdown")
        return

    try:
        page = int(query.data.replace("xs_page_", ""))
    except (ValueError, AttributeError):
        page = 0

    total = len(XSTOCKS)
    text = (
        "*xStocks — Tokenized Equities on Solana*\n\n"
        f"Trade {total} real-world assets as SPL tokens via Jupiter.\n"
        "Tap any stock to see details and buy with SOL.\n\n"
        "_* = medium confidence — verify mint before large trades_"
    )
    text += _market_hours_warning()
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=_stocks_keyboard(page),
    )


async def stocks_view_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle xs_view_<TICKER> — show stock detail card + trade buttons."""
    query = update.callback_query
    await query.answer()

    allowed, reason = _xstocks_region_allowed(query.from_user.id)
    if not allowed:
        msg = _UNKNOWN_REGION_MSG if reason == "unknown" else _BLOCKED_REGIONS_MSG
        await query.edit_message_text(msg, parse_mode="Markdown")
        return

    ticker = query.data.replace("xs_view_", "").upper()
    entry = get_xstock(ticker)
    if not entry:
        await query.edit_message_text("Unknown ticker. Use /stocks to see the list.")
        return

    # Stash paste_token so the swap conversation's paste_buy_entry can read it.
    # This is identical to how trending.py pre-seeds the swap context.
    context.user_data["paste_token"] = {
        "chain": "solana",
        "address": entry["solana_mint"],
        "symbol": entry["ticker"],
        "name": entry["name"],
        "decimals": 9,
    }

    conf_label = "High" if entry["confidence"] == "high" else "Medium (verify before large trades)"
    text = (
        f"*{entry['ticker']}* — {entry['name']}\n\n"
        f"Chain: Solana (SPL Token-2022)\n"
        f"Mint: `{entry['solana_mint']}`\n"
        f"Confidence: {conf_label}\n"
        f"Venue: Jupiter (auto-routed)\n\n"
        f"Select a buy amount below, or use /s to build a custom swap.\n"
        f"To *sell*, use /s and paste the mint address above as the From token."
    )
    text += _market_hours_warning()

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=_trade_keyboard(ticker),
    )


async def stocks_list_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle xs_list_<n> — return to listing at page n."""
    query = update.callback_query
    await query.answer()

    allowed, reason = _xstocks_region_allowed(query.from_user.id)
    if not allowed:
        msg = _UNKNOWN_REGION_MSG if reason == "unknown" else _BLOCKED_REGIONS_MSG
        await query.edit_message_text(msg, parse_mode="Markdown")
        return

    try:
        page = int(query.data.replace("xs_list_", ""))
    except (ValueError, AttributeError):
        page = 0

    total = len(XSTOCKS)
    text = (
        "*xStocks — Tokenized Equities on Solana*\n\n"
        f"Trade {total} real-world assets as SPL tokens via Jupiter.\n"
        "Tap any stock to see details and buy with SOL.\n\n"
        "_* = medium confidence — verify mint before large trades_"
    )
    text += _market_hours_warning()
    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=_stocks_keyboard(page),
    )


async def stocks_sell_hint_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle xs_sell_hint — guide user to sell via /s."""
    query = update.callback_query
    await query.answer()

    allowed, reason = _xstocks_region_allowed(query.from_user.id)
    if not allowed:
        msg = _UNKNOWN_REGION_MSG if reason == "unknown" else _BLOCKED_REGIONS_MSG
        await query.edit_message_text(msg, parse_mode="Markdown")
        return

    token = context.user_data.get("paste_token", {})
    mint = token.get("address", "")
    ticker = token.get("symbol", "the token")

    text = (
        f"*Selling {ticker}*\n\n"
        "To sell an xStock:\n"
        f"1. Use /s to open the swap flow\n"
        f"2. Set From token to: `{mint}`\n"
        f"3. Set To token to USDC or SOL\n"
        f"4. Enter the amount and confirm\n\n"
        "Or paste the mint address directly in the chat to get Buy/Sell options."
    )
    await query.edit_message_text(text, parse_mode="Markdown")


async def stocks_close_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle xs_close — dismiss the xStocks panel."""
    query = update.callback_query
    await query.answer()
    context.user_data.pop("paste_token", None)
    await query.edit_message_text("xStocks panel closed. Use /stocks to reopen.")


# ---------------------------------------------------------------------------
# Handler objects for registration in bot/main.py
# ---------------------------------------------------------------------------

stocks_command_handler = CommandHandler("stocks", stocks_command)

stocks_page_callback_handler = CallbackQueryHandler(stocks_page_callback, pattern=r"^xs_page_\d+$")
stocks_view_callback_handler = CallbackQueryHandler(
    stocks_view_callback, pattern=r"^xs_view_[A-Z]+x?$"
)
stocks_list_callback_handler = CallbackQueryHandler(stocks_list_callback, pattern=r"^xs_list_\d+$")
stocks_sell_hint_callback_handler = CallbackQueryHandler(
    stocks_sell_hint_callback, pattern="^xs_sell_hint$"
)
stocks_close_callback_handler = CallbackQueryHandler(stocks_close_callback, pattern="^xs_close$")
