"""Predict command handler for Polymarket prediction market trading.

Commands:
- /predict - Open prediction markets menu

Features:
- Browse trending markets
- Search markets by keyword
- View market details with orderbook
- Place BUY YES / BUY NO orders
- Track open positions with live PnL
- View order history

Flow:
/predict -> MAIN_MENU -> [Trending] [Search] [My Positions] [History]
    -> BROWSE_MARKETS -> Paginated market cards
    -> MARKET_DETAIL -> Question, prices, orderbook, [Buy YES] [Buy NO]
    -> ENTER_AMOUNT -> Quick buttons [5] [10] [25] [50] [Custom]
    -> CONFIRM_ORDER -> Summary, potential payout, [Confirm] [Cancel]
    -> Execute -> DB insert -> show result
    -> MY_POSITIONS -> Open positions with PnL
"""

import logging
from decimal import Decimal
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

from bot.config.settings import settings
from bot.models.user import User, Wallet
from bot.models.predict import PredictionOrder, PredictionPosition
from bot.services.polymarket_api import polymarket_client, MarketInfo
from bot.services.wallet import WalletService
from bot.utils.rate_limiter import UserRateLimiter
from bot.utils.region_gate import derivatives_region_allowed, derivatives_blocked_message
from bot.utils.telegram_safe import safe_md
from bot.utils.tos_utils import enforce_tos
from database.db import get_session

logger = logging.getLogger(__name__)

# Conversation states
(
    MAIN_MENU,
    BROWSE_MARKETS,
    MARKET_DETAIL,
    ENTER_AMOUNT,
    CONFIRM_ORDER,
    MY_POSITIONS,
    HISTORY,
) = range(7)

# Rate limiter
predict_limiter = UserRateLimiter(max_requests=15, window_seconds=60)

wallet_service = WalletService()

# Pagination
MARKETS_PER_PAGE = 5


# ============ HELPERS ============


def _polymarket_restricted_regions() -> set:
    """Regions where Polymarket trading/redemption is geo-blocked.

    Polymarket blocks the US and ~33 other jurisdictions. We reuse the same
    operator-set ``User.region`` infra that HyperUnit/HL funding uses. Defaults
    to the US-only fallback when no explicit setting is configured.
    """
    raw = getattr(settings, "polymarket_restricted_regions", None)
    if raw is None:
        raw = getattr(settings, "hyperunit_restricted_regions", "US") or "US"
    return {r.strip().upper() for r in str(raw).split(",") if r.strip()}


def polymarket_region_allowed(telegram_id: int) -> bool:
    """Whether Polymarket on-chain redemption may be offered to this user.

    Mirrors ``fund.hyperunit_allowed``: a KNOWN region not in the restricted set
    is allowed; an unknown region is allowed too (fail-open) — Polymarket itself
    geo-blocks at the network edge, and existing /predict trading is not region
    gated, so we only hard-refuse users we positively know are restricted.
    """
    try:
        with get_session() as session:
            user = session.query(User).filter(User.telegram_id == telegram_id).first()
            region = (user.region or "").strip().upper() if user else ""
        if not region:
            return True  # unknown — do not block (matches untracked trade flow)
        return region not in _polymarket_restricted_regions()
    except Exception as e:  # noqa: BLE001 — never break redeem on a region read
        logger.warning("polymarket region lookup failed for %s: %s", telegram_id, e)
        return True


def truncate(text: str, max_len: int = 100) -> str:
    """Truncate text to max length."""
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."


def format_price_bar(yes_price: float, width: int = 10) -> str:
    """Format YES/NO prices as a visual bar."""
    yes_pct = int(yes_price * width)
    no_pct = width - yes_pct
    return f"{'=' * yes_pct}|{'=' * no_pct}"


def format_volume(vol: float) -> str:
    """Format volume for display."""
    if vol >= 1_000_000:
        return f"${vol / 1_000_000:.1f}M"
    if vol >= 1_000:
        return f"${vol / 1_000:.1f}K"
    return f"${vol:.0f}"


def format_usdc(amount) -> str:
    """Format USDC amount."""
    if amount is None:
        return "$0.00"
    val = float(amount)
    return f"${val:,.2f}"


def _build_market_card(market: MarketInfo, index: int = 0) -> str:
    """Build a compact market card for display."""
    question = safe_md(truncate(market.question))
    yes_pct = market.outcome_yes_price * 100
    no_pct = market.outcome_no_price * 100
    bar = format_price_bar(market.outcome_yes_price)

    card = (
        f"*{index}. {question}*\n"
        f"  YES {yes_pct:.0f}% {bar} {no_pct:.0f}% NO\n"
        f"  Vol: {format_volume(market.volume_24hr)}"
    )
    if market.end_date:
        end_display = market.end_date[:10] if len(market.end_date) >= 10 else market.end_date
        card += f" | Ends: {end_display}"
    return card


def _get_yes_token(market: MarketInfo) -> Optional[dict]:
    """Extract YES token from market tokens."""
    for t in market.tokens:
        if t.get("outcome", "").lower() == "yes":
            return t
    return None


def _get_no_token(market: MarketInfo) -> Optional[dict]:
    """Extract NO token from market tokens."""
    for t in market.tokens:
        if t.get("outcome", "").lower() == "no":
            return t
    return None


# ============ MAIN COMMAND ============


