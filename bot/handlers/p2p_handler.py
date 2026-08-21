"""P2P command handler for the Suwappu peer-to-peer fiat<>crypto marketplace.

Commands:
- /p2p - Open the P2P marketplace menu

Features:
- Browse aggregated P2P offers from native (Suwappu escrow), NoOnes and P2P.me
- Buy crypto with fiat / sell crypto for fiat
- External-handoff trades (NoOnes custodial, P2P.me self-custody deeplink)
- Native in-app escrow trades (escrow not yet wired -> graceful "coming soon")
- Create your own native offers
- View your offers & trade history, pause/cancel active offers

Flow:
/p2p -> MAIN_MENU -> [Buy crypto] [Sell crypto] [My offers/trades] [Create offer]
    Buy/Sell -> PICK_FIAT -> PICK_CRYPTO -> PICK_AMOUNT -> list_offers
        -> OFFER_LIST -> tap an offer -> OFFER_DETAIL
            -> execution_url set: "Continue on {Provider}" URL button
            -> native: PICK_PAYMENT -> start_trade -> escrow/pay instructions
                -> "I've paid" -> mark_fiat_sent
    Create offer -> CREATE_* states -> create_offer
    My offers/trades -> MY_ITEMS -> pause/cancel active offers

The aggregation + external-handoff paths are fully working. Native escrow trades
depend on an on-chain escrow that is not yet wired to the signer, so the native
trade path catches ``EscrowNotConfiguredError``/``P2PError`` and shows a clear
"native escrow coming soon" message instead of crashing.
"""

import logging
from typing import Optional

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes,
    ConversationHandler,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    filters,
)

from bot.models.user import User, Wallet
from bot.models.p2p import P2POfferType, P2POfferStatus
from bot.services.p2p_providers import P2POfferQuote
from bot.services.p2p_service import (
    p2p_service,
    P2PError,
    EscrowNotConfiguredError,
)
from bot.utils.rate_limiter import UserRateLimiter
from bot.utils.tos_utils import enforce_tos
from bot.services.error_guidance import user_facing_error
from database.db import get_session

logger = logging.getLogger(__name__)

# Conversation states
(
    MAIN_MENU,
    PICK_FIAT,
    PICK_CRYPTO,
    PICK_AMOUNT,
    OFFER_LIST,
    OFFER_DETAIL,
    PICK_PAYMENT,
    NATIVE_TRADE,
    MY_ITEMS,
    CREATE_TYPE,
    CREATE_FIAT,
    CREATE_CRYPTO,
    CREATE_CHAIN,
    CREATE_PRICE,
    CREATE_MIN,
    CREATE_MAX,
    CREATE_PAYMENTS,
    CREATE_REGION,
) = range(18)

# Rate limiter (mirrors predict_limiter)
p2p_limiter = UserRateLimiter(max_requests=15, window_seconds=60)

# Quick-pick options
FIAT_OPTIONS = ["USD", "EUR", "GBP", "NGN", "INR", "BRL"]
CRYPTO_OPTIONS = ["USDC", "USDT", "BTC", "ETH"]
# Default chain per crypto for native offers (matches the escrow/Base defaults).
CRYPTO_DEFAULT_CHAIN = {
    "USDC": "base",
    "USDT": "ethereum",
    "BTC": "bitcoin",
    "ETH": "ethereum",
}
CHAIN_OPTIONS = ["base", "ethereum", "solana", "polygon", "arbitrum"]

OFFERS_PER_PAGE = 5


# ============ HELPERS ============


def _source_badge(source: str) -> str:
    """Emoji + label badge for an offer source."""
    return {
        "native": "\U0001f7e2 Suwappu",
        "noones": "\U0001f535 NoOnes",
        "p2p_me": "\U0001f7e3 P2P.me",
    }.get(source, "⚪ " + source)


def _provider_name(source: str) -> str:
    return {
        "native": "Suwappu",
        "noones": "NoOnes",
        "p2p_me": "P2P.me",
    }.get(source, source)


def truncate(text: str, max_len: int = 60) -> str:
    if text is None:
        return ""
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def _fmt_price(quote: P2POfferQuote) -> str:
    """Price line — handoff offers (price 0) have no live quote."""
    if quote.price_per_unit and quote.price_per_unit > 0:
        return f"{quote.price_per_unit:,.4f} {quote.fiat_currency}/{quote.crypto_asset}"
    return "Live rate at checkout"


def _fmt_limits(quote: P2POfferQuote) -> str:
    if quote.min_fiat_amount or quote.max_fiat_amount:
        return (
            f"{quote.min_fiat_amount:,.0f}-{quote.max_fiat_amount:,.0f} " f"{quote.fiat_currency}"
        )
    return "No limits set"


def _fmt_rep(quote: P2POfferQuote) -> str:
    pct = (quote.completion_rate or 0) * 100
    return f"{pct:.1f}% ✔ ({quote.trade_count} trades)"


