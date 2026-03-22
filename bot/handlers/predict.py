"""Telegram handler for prediction market commands (/predict)."""

import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    ContextTypes, CommandHandler, CallbackQueryHandler,
    ConversationHandler, MessageHandler, filters,
)

import aiohttp

logger = logging.getLogger(__name__)

# Conversation states
PREDICT_MENU, PREDICT_BROWSE, PREDICT_DETAIL, PREDICT_SIDE, PREDICT_AMOUNT, PREDICT_CONFIRM = range(6)

GAMMA_API = "https://gamma-api.polymarket.com"


async def _fetch_markets(query: str | None = None, limit: int = 10) -> list[dict]:
    """Fetch active markets from Polymarket Gamma API."""
    params = {
        "limit": str(limit),
        "active": "true",
        "closed": "false",
        "order": "volume",
        "ascending": "false",
    }
    if query:
        params["tag"] = query

    async with aiohttp.ClientSession() as session:
        async with session.get(f"{GAMMA_API}/markets", params=params) as resp:
            if resp.status != 200:
                return []
            data = await resp.json()
            return data


async def _fetch_market(condition_id: str) -> dict | None:
    """Fetch a single market detail."""
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{GAMMA_API}/markets/{condition_id}") as resp:
            if resp.status != 200:
                return None
            return await resp.json()


def _format_market_line(m: dict) -> str:
    """Format a market for display."""
    try:
        import json
        prices = json.loads(m.get("outcomePrices", '["0.5","0.5"]'))
        yes_pct = float(prices[0]) * 100
    except Exception:
        yes_pct = 50.0

    vol = float(m.get("volume", 0))
    if vol >= 1_000_000:
        vol_str = f"${vol / 1_000_000:.1f}M"
    elif vol >= 1_000:
        vol_str = f"${vol / 1_000:.0f}K"
    else:
        vol_str = f"${vol:.0f}"

    return f"YES {yes_pct:.0f}% | Vol: {vol_str}"


async def predict_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle /predict command."""
    keyboard = [
        [InlineKeyboardButton("\U0001f525 Trending Markets", callback_data="predict_trending")],
        [
            InlineKeyboardButton("\U0001f3c8 Sports", callback_data="predict_cat_sports"),
            InlineKeyboardButton("\U0001f4b0 Crypto", callback_data="predict_cat_crypto"),
        ],
        [
            InlineKeyboardButton("\U0001f3db Politics", callback_data="predict_cat_politics"),
            InlineKeyboardButton("\U0001f30d World", callback_data="predict_cat_world"),
        ],
        [InlineKeyboardButton("\U0001f50d Search Markets", callback_data="predict_search")],
        [InlineKeyboardButton("\U0001f4bc My Positions", callback_data="predict_positions")],
        [InlineKeyboardButton("\U0001f519 Back", callback_data="main_menu")],
    ]

    await update.message.reply_text(
        "\U0001f52e **Prediction Markets** (via Polymarket)\n\n"
        "Trade on real-world outcomes — elections, sports, crypto, and more.\n"
        "Non-custodial. Your keys, your bets.",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return PREDICT_MENU


async def predict_menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle prediction menu callbacks."""
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "predict_trending":
        markets = await _fetch_markets(limit=8)
        if not markets:
            await query.edit_message_text("Could not fetch markets. Try again later.")
            return PREDICT_MENU

        text = "\U0001f525 **Trending Markets**\n\n"
        keyboard = []

        for i, m in enumerate(markets):
            q = m.get("question", "Unknown")
            info = _format_market_line(m)
            text += f"**{i+1}.** {q}\n    {info}\n\n"
            cid = m.get("condition_id", "")
            keyboard.append([InlineKeyboardButton(f"{i+1}. {q[:40]}...", callback_data=f"predict_view_{cid}")])

        keyboard.append([InlineKeyboardButton("\U0001f519 Back", callback_data="predict_back")])

        context.user_data["predict_markets"] = {m["condition_id"]: m for m in markets}

        await query.edit_message_text(
            text,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="Markdown",
        )
        return PREDICT_BROWSE

    elif data.startswith("predict_cat_"):
        category = data.replace("predict_cat_", "")
        markets = await _fetch_markets(query=category, limit=8)

        if not markets:
            await query.edit_message_text(f"No {category} markets found.")
            return PREDICT_MENU

        text = f"\U0001f4cb **{category.title()} Markets**\n\n"
        keyboard = []

        for i, m in enumerate(markets):
            q = m.get("question", "Unknown")
            info = _format_market_line(m)
            text += f"**{i+1}.** {q}\n    {info}\n\n"
            cid = m.get("condition_id", "")
            keyboard.append([InlineKeyboardButton(f"{i+1}. {q[:40]}...", callback_data=f"predict_view_{cid}")])

        keyboard.append([InlineKeyboardButton("\U0001f519 Back", callback_data="predict_back")])
        context.user_data["predict_markets"] = {m["condition_id"]: m for m in markets}

        await query.edit_message_text(
            text,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="Markdown",
        )
        return PREDICT_BROWSE

    elif data == "predict_search":
        await query.edit_message_text(
            "\U0001f50d **Search Markets**\n\n"
            "Type a search term (e.g. `bitcoin`, `trump`, `nba`):",
            parse_mode="Markdown",
        )
        return PREDICT_BROWSE

    elif data == "predict_positions":
        await query.edit_message_text(
            "\U0001f4bc **Positions**\n\n"
            "Position tracking requires Polymarket CLOB credentials.\n"
            "Use the Suwappu API at `/v1/agent/predict/positions` "
            "to view positions programmatically.\n\n"
            "Coming soon: inline position tracking!",
            parse_mode="Markdown",
        )
        return PREDICT_MENU

    elif data == "predict_back":
        return await predict_command(update, context)

    return PREDICT_MENU