@enforce_tos
async def predict_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle /predict command or the 'predict_open' menu button.

    Works for both a slash command (update.message) and an inline-button entry
    point (update.callback_query) — use effective_message for any pre-menu
    replies and answer the callback to clear the button spinner.
    """
    user = update.effective_user
    if update.callback_query:
        await update.callback_query.answer()

    if not derivatives_region_allowed(user.id):
        await update.effective_message.reply_text(derivatives_blocked_message())
        return ConversationHandler.END

    if not await predict_limiter.check(str(user.id)):
        await update.effective_message.reply_text("Please wait before using this command again.")
        return ConversationHandler.END

    # Check user exists and has wallet
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
                Wallet.chain_type == "evm",
                Wallet.is_default == True,  # noqa: E712
            )
            .first()
        )

        if not wallet:
            await update.effective_message.reply_text(
                "You need an EVM wallet to trade on prediction markets.\n"
                "Use /wallet to create one."
            )
            return ConversationHandler.END

        user_id = db_user.id
        wallet_id = wallet.id
        wallet_address = wallet.address

    context.user_data["predict"] = {
        "user_id": user_id,
        "wallet_id": wallet_id,
        "wallet_address": wallet_address,
        "page": 0,
    }

    return await show_main_menu(update, context)


async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show prediction markets main menu."""
    keyboard = [
        [
            InlineKeyboardButton("Trending", callback_data="pred_trending"),
            InlineKeyboardButton("Search", callback_data="pred_search"),
        ],
        [
            InlineKeyboardButton("My Positions", callback_data="pred_positions"),
            InlineKeyboardButton("History", callback_data="pred_history"),
        ],
        [InlineKeyboardButton("Cancel", callback_data="pred_cancel")],
    ]

    text = (
        "*Prediction Markets*\n\n"
        "Trade on real-world events via Polymarket.\n\n"
        "*Trending* - Hot markets by volume\n"
        "*Search* - Find specific markets\n"
        "*My Positions* - Open positions & PnL\n"
        "*History* - Past orders\n\n"
        "_Powered by Polymarket on Polygon_"
    )

    if update.callback_query:
        await update.callback_query.edit_message_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )
    else:
        await update.message.reply_text(
            text,
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(keyboard),
        )

    return MAIN_MENU


# ============ BROWSE MARKETS ============


async def trending_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show trending markets."""
    query = update.callback_query
    await query.answer()

    pred_data = context.user_data.get("predict", {})
    page = pred_data.get("page", 0)

    markets = await polymarket_client.get_trending_markets(limit=20)

    if not markets:
        await query.edit_message_text(
            "*Trending Markets*\n\n" "No markets available right now.\n" "Try again later.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("Refresh", callback_data="pred_trending")],
                    [InlineKeyboardButton("Back", callback_data="pred_menu")],
                ]
            ),
        )
        return BROWSE_MARKETS

    # Store markets in context for detail navigation
    pred_data["markets"] = markets
    pred_data["browse_mode"] = "trending"

    return await _show_market_list(query, context, markets, page, "Trending Markets")


async def search_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Prompt for search query."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text(
        "*Search Markets*\n\n" "Send your search query.\n\n" "_Example: election, bitcoin, AI_",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("Cancel", callback_data="pred_cancel")]]
        ),
    )

    context.user_data["predict"]["awaiting_search"] = True
    return BROWSE_MARKETS


async def receive_search_query(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle search query input."""
    pred_data = context.user_data.get("predict", {})

    if not pred_data.get("awaiting_search"):
        return BROWSE_MARKETS

    search_text = update.message.text.strip()
    pred_data["awaiting_search"] = False
    pred_data["page"] = 0

    markets = await polymarket_client.search_markets(search_text, limit=20)

    if not markets:
        await update.message.reply_text(
            f'*Search: "{safe_md(search_text)}"*\n\n'
            "No markets found.\n"
            "Try a different search term.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [
                    [InlineKeyboardButton("Search Again", callback_data="pred_search")],
                    [InlineKeyboardButton("Back", callback_data="pred_menu")],
                ]
            ),
        )
        return BROWSE_MARKETS

    pred_data["markets"] = markets
    pred_data["browse_mode"] = "search"
    pred_data["search_query"] = search_text

    title = f'Search: "{safe_md(truncate(search_text, 30))}"'
    return await _show_market_list_msg(update.message, context, markets, 0, title)


async def _show_market_list(query, context, markets, page, title) -> int:
    """Show paginated market list via callback query edit."""
    start = page * MARKETS_PER_PAGE
    end = start + MARKETS_PER_PAGE
    page_markets = markets[start:end]

    text = f"*{title}*\n\n"
    keyboard = []

    for i, market in enumerate(page_markets, start=start + 1):
        text += _build_market_card(market, i) + "\n\n"
        keyboard.append(
            [
                InlineKeyboardButton(
                    f"View #{i}",
                    callback_data=f"pred_detail_{start + (i - start - 1)}",
                )
            ]
        )

    # Pagination buttons
    nav_row = []
    if page > 0:
        nav_row.append(InlineKeyboardButton("Prev", callback_data=f"pred_page_{page - 1}"))
    if end < len(markets):
        nav_row.append(InlineKeyboardButton("Next", callback_data=f"pred_page_{page + 1}"))
    if nav_row:
        keyboard.append(nav_row)

    keyboard.append([InlineKeyboardButton("Back", callback_data="pred_menu")])

    text += f"_Page {page + 1}/{(len(markets) - 1) // MARKETS_PER_PAGE + 1}_"

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return BROWSE_MARKETS


async def _show_market_list_msg(message, context, markets, page, title) -> int:
    """Show paginated market list via message reply."""
    start = page * MARKETS_PER_PAGE
    end = start + MARKETS_PER_PAGE
    page_markets = markets[start:end]

    text = f"*{title}*\n\n"
    keyboard = []

    for i, market in enumerate(page_markets, start=start + 1):
        text += _build_market_card(market, i) + "\n\n"
        keyboard.append(
            [
                InlineKeyboardButton(
                    f"View #{i}",
                    callback_data=f"pred_detail_{start + (i - start - 1)}",
                )
            ]
        )

    nav_row = []
    if end < len(markets):
        nav_row.append(InlineKeyboardButton("Next", callback_data=f"pred_page_{page + 1}"))
    if nav_row:
        keyboard.append(nav_row)

    keyboard.append([InlineKeyboardButton("Back", callback_data="pred_menu")])

    text += f"_Page {page + 1}/{(len(markets) - 1) // MARKETS_PER_PAGE + 1}_"

    await message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return BROWSE_MARKETS