def _build_offer_card(quote: P2POfferQuote, index: int) -> str:
    """Compact one-offer card for the ranked list."""
    methods = quote.payment_methods or []
    top_methods = ", ".join(methods[:2]) if methods else "n/a"
    return (
        f"*{index}. {_source_badge(quote.source)}*\n"
        f"  Price: {_fmt_price(quote)}\n"
        f"  Limits: {_fmt_limits(quote)} | Pay: {top_methods}\n"
        f"  Maker: {truncate(quote.maker_handle or 'anon', 24)} | {_fmt_rep(quote)}"
    )


def _get_p2p_data(context: ContextTypes.DEFAULT_TYPE) -> dict:
    return context.user_data.setdefault("p2p", {})


async def _render(update: Update, text: str, keyboard: list, parse_mode: str = "Markdown") -> None:
    """Render output whether invoked from a command or a callback query."""
    markup = InlineKeyboardMarkup(keyboard)
    if update.callback_query is not None:
        await update.callback_query.edit_message_text(
            text, reply_markup=markup, parse_mode=parse_mode
        )
    else:
        await update.effective_message.reply_text(text, reply_markup=markup, parse_mode=parse_mode)


# ============ MAIN COMMAND ============


@enforce_tos
async def p2p_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /p2p command or the 'p2p_open' menu button — show the P2P menu."""
    user = update.effective_user
    if update.callback_query:
        await update.callback_query.answer()

    if not await p2p_limiter.check(str(user.id)):
        await update.effective_message.reply_text("Please wait before using this command again.")
        return ConversationHandler.END

    with get_session() as session:
        db_user = session.query(User).filter(User.telegram_id == user.id).first()
        if not db_user:
            await update.effective_message.reply_text(
                "Please use /start first to create your account."
            )
            return ConversationHandler.END

        wallet = (
            session.query(Wallet)
            .filter(
                Wallet.user_id == db_user.id,
                Wallet.is_default == True,  # noqa: E712
            )
            .first()
        )

        user_id = db_user.id
        region = (db_user.region or "").strip().upper() or None
        wallet_id = wallet.id if wallet else None
        wallet_address = wallet.address if wallet else None

    data = _get_p2p_data(context)
    data.update(
        {
            "user_id": user_id,
            "region": region,
            "wallet_id": wallet_id,
            "wallet_address": wallet_address,
            "page": 0,
        }
    )

    return await show_main_menu(update, context)


async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show the P2P marketplace main menu."""
    keyboard = [
        [
            InlineKeyboardButton("\U0001f6d2 Buy crypto", callback_data="p2p_buy"),
            InlineKeyboardButton("\U0001f4b5 Sell crypto", callback_data="p2p_sell"),
        ],
        [InlineKeyboardButton("\U0001f4cb My offers/trades", callback_data="p2p_mine")],
        [InlineKeyboardButton("➕ Create offer", callback_data="p2p_create")],
        [InlineKeyboardButton("❌ Close", callback_data="p2p_cancel")],
    ]

    text = (
        "*P2P Marketplace*\n\n"
        "Buy and sell crypto with fiat, peer to peer.\n\n"
        "*Buy crypto* - pay fiat, receive crypto\n"
        "*Sell crypto* - send crypto, receive fiat\n"
        "*My offers/trades* - manage your listings & history\n"
        "*Create offer* - list your own price\n\n"
        "_Aggregated across Suwappu escrow, NoOnes & P2P.me_"
    )

    await _render(update, text, keyboard)
    return MAIN_MENU


async def menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Return to the main P2P menu."""
    if update.callback_query:
        await update.callback_query.answer()
    return await show_main_menu(update, context)


# ============ BROWSE: FIAT / CRYPTO / AMOUNT ============


async def buy_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Taker wants to BUY crypto -> search maker sell_crypto offers."""
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)
    # offer_type is the MAKER side the taker searches.
    data["offer_type"] = P2POfferType.SELL_CRYPTO.value
    data["taker_action"] = "buy"
    return await _ask_fiat(update, context)