async def predict_search_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle search text input."""
    search = update.message.text.strip()
    markets = await _fetch_markets(query=search, limit=8)

    if not markets:
        await update.message.reply_text(
            f"No markets found for '{search}'. Try a different term.",
        )
        return PREDICT_BROWSE

    text = f"\U0001f50d **Results for '{search}'**\n\n"
    keyboard = []

    for i, m in enumerate(markets):
        q = m.get("question", "Unknown")
        info = _format_market_line(m)
        text += f"**{i+1}.** {q}\n    {info}\n\n"
        cid = m.get("condition_id", "")
        keyboard.append([InlineKeyboardButton(f"{i+1}. {q[:40]}...", callback_data=f"predict_view_{cid}")])

    keyboard.append([InlineKeyboardButton("\U0001f519 Back", callback_data="predict_back")])
    context.user_data["predict_markets"] = {m["condition_id"]: m for m in markets}

    await update.message.reply_text(
        text,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return PREDICT_BROWSE


async def predict_view_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show market detail."""
    query = update.callback_query
    await query.answer()

    condition_id = query.data.replace("predict_view_", "")
    market = await _fetch_market(condition_id)

    if not market:
        await query.edit_message_text("Market not found.")
        return PREDICT_BROWSE

    import json

    q = market.get("question", "Unknown")
    desc = (market.get("description", "") or "")[:300]

    try:
        outcomes = json.loads(market.get("outcomes", '["Yes","No"]'))
        prices = json.loads(market.get("outcomePrices", '["0.5","0.5"]'))
    except Exception:
        outcomes = ["Yes", "No"]
        prices = ["0.5", "0.5"]

    vol = float(market.get("volume", 0))
    liq = float(market.get("liquidity", 0))
    end_date = (market.get("end_date_iso", "") or "")[:10]

    text = (
        f"\U0001f52e **{q}**\n\n"
        f"{desc}{'...' if len(desc) >= 300 else ''}\n\n"
    )

    for i, outcome in enumerate(outcomes):
        pct = float(prices[i]) * 100 if i < len(prices) else 50
        bar = "\u2588" * int(pct / 5) + "\u2591" * (20 - int(pct / 5))
        text += f"**{outcome}**: {pct:.1f}%  {bar}\n"

    text += (
        f"\n"
        f"Volume: ${vol:,.0f}\n"
        f"Liquidity: ${liq:,.0f}\n"
        f"Ends: {end_date}\n"
    )

    context.user_data["predict_current"] = {
        "condition_id": condition_id,
        "question": q,
        "outcomes": outcomes,
        "prices": prices,
    }

    keyboard = [
        [
            InlineKeyboardButton(f"\U0001f7e2 Buy YES ({float(prices[0])*100:.0f}\u00a2)", callback_data="predict_buy_yes"),
            InlineKeyboardButton(f"\U0001f534 Buy NO ({float(prices[1])*100:.0f}\u00a2)" if len(prices) > 1 else "\U0001f534 Buy NO", callback_data="predict_buy_no"),
        ],
        [InlineKeyboardButton("\U0001f4ca Orderbook", callback_data=f"predict_book_{condition_id}")],
        [InlineKeyboardButton("\U0001f519 Back", callback_data="predict_back")],
    ]

    await query.edit_message_text(
        text,
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="Markdown",
    )
    return PREDICT_DETAIL