async def page_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle pagination."""
    query = update.callback_query
    await query.answer()

    pred_data = context.user_data.get("predict", {})
    page = int(query.data.replace("pred_page_", ""))
    pred_data["page"] = page

    markets = pred_data.get("markets", [])
    if not markets:
        return await show_main_menu(update, context)

    browse_mode = pred_data.get("browse_mode", "trending")
    if browse_mode == "search":
        title = f'Search: "{safe_md(truncate(pred_data.get("search_query", ""), 30))}"'
    else:
        title = "Trending Markets"

    return await _show_market_list(query, context, markets, page, title)


# ============ MARKET DETAIL ============


async def market_detail_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show detailed view of a specific market."""
    query = update.callback_query
    await query.answer()

    pred_data = context.user_data.get("predict", {})
    market_idx = int(query.data.replace("pred_detail_", ""))
    markets = pred_data.get("markets", [])

    if market_idx >= len(markets):
        await query.edit_message_text("Market not found. Please try again.")
        return BROWSE_MARKETS

    market = markets[market_idx]
    pred_data["selected_market"] = market
    pred_data["selected_market_idx"] = market_idx

    # Fetch orderbook for YES token
    yes_token = _get_yes_token(market)
    no_token = _get_no_token(market)  # noqa: F841

    orderbook_text = ""
    if yes_token:
        token_id = yes_token.get("token_id", "")
        if token_id:
            ob = await polymarket_client.get_orderbook(token_id)
            if ob:
                orderbook_text = (
                    f"\n*Orderbook (YES)*\n"
                    f"  Bid: {ob.best_bid:.4f} | Ask: {ob.best_ask:.4f}\n"
                    f"  Spread: {ob.spread:.4f}\n"
                    f"  Depth: {format_usdc(ob.bid_depth)} / {format_usdc(ob.ask_depth)}\n"
                )

    yes_pct = market.outcome_yes_price * 100
    no_pct = market.outcome_no_price * 100
    bar = format_price_bar(market.outcome_yes_price, 15)

    text = (
        f"*{safe_md(truncate(market.question, 200))}*\n\n"
        f"YES {yes_pct:.1f}% {bar} {no_pct:.1f}% NO\n\n"
        f"*Volume (24h):* {format_volume(market.volume_24hr)}\n"
        f"*Total Volume:* {format_volume(market.volume_total)}\n"
        f"*Liquidity:* {format_volume(market.liquidity)}\n"
    )

    if market.end_date:
        end_display = market.end_date[:10] if len(market.end_date) >= 10 else market.end_date
        text += f"*Ends:* {end_display}\n"

    if market.category:
        text += f"*Category:* {safe_md(market.category)}\n"

    if orderbook_text:
        text += orderbook_text

    text += "\n_Select an action below:_"

    keyboard = [
        [
            InlineKeyboardButton("Buy YES", callback_data="pred_buy_yes"),
            InlineKeyboardButton("Buy NO", callback_data="pred_buy_no"),
        ],
        [InlineKeyboardButton("Back to List", callback_data="pred_back_list")],
    ]

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return MARKET_DETAIL


async def back_to_list_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Return to market list."""
    query = update.callback_query
    await query.answer()

    pred_data = context.user_data.get("predict", {})
    markets = pred_data.get("markets", [])
    page = pred_data.get("page", 0)

    if not markets:
        return await show_main_menu(update, context)

    browse_mode = pred_data.get("browse_mode", "trending")
    if browse_mode == "search":
        title = f'Search: "{safe_md(truncate(pred_data.get("search_query", ""), 30))}"'
    else:
        title = "Trending Markets"

    return await _show_market_list(query, context, markets, page, title)


# ============ ENTER AMOUNT ============


async def buy_yes_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start Buy YES flow."""
    return await _start_buy_flow(update, context, "Yes")


async def buy_no_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Start Buy NO flow."""
    return await _start_buy_flow(update, context, "No")


async def _start_buy_flow(update: Update, context: ContextTypes.DEFAULT_TYPE, outcome: str) -> int:
    """Start the buy amount entry flow."""
    query = update.callback_query
    await query.answer()

    pred_data = context.user_data.get("predict", {})
    market = pred_data.get("selected_market")

    if not market:
        await query.edit_message_text("Session expired. Start again with /predict")
        return ConversationHandler.END

    pred_data["order_outcome"] = outcome
    pred_data["order_side"] = "BUY"

    price = market.outcome_yes_price if outcome == "Yes" else market.outcome_no_price

    keyboard = [
        [
            InlineKeyboardButton("$5", callback_data="pred_amt_5"),
            InlineKeyboardButton("$10", callback_data="pred_amt_10"),
        ],
        [
            InlineKeyboardButton("$25", callback_data="pred_amt_25"),
            InlineKeyboardButton("$50", callback_data="pred_amt_50"),
        ],
        [InlineKeyboardButton("Custom", callback_data="pred_amt_custom")],
        [InlineKeyboardButton("Cancel", callback_data="pred_cancel")],
    ]

    text = (
        f"*Buy {outcome}*\n\n"
        f"Market: {safe_md(truncate(market.question))}\n"
        f"Current Price: {price:.4f} USDC/share\n"
        f"Potential Payout: $1.00/share if {outcome}\n\n"
        f"Select amount of USDC to spend:"
    )

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return ENTER_AMOUNT


async def amount_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle amount selection."""
    query = update.callback_query
    await query.answer()

    try:
        amount = float(query.data.replace("pred_amt_", ""))
    except ValueError:
        await query.edit_message_text("Invalid amount.")
        return ConversationHandler.END

    pred_data = context.user_data.get("predict", {})
    if not pred_data:
        await query.edit_message_text("Session expired. Start again with /predict")
        return ConversationHandler.END

    pred_data["order_amount"] = amount
    return await show_order_confirmation(update, context)