async def sell_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Taker wants to SELL crypto -> search maker buy_crypto offers."""
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)
    data["offer_type"] = P2POfferType.BUY_CRYPTO.value
    data["taker_action"] = "sell"
    return await _ask_fiat(update, context)


def _fiat_keyboard(prefix: str) -> list:
    keyboard = []
    row = []
    for cur in FIAT_OPTIONS:
        row.append(InlineKeyboardButton(cur, callback_data=f"{prefix}{cur}"))
        if len(row) == 3:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("✏️ Type it", callback_data=f"{prefix}custom")])
    return keyboard


async def _ask_fiat(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    action = data.get("taker_action", "buy")
    keyboard = _fiat_keyboard("p2p_fiat_")
    keyboard.append([InlineKeyboardButton("\U0001f519 Back", callback_data="p2p_menu")])
    await _render(
        update,
        f"*{action.title()} crypto*\n\nWhich *fiat currency*?",
        keyboard,
    )
    return PICK_FIAT


async def fiat_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    choice = query.data.replace("p2p_fiat_", "")
    data = _get_p2p_data(context)

    if choice == "custom":
        data["awaiting_fiat"] = True
        await query.edit_message_text(
            "*Enter fiat currency*\n\nSend a 3-letter code, e.g. `USD`, `KES`, `PHP`.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")]]
            ),
        )
        return PICK_FIAT

    data["fiat_currency"] = choice.upper()
    return await _ask_crypto(update, context)


async def receive_fiat_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    if not data.get("awaiting_fiat"):
        return PICK_FIAT
    code = update.message.text.strip().upper()
    if not (2 <= len(code) <= 4 and code.isalpha()):
        await update.message.reply_text(
            "Please send a valid currency code, e.g. `USD`.", parse_mode="Markdown"
        )
        return PICK_FIAT
    data["fiat_currency"] = code
    data["awaiting_fiat"] = False
    return await _ask_crypto(update, context)


async def _ask_crypto(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    keyboard = []
    row = []
    for asset in CRYPTO_OPTIONS:
        row.append(InlineKeyboardButton(asset, callback_data=f"p2p_crypto_{asset}"))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("\U0001f519 Back", callback_data="p2p_menu")])

    data = _get_p2p_data(context)
    await _render(
        update,
        f"*{data.get('fiat_currency', '')}* selected.\n\nWhich *crypto asset*?",
        keyboard,
    )
    return PICK_CRYPTO


async def crypto_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    asset = query.data.replace("p2p_crypto_", "").upper()
    data = _get_p2p_data(context)
    data["crypto_asset"] = asset
    return await _ask_amount(update, context)


async def _ask_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    keyboard = [
        [InlineKeyboardButton("Skip (browse all)", callback_data="p2p_amt_skip")],
        [InlineKeyboardButton("\U0001f519 Back", callback_data="p2p_menu")],
    ]
    await _render(
        update,
        f"*{data.get('fiat_currency', '')} → {data.get('crypto_asset', '')}*\n\n"
        f"Enter a *fiat amount* to filter offers (or Skip to see all):\n"
        f"_Example: `200`_",
        keyboard,
    )
    return PICK_AMOUNT


async def amount_skip_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)
    data["fiat_amount"] = None
    return await _load_and_show_offers(update, context)


async def receive_amount_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    try:
        amount = float(update.message.text.strip().replace(",", "").replace("$", ""))
        if amount <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text(
            "Please enter a valid positive number, e.g. `200`.", parse_mode="Markdown"
        )
        return PICK_AMOUNT
    data["fiat_amount"] = amount
    return await _load_and_show_offers(update, context)


# ============ OFFER LIST ============


async def _load_and_show_offers(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Call list_offers and render the ranked offers."""
    data = _get_p2p_data(context)
    data["page"] = 0

    try:
        offers = await p2p_service.list_offers(
            offer_type=data["offer_type"],
            fiat_currency=data["fiat_currency"],
            crypto_asset=data["crypto_asset"],
            fiat_amount=data.get("fiat_amount"),
            region=data.get("region"),
            limit=20,
        )
    except P2PError as e:
        logger.error(f"P2P list_offers rejected: {e}", exc_info=True)
        await _render(
            update,
            "*P2P unavailable*\n\n"
            + user_facing_error(
                e, prefix="", safe_exceptions=(P2PError,), escape_for_markdown=True
            ),
            [[InlineKeyboardButton("\U0001f519 Back", callback_data="p2p_menu")]],
        )
        return OFFER_LIST
    except Exception as e:  # noqa: BLE001
        logger.error(f"P2P list_offers error: {e}", exc_info=True)
        await _render(
            update,
            "*Could not load offers*\n\nSomething went wrong fetching the order book. Try again.",
            [[InlineKeyboardButton("\U0001f519 Back", callback_data="p2p_menu")]],
        )
        return OFFER_LIST

    data["offers"] = offers
    return await _show_offer_page(update, context)


async def _show_offer_page(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    offers = data.get("offers", [])
    page = data.get("page", 0)
    action = data.get("taker_action", "buy")

    if not offers:
        await _render(
            update,
            f"*No offers found*\n\n"
            f"No live {action} offers for "
            f"{data.get('fiat_currency')}/{data.get('crypto_asset')} right now.\n"
            f"Try a different pair or amount.",
            [
                [InlineKeyboardButton("\U0001f504 Retry", callback_data="p2p_retry")],
                [InlineKeyboardButton("\U0001f519 Back", callback_data="p2p_menu")],
            ],
        )
        return OFFER_LIST

    start = page * OFFERS_PER_PAGE
    end = start + OFFERS_PER_PAGE
    page_offers = offers[start:end]

    text = f"*{action.title()} {data.get('crypto_asset')} with {data.get('fiat_currency')}*\n\n"
    keyboard = []
    for i, quote in enumerate(page_offers, start=start + 1):
        text += _build_offer_card(quote, i) + "\n\n"
        keyboard.append([InlineKeyboardButton(f"Select #{i}", callback_data=f"p2p_offer_{i - 1}")])

    nav_row = []
    if page > 0:
        nav_row.append(InlineKeyboardButton("⬅️ Prev", callback_data=f"p2p_page_{page - 1}"))
    if end < len(offers):
        nav_row.append(InlineKeyboardButton("Next ➡️", callback_data=f"p2p_page_{page + 1}"))
    if nav_row:
        keyboard.append(nav_row)

    keyboard.append([InlineKeyboardButton("\U0001f519 Back", callback_data="p2p_menu")])

    total_pages = (len(offers) - 1) // OFFERS_PER_PAGE + 1
    text += f"_Page {page + 1}/{total_pages}_"

    await _render(update, text, keyboard)
    return OFFER_LIST


async def offer_page_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)
    data["page"] = int(query.data.replace("p2p_page_", ""))
    return await _show_offer_page(update, context)