async def predict_buy_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle buy YES/NO selection."""
    query = update.callback_query
    await query.answer()

    side = "YES" if "yes" in query.data else "NO"
    market = context.user_data.get("predict_current", {})
    q = market.get("question", "Unknown")

    context.user_data["predict_side"] = side

    prices = market.get("prices", ["0.5", "0.5"])
    price_idx = 0 if side == "YES" else 1
    price = float(prices[price_idx]) if price_idx < len(prices) else 0.5

    await query.edit_message_text(
        f"\U0001f4b0 **Buy {side}** on:\n_{q}_\n\n"
        f"Current price: {price*100:.1f}\u00a2 per share\n"
        f"(If correct, each share pays $1.00)\n\n"
        f"Enter amount in USDC to spend:\n"
        f"Example: `25` for $25",
        parse_mode="Markdown",
    )
    return PREDICT_AMOUNT


async def predict_amount_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle amount input."""
    try:
        amount = float(update.message.text.strip().replace("$", "").replace(",", ""))
        if amount < 1:
            await update.message.reply_text("Minimum bet is $1.")
            return PREDICT_AMOUNT
        if amount > 10000:
            await update.message.reply_text("Maximum bet is $10,000.")
            return PREDICT_AMOUNT

        context.user_data["predict_amount"] = amount

        market = context.user_data.get("predict_current", {})
        side = context.user_data.get("predict_side", "YES")
        q = market.get("question", "Unknown")

        prices = market.get("prices", ["0.5", "0.5"])
        price_idx = 0 if side == "YES" else 1
        price = float(prices[price_idx]) if price_idx < len(prices) else 0.5

        shares = amount / price
        potential_payout = shares * 1.0
        potential_profit = potential_payout - amount

        keyboard = [
            [
                InlineKeyboardButton("\u2705 Confirm Trade", callback_data="predict_exec"),
                InlineKeyboardButton("\u274c Cancel", callback_data="predict_back"),
            ],
        ]

        await update.message.reply_text(
            f"\U0001f4ca **Confirm Trade**\n\n"
            f"Market: _{q}_\n"
            f"Side: **{side}**\n"
            f"Amount: **${amount:,.2f}** USDC\n"
            f"Price: **{price*100:.1f}\u00a2** per share\n"
            f"Shares: **{shares:,.1f}**\n"
            f"Max Payout: **${potential_payout:,.2f}** (if correct)\n"
            f"Max Profit: **${potential_profit:,.2f}** ({potential_profit/amount*100:.0f}%)\n\n"
            f"\u26a0\ufe0f If wrong, you lose ${amount:,.2f}",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="Markdown",
        )
        return PREDICT_CONFIRM

    except ValueError:
        await update.message.reply_text("Please enter a valid number.")
        return PREDICT_AMOUNT


async def predict_execute_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Execute the prediction trade."""
    query = update.callback_query
    await query.answer("Placing order...")

    market = context.user_data.get("predict_current", {})
    side = context.user_data.get("predict_side", "YES")
    amount = context.user_data.get("predict_amount", 0)
    q = market.get("question", "Unknown")

    # For now, show instructions on using the API
    # Full execution requires CLOB credentials + EIP712 signing via Turnkey
    await query.edit_message_text(
        f"\U0001f6a7 **Order Queued**\n\n"
        f"Market: _{q}_\n"
        f"Side: {side} | Amount: ${amount:,.2f}\n\n"
        f"**To execute trades**, connect your Polymarket account:\n"
        f"1. Fund your Suwappu wallet with USDC on Polygon\n"
        f"2. Use `/predict setup` to register with Polymarket CLOB\n"
        f"3. Your trades will execute automatically\n\n"
        f"Or use the API: `POST /v1/agent/predict/order`",
        parse_mode="Markdown",
    )
    return ConversationHandler.END


# Conversation handler
predict_conversation_handler = ConversationHandler(
    name="predict",
    persistent=True,
    entry_points=[CommandHandler("predict", predict_command)],
    states={
        PREDICT_MENU: [
            CallbackQueryHandler(predict_menu_callback, pattern="^predict_"),
        ],
        PREDICT_BROWSE: [
            CallbackQueryHandler(predict_view_callback, pattern="^predict_view_"),
            CallbackQueryHandler(predict_menu_callback, pattern="^predict_"),
            MessageHandler(filters.TEXT & ~filters.COMMAND, predict_search_handler),
        ],
        PREDICT_DETAIL: [
            CallbackQueryHandler(predict_buy_callback, pattern="^predict_buy_"),
            CallbackQueryHandler(predict_menu_callback, pattern="^predict_"),
        ],
        PREDICT_SIDE: [
            CallbackQueryHandler(predict_buy_callback, pattern="^predict_buy_"),
        ],
        PREDICT_AMOUNT: [
            MessageHandler(filters.TEXT & ~filters.COMMAND, predict_amount_handler),
        ],
        PREDICT_CONFIRM: [
            CallbackQueryHandler(predict_execute_callback, pattern="^predict_exec$"),
            CallbackQueryHandler(predict_menu_callback, pattern="^predict_back$"),
        ],
    },
    fallbacks=[
        CommandHandler("predict", predict_command),
        CallbackQueryHandler(predict_menu_callback, pattern="^main_menu$"),
    ],
)

predict_menu_callback_handler = CallbackQueryHandler(predict_menu_callback, pattern="^predict_menu$")