async def custom_amount_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Prompt for custom amount."""
    query = update.callback_query
    await query.answer()

    await query.edit_message_text(
        "*Enter Custom Amount*\n\n" "Enter the amount of USDC to spend:\n\n" "_Example: 15.50_",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("Cancel", callback_data="pred_cancel")]]
        ),
    )

    context.user_data["predict"]["awaiting_custom_amount"] = True
    return ENTER_AMOUNT


async def receive_custom_amount(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle custom amount text input."""
    pred_data = context.user_data.get("predict", {})

    if not pred_data.get("awaiting_custom_amount"):
        return ENTER_AMOUNT

    try:
        amount = float(update.message.text.strip())
        if amount <= 0:
            raise ValueError("Amount must be positive")
        if amount > 10000:
            await update.message.reply_text(
                "Maximum order amount is $10,000 USDC. Please enter a smaller amount."
            )
            return ENTER_AMOUNT

        pred_data["order_amount"] = amount
        pred_data["awaiting_custom_amount"] = False
        return await show_order_confirmation_msg(update, context)

    except ValueError:
        await update.message.reply_text(
            "Invalid amount. Please enter a valid number.\n" "_Example: 25.00_",
            parse_mode="Markdown",
        )
        return ENTER_AMOUNT


# ============ CONFIRM ORDER ============