async def retry_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    return await _load_and_show_offers(update, context)


# ============ OFFER DETAIL ============


async def offer_select_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show offer detail; branch by execution_url (external) vs native."""
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)

    try:
        idx = int(query.data.replace("p2p_offer_", ""))
    except ValueError:
        await query.edit_message_text("Invalid offer.")
        return OFFER_LIST

    offers = data.get("offers", [])
    if idx >= len(offers):
        await query.edit_message_text("Offer no longer available. Please refresh.")
        return OFFER_LIST

    quote = offers[idx]
    data["selected_offer_idx"] = idx

    methods = quote.payment_methods or []
    methods_str = ", ".join(methods) if methods else "n/a"

    detail = (
        f"*{_source_badge(quote.source)} offer*\n\n"
        f"*Pair:* {quote.crypto_asset} / {quote.fiat_currency}\n"
        f"*Price:* {_fmt_price(quote)}\n"
        f"*Limits:* {_fmt_limits(quote)}\n"
        f"*Chain:* {quote.crypto_chain}\n"
        f"*Payment:* {methods_str}\n"
        f"*Maker:* {truncate(quote.maker_handle or 'anon', 32)}\n"
        f"*Reputation:* {_fmt_rep(quote)}\n"
    )

    if quote.execution_url:
        provider = _provider_name(quote.source)
        if quote.source == "noones":
            settle_note = (
                "_Trade is escrowed and settled on NoOnes (custodial). "
                "You'll complete payment and release on their platform._"
            )
        else:
            settle_note = (
                "_Trade settles on P2P.me (self-custody handoff). "
                "Funds go directly to your wallet on completion._"
            )
        detail += f"\n{settle_note}"
        keyboard = [
            [InlineKeyboardButton(f"Continue on {provider} ↗", url=quote.execution_url)],
            [InlineKeyboardButton("\U0001f519 Back to offers", callback_data="p2p_back_list")],
        ]
        await query.edit_message_text(
            detail, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
        )
        return OFFER_DETAIL

    # Native, in-app trade.
    detail += "\n_Native escrow trade — settles non-custodially in-app._"
    keyboard = [
        [InlineKeyboardButton("✅ Start trade", callback_data="p2p_start_native")],
        [InlineKeyboardButton("\U0001f519 Back to offers", callback_data="p2p_back_list")],
    ]
    await query.edit_message_text(
        detail, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(keyboard)
    )
    return OFFER_DETAIL


async def back_to_list_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    return await _show_offer_page(update, context)


# ============ NATIVE TRADE ============


async def start_native_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Begin a native in-app trade: collect amount (if missing), then payment."""
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)

    offers = data.get("offers", [])
    idx = data.get("selected_offer_idx")
    if idx is None or idx >= len(offers):
        await query.edit_message_text("Session expired. Start again with /p2p")
        return ConversationHandler.END

    quote = offers[idx]

    if not data.get("fiat_amount"):
        data["awaiting_trade_amount"] = True
        await query.edit_message_text(
            f"*Trade amount*\n\n"
            f"How much {quote.fiat_currency} do you want to trade?\n"
            f"Range: {_fmt_limits(quote)}\n\n"
            f"_Example: `150`_",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")]]
            ),
        )
        return NATIVE_TRADE

    return await _ask_payment_method(update, context)


async def receive_trade_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    if not data.get("awaiting_trade_amount"):
        return NATIVE_TRADE
    try:
        amount = float(update.message.text.strip().replace(",", "").replace("$", ""))
        if amount <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text(
            "Please enter a valid positive number.", parse_mode="Markdown"
        )
        return NATIVE_TRADE
    data["fiat_amount"] = amount
    data["awaiting_trade_amount"] = False
    return await _ask_payment_method(update, context)


async def _ask_payment_method(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    offers = data.get("offers", [])
    idx = data.get("selected_offer_idx")
    quote = offers[idx] if idx is not None and idx < len(offers) else None
    methods = (quote.payment_methods if quote else None) or ["bank_transfer"]

    keyboard = [
        [InlineKeyboardButton(m, callback_data=f"p2p_pay_{i}")] for i, m in enumerate(methods)
    ]
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")])

    data["payment_options"] = methods
    await _render(
        update,
        "*Select a payment method:*",
        keyboard,
    )
    return PICK_PAYMENT


async def payment_method_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Picked a payment method -> attempt to start the native trade."""
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)

    try:
        pm_idx = int(query.data.replace("p2p_pay_", ""))
        payment_method = data.get("payment_options", [])[pm_idx]
    except (ValueError, IndexError):
        await query.edit_message_text("Invalid payment method.")
        return PICK_PAYMENT

    offers = data.get("offers", [])
    idx = data.get("selected_offer_idx")
    if idx is None or idx >= len(offers):
        await query.edit_message_text("Session expired. Start again with /p2p")
        return ConversationHandler.END
    quote = offers[idx]

    await query.edit_message_text(
        "*Starting trade...*\n\nSetting up the escrow trade, please wait.",
        parse_mode="Markdown",
    )

    try:
        trade = await p2p_service.start_trade(
            taker_user_id=data["user_id"],
            taker_wallet_address=data.get("wallet_address"),
            offer=quote,
            fiat_amount=float(data["fiat_amount"]),
            payment_method=payment_method,
            region=data.get("region"),
        )
        # Lock escrow when the taker is buying crypto. The seller (whose funds get
        # escrowed) is the MAKER here, so the service resolves the correct seller
        # wallet from the trade itself — we must not pass the taker's wallet.
        # Depends on the on-chain signer that is NOT yet wired.
        if data.get("taker_action") == "buy":
            await p2p_service.lock_escrow(trade_id=trade.id)
    except (EscrowNotConfiguredError, P2PError) as e:
        logger.info(f"Native P2P trade not completed (escrow/validation): {e}")
        await query.edit_message_text(
            "*Native escrow coming soon*\n\n"
            "On-chain escrow for native P2P trades isn't live yet, so this trade "
            "can't be completed in-app right now.\n\n"
            "Try a *NoOnes* or *P2P.me* offer from the list — those settle today.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [
                    [
                        InlineKeyboardButton(
                            "\U0001f519 Back to offers", callback_data="p2p_back_list"
                        )
                    ],
                    [InlineKeyboardButton("❌ Close", callback_data="p2p_cancel")],
                ]
            ),
        )
        return OFFER_DETAIL
    except Exception as e:  # noqa: BLE001
        logger.error(f"P2P start_trade error: {e}", exc_info=True)
        await query.edit_message_text(
            "*Trade failed*\n\nAn unexpected error occurred. No funds were moved.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("\U0001f519 Back to offers", callback_data="p2p_back_list")]]
            ),
        )
        return OFFER_DETAIL

    data["active_trade_id"] = trade.id

    keyboard = [
        [InlineKeyboardButton("✅ I've paid", callback_data="p2p_fiat_sent")],
        [InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")],
    ]
    await query.edit_message_text(
        f"*Trade #{trade.id} open* \U0001f512\n\n"
        f"*Pair:* {trade.crypto_asset} / {trade.fiat_currency}\n"
        f"*Amount:* {float(trade.fiat_amount):,.2f} {trade.fiat_currency}\n"
        f"*Pay via:* {payment_method}\n\n"
        f"The seller's crypto is escrowed. Send the fiat using the agreed "
        f"payment method, then tap *I've paid* below.\n\n"
        f"_You have {30} minutes before the trade auto-cancels._",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return NATIVE_TRADE


async def fiat_sent_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Taker marks fiat as sent."""
    query = update.callback_query
    await query.answer("Marking as paid...")
    data = _get_p2p_data(context)
    trade_id = data.get("active_trade_id")

    if not trade_id:
        await query.edit_message_text("Session expired. Start again with /p2p")
        return ConversationHandler.END

    try:
        await p2p_service.mark_fiat_sent(trade_id=trade_id)
    except (EscrowNotConfiguredError, P2PError) as e:
        logger.info(f"P2P mark_fiat_sent issue: {e}")
        await query.edit_message_text(
            "*Native escrow coming soon*\n\n"
            "We couldn't finalize the on-chain leg yet. Your trade is recorded; "
            "for an instant settle try a NoOnes/P2P.me offer.",
            parse_mode="Markdown",
        )
        context.user_data.pop("p2p", None)
        return ConversationHandler.END
    except Exception as e:  # noqa: BLE001
        logger.error(f"P2P mark_fiat_sent error: {e}", exc_info=True)
        await query.edit_message_text("An unexpected error occurred. Please contact support.")
        context.user_data.pop("p2p", None)
        return ConversationHandler.END

    await query.edit_message_text(
        f"*Payment marked as sent* ✅\n\n"
        f"Trade #{trade_id} is now awaiting the seller to confirm and release the "
        f"crypto from escrow. You'll be notified when it's released.\n\n"
        f"Use /p2p to view your trades.",
        parse_mode="Markdown",
    )
    context.user_data.pop("p2p", None)
    return ConversationHandler.END


# ============ MY OFFERS / TRADES ============


async def mine_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """List the user's offers and recent trades."""
    if update.callback_query:
        await update.callback_query.answer()
    data = _get_p2p_data(context)
    user_id = data.get("user_id")

    try:
        offers = await p2p_service.get_user_offers(user_id=user_id, limit=10)
        trades = await p2p_service.get_user_trades(user_id=user_id, limit=10)
    except Exception as e:  # noqa: BLE001
        logger.error(f"P2P get_user_* error: {e}", exc_info=True)
        await _render(
            update,
            "*Could not load your P2P activity.* Try again.",
            [[InlineKeyboardButton("\U0001f519 Back", callback_data="p2p_menu")]],
        )
        return MY_ITEMS

    text = "*My P2P offers & trades*\n\n"
    keyboard = []

    if offers:
        text += "*Your offers:*\n"
        for o in offers:
            text += (
                f"• #{o.id} {o.offer_type} {o.crypto_asset}/{o.fiat_currency} "
                f"@ {float(o.price_per_unit or 0):,.4f} — _{o.status}_\n"
            )
            if o.status == P2POfferStatus.ACTIVE.value:
                keyboard.append(
                    [
                        InlineKeyboardButton(f"⏸ Pause #{o.id}", callback_data=f"p2p_pause_{o.id}"),
                        InlineKeyboardButton(
                            f"\U0001f5d1 Cancel #{o.id}", callback_data=f"p2p_canc_{o.id}"
                        ),
                    ]
                )
        text += "\n"
    else:
        text += "_No offers yet._\n\n"

    if trades:
        text += "*Recent trades:*\n"
        for t in trades:
            text += (
                f"• #{t.id} [{_provider_name(t.source)}] "
                f"{t.crypto_asset}/{t.fiat_currency} "
                f"{float(t.fiat_amount or 0):,.2f} {t.fiat_currency} — _{t.status}_\n"
            )
    else:
        text += "_No trades yet._"

    keyboard.append([InlineKeyboardButton("\U0001f504 Refresh", callback_data="p2p_mine")])
    keyboard.append([InlineKeyboardButton("\U0001f519 Back", callback_data="p2p_menu")])

    await _render(update, text, keyboard)
    return MY_ITEMS


async def pause_offer_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)
    try:
        offer_id = int(query.data.replace("p2p_pause_", ""))
    except ValueError:
        return MY_ITEMS
    try:
        ok = await p2p_service.set_offer_status(
            offer_id=offer_id,
            maker_user_id=data["user_id"],
            status=P2POfferStatus.PAUSED.value,
        )
    except P2PError as e:
        logger.error(f"P2P pause_offer rejected for offer {offer_id}: {e}", exc_info=True)
        await query.answer(user_facing_error(e, safe_exceptions=(P2PError,)), show_alert=True)
        return MY_ITEMS
    if not ok:
        await query.answer("Offer not found.", show_alert=True)
    return await mine_callback(update, context)