async def show_order_confirmation(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show order confirmation via callback query."""
    query = update.callback_query
    pred_data = context.user_data.get("predict", {})

    text, keyboard = _build_confirmation(pred_data)

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return CONFIRM_ORDER


async def show_order_confirmation_msg(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show order confirmation via message reply."""
    pred_data = context.user_data.get("predict", {})

    text, keyboard = _build_confirmation(pred_data)

    await update.message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return CONFIRM_ORDER


def _build_confirmation(pred_data: dict) -> tuple:
    """Build confirmation text and keyboard."""
    market = pred_data.get("selected_market")
    outcome = pred_data.get("order_outcome", "Yes")
    amount = pred_data.get("order_amount", 0)

    price = market.outcome_yes_price if outcome == "Yes" else market.outcome_no_price
    shares = amount / price if price > 0 else 0
    potential_payout = shares * 1.0  # $1 per share if correct
    profit = potential_payout - amount

    text = (
        f"*Confirm Order*\n\n"
        f"*Market:* {safe_md(truncate(market.question))}\n"
        f"*Side:* BUY {outcome.upper()}\n"
        f"*Amount:* {format_usdc(amount)}\n"
        f"*Price:* {price:.4f} USDC/share\n"
        f"*Est. Shares:* {shares:.2f}\n\n"
        f"*Potential Payout:* {format_usdc(potential_payout)}\n"
        f"*Potential Profit:* {format_usdc(profit)} ({profit / amount * 100:.0f}%)\n\n"
        f"_This order will be placed on Polymarket via Polygon._"
    )

    keyboard = [
        [
            InlineKeyboardButton("Confirm", callback_data="pred_confirm"),
            InlineKeyboardButton("Cancel", callback_data="pred_cancel"),
        ],
    ]

    return text, keyboard


async def confirm_order_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute the order."""
    query = update.callback_query
    await query.answer("Placing order...")

    pred_data = context.user_data.get("predict", {})
    market = pred_data.get("selected_market")
    outcome = pred_data.get("order_outcome", "Yes")
    amount = pred_data.get("order_amount", 0)
    user_id = pred_data.get("user_id")
    wallet_id = pred_data.get("wallet_id")

    if not market:
        await query.edit_message_text("Session expired. Start again with /predict")
        return ConversationHandler.END

    price = market.outcome_yes_price if outcome == "Yes" else market.outcome_no_price

    # Determine token_id
    if outcome == "Yes":
        token_data = _get_yes_token(market)
    else:
        token_data = _get_no_token(market)

    token_id = token_data.get("token_id", "") if token_data else ""

    await query.edit_message_text(
        f"*Placing Order...*\n\n"
        f"BUY {outcome.upper()} on {safe_md(truncate(market.question, 60))}\n"
        f"Amount: {format_usdc(amount)}\n\n"
        f"Please wait...",
        parse_mode="Markdown",
    )

    # Create order in DB
    with get_session() as session:
        order = PredictionOrder(
            user_id=user_id,
            wallet_id=wallet_id,
            market_id=market.condition_id,
            market_question=market.question,
            token_id=token_id,
            outcome=outcome,
            side="BUY",
            amount_usdc=Decimal(str(amount)),
            price=Decimal(str(price)),
            status="pending",
        )
        session.add(order)
        session.commit()
        order_id = order.id

    try:
        # Get private key (backup key for Turnkey wallets)
        with get_session() as session:
            wallet = (
                session.query(Wallet)
                .filter(
                    Wallet.id == wallet_id,
                    Wallet.user_id == user_id,
                )
                .first()
            )
            if not wallet:
                raise Exception("Wallet not found")
            if wallet.is_turnkey_wallet:
                private_key = wallet_service.get_backup_private_key(wallet)
            else:
                private_key = wallet_service.get_private_key(wallet)

        # Place order via official Polymarket SDK
        result = await polymarket_client.place_order(
            private_key=private_key,
            token_id=token_id,
            side="BUY",
            amount=amount,
            price=price,
            order_id=order_id,
        )

        # Update order in DB
        with get_session() as session:
            db_order = session.query(PredictionOrder).filter(PredictionOrder.id == order_id).first()
            if db_order:
                if result.success:
                    db_order.status = "placed"
                    db_order.clob_order_id = result.order_id
                    shares = amount / price if price > 0 else 0
                    db_order.shares = Decimal(str(shares))

                    # Update or create position
                    position = (
                        session.query(PredictionPosition)
                        .filter(
                            PredictionPosition.user_id == user_id,
                            PredictionPosition.market_id == market.condition_id,
                            PredictionPosition.token_id == token_id,
                        )
                        .first()
                    )

                    if position:
                        old_total = float(position.total_cost_usdc or 0)
                        old_shares = float(position.total_shares or 0)
                        new_total = old_total + amount
                        new_shares = old_shares + shares
                        position.total_shares = Decimal(str(new_shares))
                        position.total_cost_usdc = Decimal(str(new_total))
                        position.avg_entry_price = (
                            Decimal(str(new_total / new_shares)) if new_shares > 0 else Decimal("0")
                        )
                        position.current_price = Decimal(str(price))
                    else:
                        position = PredictionPosition(
                            user_id=user_id,
                            market_id=market.condition_id,
                            market_question=market.question,
                            token_id=token_id,
                            outcome=outcome,
                            total_shares=Decimal(str(shares)),
                            avg_entry_price=Decimal(str(price)),
                            total_cost_usdc=Decimal(str(amount)),
                            current_price=Decimal(str(price)),
                        )
                        session.add(position)
                else:
                    db_order.status = "failed"
                    db_order.error_message = result.error
                session.commit()

        if result.success:
            shares = amount / price if price > 0 else 0
            potential_payout = shares * 1.0

            # Whole-product points: reward the prediction entry on USDC spent.
            # Polymarket orders carry no Suwappu platform fee, so there is no
            # fee_usd to pass — season accrual falls back to the volume-derived
            # base (int(amount/10)), the documented non-fee path. Points failures
            # must never affect the placed order.
            try:
                from bot.services.points_service import points_service

                points_service.award_points(
                    user_id=user_id,
                    action="predict_trade",
                    amount=max(1, int(amount / 10)),
                    description=f"Prediction BUY {outcome.upper()} (${amount:,.2f})",
                    metadata={"amount_usd": float(amount), "fee_usd": None},
                )
            except Exception as e:
                logger.debug(f"predict_trade award skipped: {e}")

            await query.edit_message_text(
                f"*Order Placed!*\n\n"
                f"*Market:* {safe_md(truncate(market.question))}\n"
                f"*Side:* BUY {outcome.upper()}\n"
                f"*Amount:* {format_usdc(amount)}\n"
                f"*Shares:* {shares:.2f}\n"
                f"*Potential Payout:* {format_usdc(potential_payout)}\n\n"
                f"Order ID: `{result.order_id[:16]}...`\n\n"
                f"Use /predict to view positions.",
                parse_mode="Markdown",
            )
        else:
            await query.edit_message_text(
                f"*Order Failed*\n\n"
                f"Error: {safe_md(result.error)}\n\n"
                f"Your funds have not been spent.\n"
                f"Use /predict to try again.",
                parse_mode="Markdown",
            )

    except Exception as e:
        logger.error(f"Predict order execution error: {e}")

        with get_session() as session:
            db_order = session.query(PredictionOrder).filter(PredictionOrder.id == order_id).first()
            if db_order:
                db_order.status = "failed"
                db_order.error_message = str(e)
                session.commit()

        await query.edit_message_text(
            "*Order Failed*\n\n" "An unexpected error occurred. Please try again.",
            parse_mode="Markdown",
        )

    context.user_data.pop("predict", None)
    return ConversationHandler.END


# ============ MY POSITIONS ============


async def positions_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show user's open positions."""
    query = update.callback_query
    await query.answer()

    pred_data = context.user_data.get("predict", {})
    user_id = pred_data.get("user_id")

    with get_session() as session:
        positions = (
            session.query(PredictionPosition)
            .filter(
                PredictionPosition.user_id == user_id,
                PredictionPosition.total_shares > 0,
                PredictionPosition.is_resolved == False,  # noqa: E712
            )
            .order_by(PredictionPosition.created_at.desc())
            .limit(10)
            .all()
        )

        # Resolved winners the monitor settled but the user hasn't redeemed yet.
        # Polymarket doesn't auto-redeem for EOAs, so these hold real claimable
        # value (winning CTF tokens redeem 1:1 for pUSD) — surface them instead of
        # letting them vanish after the one-time resolution notification.
        claimable = (
            session.query(PredictionPosition)
            .filter(
                PredictionPosition.user_id == user_id,
                PredictionPosition.is_resolved == True,  # noqa: E712
                PredictionPosition.resolved_payout > 0,
                PredictionPosition.claimed == False,  # noqa: E712
            )
            .order_by(PredictionPosition.updated_at.desc())
            .limit(10)
            .all()
        )

        if not positions and not claimable:
            await query.edit_message_text(
                "*My Positions*\n\n"
                "No open positions.\n\n"
                "Browse markets to place your first prediction!",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(
                    [
                        [InlineKeyboardButton("Browse Markets", callback_data="pred_trending")],
                        [InlineKeyboardButton("Back", callback_data="pred_menu")],
                    ]
                ),
            )
            return MY_POSITIONS

        text = "*My Positions*\n\n"
        total_value = 0.0
        total_pnl = 0.0
        keyboard = []

        for pos in positions:
            shares = float(pos.total_shares or 0)
            cost = float(pos.total_cost_usdc or 0)
            current = float(pos.current_price or 0)
            value = shares * current
            pnl = value - cost
            pnl_pct = (pnl / cost * 100) if cost > 0 else 0

            total_value += value
            total_pnl += pnl

            outcome_emoji = "\U0001f7e2" if pos.outcome == "Yes" else "\U0001f534"
            pnl_emoji = "\U0001f4c8" if pnl >= 0 else "\U0001f4c9"

            text += (
                f"{outcome_emoji} *{safe_md(truncate(pos.market_question or 'Unknown', 60))}*\n"
                f"  {pos.outcome} | {shares:.2f} shares @ {float(pos.avg_entry_price or 0):.4f}\n"
                f"  Value: {format_usdc(value)} | {pnl_emoji} {pnl_pct:+.1f}%\n\n"
            )

            keyboard.append(
                [
                    InlineKeyboardButton(
                        f"Sell {pos.outcome}",
                        callback_data=f"pred_sell_{pos.id}",
                    ),
                ]
            )

        if positions:
            pnl_emoji = "\U0001f4c8" if total_pnl >= 0 else "\U0001f4c9"
            text += (
                f"*Total Value:* {format_usdc(total_value)}\n"
                f"*Unrealized PnL:* {pnl_emoji} {format_usdc(total_pnl)}"
            )

        # Resolved winners (queried above) hold real claimable value — surface them
        # with a per-position Redeem button that triggers the on-chain redeem.
        if claimable:
            total_claimable = sum(float(p.resolved_payout or 0) for p in claimable)
            text += "\n\n\U0001f3c6 *Claimable (resolved)*\n"
            for pos in claimable:
                payout = float(pos.resolved_payout or 0)
                text += (
                    f"\U0001f7e2 {safe_md(truncate(pos.market_question or 'Unknown', 50))}\n"
                    f"  {pos.outcome} | {format_usdc(payout)} to redeem\n"
                )
                keyboard.append(
                    [
                        InlineKeyboardButton(
                            f"Redeem {format_usdc(payout)}",
                            callback_data=f"pred_redeem_{pos.id}",
                        )
                    ]
                )
            text += f"*Total claimable:* {format_usdc(total_claimable)}\n"
            text += "_Redeem to receive pUSD on Polygon (needs a little MATIC for gas)._"

    keyboard.append([InlineKeyboardButton("Refresh", callback_data="pred_positions")])
    keyboard.append([InlineKeyboardButton("Back", callback_data="pred_menu")])

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return MY_POSITIONS


async def sell_position_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Initiate sell of a position."""
    query = update.callback_query
    await query.answer()

    pred_data = context.user_data.get("predict", {})
    position_id = int(query.data.replace("pred_sell_", ""))

    with get_session() as session:
        pos = (
            session.query(PredictionPosition)
            .filter(
                PredictionPosition.id == position_id,
                PredictionPosition.user_id == pred_data.get("user_id"),
            )
            .first()
        )

        if not pos:
            await query.edit_message_text("Position not found.")
            return MY_POSITIONS

        shares = float(pos.total_shares or 0)
        current_price = float(pos.current_price or 0)
        value = shares * current_price

        pred_data["sell_position_id"] = position_id
        pred_data["sell_shares"] = shares
        pred_data["sell_token_id"] = pos.token_id
        pred_data["sell_outcome"] = pos.outcome
        pred_data["sell_market_question"] = pos.market_question

    keyboard = [
        [
            InlineKeyboardButton("Confirm Sell", callback_data="pred_confirm_sell"),
            InlineKeyboardButton("Cancel", callback_data="pred_positions"),
        ],
    ]

    await query.edit_message_text(
        f"*Sell Position*\n\n"
        f"*Market:* {safe_md(truncate(pred_data.get('sell_market_question', ''), 100))}\n"
        f"*Outcome:* {pred_data.get('sell_outcome')}\n"
        f"*Shares:* {shares:.2f}\n"
        f"*Current Price:* {current_price:.4f}\n"
        f"*Est. Proceeds:* {format_usdc(value)}\n\n"
        f"_Confirm to sell all shares at market price._",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return MY_POSITIONS


async def confirm_sell_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute sell order."""
    query = update.callback_query
    await query.answer("Selling position...")

    pred_data = context.user_data.get("predict", {})
    position_id = pred_data.get("sell_position_id")
    shares = pred_data.get("sell_shares", 0)
    token_id = pred_data.get("sell_token_id", "")
    wallet_id = pred_data.get("wallet_id")
    user_id = pred_data.get("user_id")

    try:
        # Get private key (backup key for Turnkey wallets)
        with get_session() as session:
            wallet = (
                session.query(Wallet)
                .filter(
                    Wallet.id == wallet_id,
                    Wallet.user_id == user_id,
                )
                .first()
            )
            if not wallet:
                raise Exception("Wallet not found")
            if wallet.is_turnkey_wallet:
                private_key = wallet_service.get_backup_private_key(wallet)
            else:
                private_key = wallet_service.get_private_key(wallet)

        # Get current midpoint for pricing
        midpoint = await polymarket_client.get_midpoint(token_id)
        price = midpoint if midpoint else 0.5

        # Place sell order via official Polymarket SDK
        result = await polymarket_client.place_order(
            private_key=private_key,
            token_id=token_id,
            side="SELL",
            amount=shares,
            price=price,
        )

        if result.success:
            # Create sell order record
            with get_session() as session:
                sell_order = PredictionOrder(
                    user_id=user_id,
                    wallet_id=wallet_id,
                    market_id="",
                    token_id=token_id,
                    outcome=pred_data.get("sell_outcome", ""),
                    side="SELL",
                    shares=Decimal(str(shares)),
                    price=Decimal(str(price)),
                    amount_usdc=Decimal(str(shares * price)),
                    status="placed",
                    clob_order_id=result.order_id,
                    market_question=pred_data.get("sell_market_question"),
                )
                session.add(sell_order)

                # Zero out position
                pos = (
                    session.query(PredictionPosition)
                    .filter(
                        PredictionPosition.id == position_id,
                    )
                    .first()
                )
                if pos:
                    pos.total_shares = Decimal("0")

                session.commit()

            await query.edit_message_text(
                f"*Position Sold!*\n\n"
                f"Sold {shares:.2f} shares at ~{price:.4f}\n"
                f"Est. Proceeds: {format_usdc(shares * price)}\n\n"
                f"Use /predict to continue trading.",
                parse_mode="Markdown",
            )
        else:
            await query.edit_message_text(
                f"*Sell Failed*\n\n"
                f"Error: {safe_md(result.error)}\n\n"
                f"Use /predict to try again.",
                parse_mode="Markdown",
            )

    except Exception as e:
        logger.error(f"Sell position error: {e}")
        await query.edit_message_text(
            "*Sell Failed*\n\n" "An unexpected error occurred.",
            parse_mode="Markdown",
        )

    context.user_data.pop("predict", None)
    return ConversationHandler.END


# ============ REDEEM (on-chain claim of resolved winners) ============


async def redeem_position_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show redeem confirmation for a resolved, claimable winning position."""
    query = update.callback_query
    await query.answer()

    pred_data = context.user_data.get("predict", {})
    user_id = pred_data.get("user_id")

    try:
        position_id = int(query.data.replace("pred_redeem_", ""))
    except (ValueError, AttributeError):
        await query.edit_message_text("Invalid position.")
        return MY_POSITIONS

    # Region gate: refuse for users we positively know are geo-restricted.
    if not polymarket_region_allowed(query.from_user.id):
        await query.edit_message_text(
            "*Redeem unavailable*\n\n"
            "On-chain redemption isn't available in your region.\n"
            "Your winning position stays claimable and is safe.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("Back", callback_data="pred_positions")]]
            ),
        )
        return MY_POSITIONS

    with get_session() as session:
        pos = (
            session.query(PredictionPosition)
            .filter(
                PredictionPosition.id == position_id,
                PredictionPosition.user_id == user_id,
                PredictionPosition.is_resolved == True,  # noqa: E712
                PredictionPosition.claimed == False,  # noqa: E712
            )
            .first()
        )
        if not pos:
            await query.edit_message_text(
                "This position is no longer claimable (already redeemed or not resolved)."
            )
            return MY_POSITIONS
        payout = float(pos.resolved_payout or 0)
        pred_data["redeem_position_id"] = position_id
        pred_data["redeem_condition_id"] = pos.market_id
        pred_data["redeem_payout"] = payout
        pred_data["redeem_question"] = pos.market_question

    keyboard = [
        [
            InlineKeyboardButton("Confirm Redeem", callback_data="pred_confirm_redeem"),
            InlineKeyboardButton("Cancel", callback_data="pred_positions"),
        ],
    ]

    await query.edit_message_text(
        f"*Redeem Winnings*\n\n"
        f"*Market:* {safe_md(truncate(pred_data.get('redeem_question') or 'Unknown', 100))}\n"
        f"*Payout:* {format_usdc(payout)} in pUSD\n\n"
        f"This sends an on-chain transaction from your wallet on Polygon to "
        f"redeem your winning shares. You'll need a little MATIC for gas.\n\n"
        f"_Confirm to redeem._",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return MY_POSITIONS


async def confirm_redeem_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Execute the on-chain redemption and mark the position claimed on success."""
    query = update.callback_query
    await query.answer("Redeeming...")

    pred_data = context.user_data.get("predict", {})
    position_id = pred_data.get("redeem_position_id")
    condition_id = pred_data.get("redeem_condition_id")
    payout = pred_data.get("redeem_payout", 0)
    wallet_id = pred_data.get("wallet_id")
    user_id = pred_data.get("user_id")

    if not position_id or not condition_id:
        await query.edit_message_text("Session expired. Start again with /predict")
        return ConversationHandler.END

    await query.edit_message_text(
        "*Redeeming...*\n\n"
        "Sending the on-chain redeem transaction on Polygon.\n"
        "Please wait — this can take up to a couple of minutes.",
        parse_mode="Markdown",
    )

    try:
        # Load the wallet ORM row (the user's EVM = Polymarket trading wallet).
        with get_session() as session:
            wallet = (
                session.query(Wallet)
                .filter(Wallet.id == wallet_id, Wallet.user_id == user_id)
                .first()
            )
            if not wallet:
                raise Exception("Wallet not found")
            session.expunge(wallet)

        result = await polymarket_client.redeem_position(
            wallet=wallet,
            condition_id=condition_id,
        )

        if result.success:
            with get_session() as session:
                pos = (
                    session.query(PredictionPosition)
                    .filter(
                        PredictionPosition.id == position_id,
                        PredictionPosition.user_id == user_id,
                    )
                    .first()
                )
                if pos:
                    pos.claimed = True
                    pos.redeem_tx_hash = result.tx_hash
                    session.commit()

            short_tx = (result.tx_hash[:12] + "...") if result.tx_hash else ""
            await query.edit_message_text(
                f"*Redeemed!*\n\n"
                f"Your winnings of {format_usdc(payout)} were redeemed as pUSD on Polygon.\n"
                f"Tx: `{short_tx}`\n\n"
                f"Use /predict to keep trading.",
                parse_mode="Markdown",
            )
        else:
            # Map the redeem error category to clear, calm guidance.
            await query.edit_message_text(
                _redeem_error_message(result),
                parse_mode="Markdown",
            )

    except Exception as e:
        logger.error(f"Redeem execution error: {e}")
        await query.edit_message_text(
            "*Redeem Failed*\n\n"
            "An unexpected error occurred. Your winning position is unchanged "
            "and still claimable — try again from /predict.",
            parse_mode="Markdown",
        )

    context.user_data.pop("predict", None)
    return ConversationHandler.END


def _redeem_error_message(result) -> str:
    """Plain-language message for a failed redeem, keyed on error_category.

    Reuses the swap error_guidance copy for the gas case so the user gets the
    same calm "funds are safe, top up a little MATIC" guidance bot-wide.
    """
    category = getattr(result, "error_category", "") or ""
    if category == "insufficient_gas":
        from bot.services.error_guidance import classify_swap_failure

        guidance = classify_swap_failure("insufficient funds for gas", context={"chain": "polygon"})
        return guidance.to_message()
    if category == "not_resolved":
        return (
            "*Not redeemable yet*\n\n"
            "This market hasn't fully resolved on-chain yet. Your funds are safe — "
            "try again in a few minutes."
        )
    if category == "pending":
        return (
            "*Redeem submitted*\n\n"
            "The transaction was broadcast but hasn't confirmed yet. It usually "
            "settles shortly — check your wallet on Polygon."
        )
    if category == "reverted":
        return (
            "*Redeem Failed*\n\n"
            "The redeem transaction reverted on-chain and no funds moved. "
            "Your position is still claimable."
        )
    return (
        "*Redeem Failed*\n\n"
        f"{safe_md(getattr(result, 'error', 'Unknown error'))}\n\n"
        "Your winning position is unchanged and still claimable."
    )


# ============ HISTORY ============


async def history_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Show order history."""
    query = update.callback_query
    await query.answer()

    pred_data = context.user_data.get("predict", {})
    user_id = pred_data.get("user_id")

    with get_session() as session:
        orders = (
            session.query(PredictionOrder)
            .filter(
                PredictionOrder.user_id == user_id,
            )
            .order_by(PredictionOrder.created_at.desc())
            .limit(15)
            .all()
        )

        if not orders:
            await query.edit_message_text(
                "*Order History*\n\n"
                "No orders yet.\n"
                "Place your first prediction to get started!",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup(
                    [
                        [InlineKeyboardButton("Browse Markets", callback_data="pred_trending")],
                        [InlineKeyboardButton("Back", callback_data="pred_menu")],
                    ]
                ),
            )
            return HISTORY

        text = "*Order History*\n\n"

        for order in orders:
            status_emoji = {
                "pending": "\U0001f551",
                "placed": "\U0001f7e1",
                "filled": "\U0001f7e2",
                "cancelled": "\u26aa",
                "failed": "\U0001f534",
            }.get(order.status, "\u2753")

            amount_str = format_usdc(order.amount_usdc) if order.amount_usdc else "N/A"
            date_str = order.created_at.strftime("%m/%d %H:%M") if order.created_at else ""

            text += (
                f"{status_emoji} {order.side} {order.outcome} | "
                f"{amount_str} | {order.status}\n"
                f"  {safe_md(truncate(order.market_question or '', 50))} | {date_str}\n\n"
            )

    keyboard = [
        [InlineKeyboardButton("Refresh", callback_data="pred_history")],
        [InlineKeyboardButton("Back", callback_data="pred_menu")],
    ]

    await query.edit_message_text(
        text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )

    return HISTORY


# ============ CANCEL ============


async def cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle cancel."""
    query = update.callback_query
    await query.answer()

    context.user_data.pop("predict", None)

    await query.edit_message_text("Prediction markets closed.")
    return ConversationHandler.END


async def menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Return to main predict menu."""
    return await show_main_menu(update, context)


# ============ CONVERSATION HANDLER ============

predict_conversation_handler = ConversationHandler(
    name="predict",
    persistent=True,
    entry_points=[
        CommandHandler("predict", predict_command),
        # Inline-button entry from the main menu ("🔮 Predictions").
        CallbackQueryHandler(predict_command, pattern="^predict_open$"),
    ],
    states={
        MAIN_MENU: [
            CallbackQueryHandler(trending_callback, pattern="^pred_trending$"),
            CallbackQueryHandler(search_callback, pattern="^pred_search$"),
            CallbackQueryHandler(positions_callback, pattern="^pred_positions$"),
            CallbackQueryHandler(history_callback, pattern="^pred_history$"),
            CallbackQueryHandler(cancel_callback, pattern="^pred_cancel$"),
        ],
        BROWSE_MARKETS: [
            CallbackQueryHandler(market_detail_callback, pattern="^pred_detail_"),
            CallbackQueryHandler(page_callback, pattern="^pred_page_"),
            CallbackQueryHandler(search_callback, pattern="^pred_search$"),
            CallbackQueryHandler(menu_callback, pattern="^pred_menu$"),
            CallbackQueryHandler(cancel_callback, pattern="^pred_cancel$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, receive_search_query),
        ],
        MARKET_DETAIL: [
            CallbackQueryHandler(buy_yes_callback, pattern="^pred_buy_yes$"),
            CallbackQueryHandler(buy_no_callback, pattern="^pred_buy_no$"),
            CallbackQueryHandler(back_to_list_callback, pattern="^pred_back_list$"),
            CallbackQueryHandler(cancel_callback, pattern="^pred_cancel$"),
        ],
        ENTER_AMOUNT: [
            CallbackQueryHandler(amount_callback, pattern="^pred_amt_\\d+$"),
            CallbackQueryHandler(custom_amount_callback, pattern="^pred_amt_custom$"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, receive_custom_amount),
            CallbackQueryHandler(cancel_callback, pattern="^pred_cancel$"),
        ],
        CONFIRM_ORDER: [
            CallbackQueryHandler(confirm_order_callback, pattern="^pred_confirm$"),
            CallbackQueryHandler(cancel_callback, pattern="^pred_cancel$"),
        ],
        MY_POSITIONS: [
            CallbackQueryHandler(sell_position_callback, pattern="^pred_sell_"),
            CallbackQueryHandler(confirm_sell_callback, pattern="^pred_confirm_sell$"),
            CallbackQueryHandler(redeem_position_callback, pattern="^pred_redeem_"),
            CallbackQueryHandler(confirm_redeem_callback, pattern="^pred_confirm_redeem$"),
            CallbackQueryHandler(positions_callback, pattern="^pred_positions$"),
            CallbackQueryHandler(trending_callback, pattern="^pred_trending$"),
            CallbackQueryHandler(menu_callback, pattern="^pred_menu$"),
            CallbackQueryHandler(cancel_callback, pattern="^pred_cancel$"),
        ],
        HISTORY: [
            CallbackQueryHandler(history_callback, pattern="^pred_history$"),
            CallbackQueryHandler(trending_callback, pattern="^pred_trending$"),
            CallbackQueryHandler(menu_callback, pattern="^pred_menu$"),
            CallbackQueryHandler(cancel_callback, pattern="^pred_cancel$"),
        ],
    },
    fallbacks=[
        CallbackQueryHandler(cancel_callback, pattern="^pred_cancel$"),
        CommandHandler("cancel", lambda u, c: cancel_callback(u, c)),
    ],
)