async def cancel_offer_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)
    try:
        offer_id = int(query.data.replace("p2p_canc_", ""))
    except ValueError:
        return MY_ITEMS
    try:
        ok = await p2p_service.set_offer_status(
            offer_id=offer_id,
            maker_user_id=data["user_id"],
            status=P2POfferStatus.CANCELLED.value,
        )
    except P2PError as e:
        logger.error(f"P2P cancel_offer rejected for offer {offer_id}: {e}", exc_info=True)
        await query.answer(user_facing_error(e, safe_exceptions=(P2PError,)), show_alert=True)
        return MY_ITEMS
    if not ok:
        await query.answer("Offer not found.", show_alert=True)
    return await mine_callback(update, context)


# ============ CREATE OFFER ============


async def create_offer_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Begin the create-offer flow. Requires a default wallet (money action)."""
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)

    if not data.get("wallet_id"):
        await query.edit_message_text(
            "*Create offer*\n\n"
            "You need a wallet to list a native P2P offer.\n"
            "Use /wallet to create one, then try again.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("\U0001f519 Back", callback_data="p2p_menu")]]
            ),
        )
        return MAIN_MENU

    data["new_offer"] = {}
    keyboard = [
        [
            InlineKeyboardButton("Sell crypto (you sell)", callback_data="p2p_ct_sell_crypto"),
            InlineKeyboardButton("Buy crypto (you buy)", callback_data="p2p_ct_buy_crypto"),
        ],
        [InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")],
    ]
    await query.edit_message_text(
        "*Create a P2P offer*\n\nWhat do you want to do?",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return CREATE_TYPE


async def create_type_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)
    offer_type = query.data.replace("p2p_ct_", "")
    data["new_offer"]["offer_type"] = offer_type

    keyboard = _fiat_keyboard("p2p_cf_")
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")])
    await query.edit_message_text(
        "*Create offer*\n\nWhich *fiat currency*?",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return CREATE_FIAT


async def create_fiat_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)
    choice = query.data.replace("p2p_cf_", "")
    if choice == "custom":
        data["awaiting_create_fiat"] = True
        await query.edit_message_text(
            "*Create offer*\n\nSend a 3-letter fiat code, e.g. `USD`.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")]]
            ),
        )
        return CREATE_FIAT
    data["new_offer"]["fiat_currency"] = choice.upper()
    return await _create_ask_crypto(update, context)


async def receive_create_fiat_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    if not data.get("awaiting_create_fiat"):
        return CREATE_FIAT
    code = update.message.text.strip().upper()
    if not (2 <= len(code) <= 4 and code.isalpha()):
        await update.message.reply_text(
            "Please send a valid currency code, e.g. `USD`.", parse_mode="Markdown"
        )
        return CREATE_FIAT
    data["new_offer"]["fiat_currency"] = code
    data["awaiting_create_fiat"] = False
    return await _create_ask_crypto(update, context)


async def _create_ask_crypto(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    keyboard = []
    row = []
    for asset in CRYPTO_OPTIONS:
        row.append(InlineKeyboardButton(asset, callback_data=f"p2p_cc_{asset}"))
        if len(row) == 2:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")])
    await _render(update, "*Create offer*\n\nWhich *crypto asset*?", keyboard)
    return CREATE_CRYPTO


async def create_crypto_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)
    asset = query.data.replace("p2p_cc_", "").upper()
    data["new_offer"]["crypto_asset"] = asset

    keyboard = []
    row = []
    # Surface the default chain for this asset first.
    chains = [CRYPTO_DEFAULT_CHAIN.get(asset, "base")] + [
        c for c in CHAIN_OPTIONS if c != CRYPTO_DEFAULT_CHAIN.get(asset, "base")
    ]
    for chain in chains:
        row.append(InlineKeyboardButton(chain, callback_data=f"p2p_cch_{chain}"))
        if len(row) == 3:
            keyboard.append(row)
            row = []
    if row:
        keyboard.append(row)
    keyboard.append([InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")])
    await query.edit_message_text(
        f"*Create offer*\n\n{asset} selected. Which *chain*?",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )
    return CREATE_CHAIN


async def create_chain_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    data = _get_p2p_data(context)
    data["new_offer"]["crypto_chain"] = query.data.replace("p2p_cch_", "")
    no = data["new_offer"]
    await query.edit_message_text(
        f"*Create offer*\n\n"
        f"Enter your *price* — how much {no['fiat_currency']} per 1 "
        f"{no['crypto_asset']}?\n_Example: `1.02`_",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")]]
        ),
    )
    return CREATE_PRICE


async def create_price_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    try:
        price = float(update.message.text.strip().replace(",", "").replace("$", ""))
        if price <= 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text(
            "Please enter a valid positive price, e.g. `1.02`.", parse_mode="Markdown"
        )
        return CREATE_PRICE
    data["new_offer"]["price_per_unit"] = price
    no = data["new_offer"]
    await update.message.reply_text(
        f"*Minimum* trade amount in {no['fiat_currency']}?\n_Example: `20`_",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")]]
        ),
    )
    return CREATE_MIN


async def create_min_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    try:
        min_amt = float(update.message.text.strip().replace(",", "").replace("$", ""))
        if min_amt < 0:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Please enter a valid amount.", parse_mode="Markdown")
        return CREATE_MIN
    data["new_offer"]["min_fiat_amount"] = min_amt
    no = data["new_offer"]
    await update.message.reply_text(
        f"*Maximum* trade amount in {no['fiat_currency']}?\n_Example: `500`_",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")]]
        ),
    )
    return CREATE_MAX


async def create_max_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    try:
        max_amt = float(update.message.text.strip().replace(",", "").replace("$", ""))
    except ValueError:
        await update.message.reply_text("Please enter a valid amount.", parse_mode="Markdown")
        return CREATE_MAX
    if max_amt < data["new_offer"].get("min_fiat_amount", 0):
        await update.message.reply_text("Maximum must be >= minimum. Enter a larger amount.")
        return CREATE_MAX
    data["new_offer"]["max_fiat_amount"] = max_amt
    await update.message.reply_text(
        "*Payment methods* — send a comma-separated list.\n"
        "_Example: `bank_transfer, wise, revolut`_",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")]]
        ),
    )
    return CREATE_PAYMENTS


async def create_payments_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    methods = [m.strip() for m in update.message.text.split(",") if m.strip()]
    if not methods:
        await update.message.reply_text("Please send at least one payment method.")
        return CREATE_PAYMENTS
    data["new_offer"]["payment_methods"] = methods
    await update.message.reply_text(
        "*Region* — send an ISO country code (e.g. `US`, `NG`) or `skip` for global.",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("❌ Cancel", callback_data="p2p_cancel")]]
        ),
    )
    return CREATE_REGION


async def create_region_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    data = _get_p2p_data(context)
    raw = update.message.text.strip()
    region = None if raw.lower() == "skip" else raw.upper()
    no = data["new_offer"]

    try:
        offer_id = await p2p_service.create_offer(
            maker_user_id=data["user_id"],
            maker_wallet_id=data.get("wallet_id"),
            offer_type=no["offer_type"],
            fiat_currency=no["fiat_currency"],
            crypto_asset=no["crypto_asset"],
            crypto_chain=no["crypto_chain"],
            price_per_unit=no["price_per_unit"],
            min_fiat_amount=no["min_fiat_amount"],
            max_fiat_amount=no["max_fiat_amount"],
            payment_methods=no["payment_methods"],
            region=region,
        )
    except P2PError as e:
        logger.error(
            f"P2P create_offer rejected for user {data.get('user_id')}: {e}", exc_info=True
        )
        await update.message.reply_text(
            "*Could not create offer*\n\n"
            + user_facing_error(
                e, prefix="", safe_exceptions=(P2PError,), escape_for_markdown=True
            ),
            parse_mode="Markdown",
        )
        context.user_data.pop("p2p", None)
        return ConversationHandler.END
    except Exception as e:  # noqa: BLE001
        logger.error(f"P2P create_offer error: {e}", exc_info=True)
        await update.message.reply_text("An unexpected error occurred. Please try again.")
        context.user_data.pop("p2p", None)
        return ConversationHandler.END

    await update.message.reply_text(
        f"*Offer #{offer_id} created* ✅\n\n"
        f"{no['offer_type']} {no['crypto_asset']}/{no['fiat_currency']} "
        f"@ {no['price_per_unit']:,.4f}\n"
        f"Limits: {no['min_fiat_amount']:,.0f}-{no['max_fiat_amount']:,.0f} "
        f"{no['fiat_currency']}\n\n"
        f"It's now live in the order book. Use /p2p to manage it.",
        parse_mode="Markdown",
    )
    context.user_data.pop("p2p", None)
    return ConversationHandler.END


# ============ CANCEL ============


async def cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle cancel / close."""
    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text("P2P marketplace closed.")
    elif update.message:
        await update.message.reply_text("P2P marketplace closed.")
    context.user_data.pop("p2p", None)
    return ConversationHandler.END


# ============ CONVERSATION HANDLER ============

p2p_conversation_handler = ConversationHandler(
    name="p2p",
    persistent=True,
    entry_points=[
        CommandHandler("p2p", p2p_command),
        # Inline-button entry from the main menu ("🤝 P2P").
        CallbackQueryHandler(p2p_command, pattern="^p2p_open$"),
    ],
    states={
        MAIN_MENU: [
            CallbackQueryHandler(buy_callback, pattern="^p2p_buy$"),
            CallbackQueryHandler(sell_callback, pattern="^p2p_sell$"),
            CallbackQueryHandler(mine_callback, pattern="^p2p_mine$"),
            CallbackQueryHandler(create_offer_callback, pattern="^p2p_create$"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        PICK_FIAT: [
            CallbackQueryHandler(fiat_callback, pattern="^p2p_fiat_"),
            CallbackQueryHandler(menu_callback, pattern="^p2p_menu$"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, receive_fiat_text),
        ],
        PICK_CRYPTO: [
            CallbackQueryHandler(crypto_callback, pattern="^p2p_crypto_"),
            CallbackQueryHandler(menu_callback, pattern="^p2p_menu$"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        PICK_AMOUNT: [
            CallbackQueryHandler(amount_skip_callback, pattern="^p2p_amt_skip$"),
            CallbackQueryHandler(menu_callback, pattern="^p2p_menu$"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, receive_amount_text),
        ],
        OFFER_LIST: [
            CallbackQueryHandler(offer_select_callback, pattern="^p2p_offer_"),
            CallbackQueryHandler(offer_page_callback, pattern="^p2p_page_"),
            CallbackQueryHandler(retry_callback, pattern="^p2p_retry$"),
            CallbackQueryHandler(menu_callback, pattern="^p2p_menu$"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        OFFER_DETAIL: [
            CallbackQueryHandler(start_native_callback, pattern="^p2p_start_native$"),
            CallbackQueryHandler(back_to_list_callback, pattern="^p2p_back_list$"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        PICK_PAYMENT: [
            CallbackQueryHandler(payment_method_callback, pattern="^p2p_pay_\\d+$"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        NATIVE_TRADE: [
            CallbackQueryHandler(fiat_sent_callback, pattern="^p2p_fiat_sent$"),
            CallbackQueryHandler(back_to_list_callback, pattern="^p2p_back_list$"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, receive_trade_amount),
        ],
        MY_ITEMS: [
            CallbackQueryHandler(pause_offer_callback, pattern="^p2p_pause_\\d+$"),
            CallbackQueryHandler(cancel_offer_callback, pattern="^p2p_canc_\\d+$"),
            CallbackQueryHandler(mine_callback, pattern="^p2p_mine$"),
            CallbackQueryHandler(menu_callback, pattern="^p2p_menu$"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        CREATE_TYPE: [
            CallbackQueryHandler(create_type_callback, pattern="^p2p_ct_"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        CREATE_FIAT: [
            CallbackQueryHandler(create_fiat_callback, pattern="^p2p_cf_"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, receive_create_fiat_text),
        ],
        CREATE_CRYPTO: [
            CallbackQueryHandler(create_crypto_callback, pattern="^p2p_cc_"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        CREATE_CHAIN: [
            CallbackQueryHandler(create_chain_callback, pattern="^p2p_cch_"),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        CREATE_PRICE: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, create_price_handler),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        CREATE_MIN: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, create_min_handler),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        CREATE_MAX: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, create_max_handler),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        CREATE_PAYMENTS: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, create_payments_handler),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
        CREATE_REGION: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, create_region_handler),
            CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        ],
    },
    fallbacks=[
        CommandHandler("p2p", p2p_command),
        CallbackQueryHandler(cancel_callback, pattern="^p2p_cancel$"),
        CommandHandler("cancel", cancel_callback),
    ],
)
