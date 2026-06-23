"""/trending — pull-only "what's hot" discovery.

A single front door for surfacing fresh activity the bot already tracks but
never proactively shows. THIS IS PULL-ONLY: it renders only when the user runs
/trending or taps the inline "🔥 Trending" tile (callback_data ``trending_open``)
— there is NO background push, no unsolicited message.

Data sources (reused, not invented):
  * Solana launches — ``launch_detector.get_recent_launches(limit=...)`` (the
    same accessor the /snipe "New Launches" path calls in bot/handlers/snipe.py).
    Each TokenLaunch carries ``token_mint`` + ``symbol``.
  * Trending predictions — Polymarket's trending markets live INSIDE the
    /predict ConversationHandler (the ``pred_trending`` callback is a
    conversation-internal state, not a top-level handler). Rather than reach
    into that flow out of band, we surface a single tappable entry into it via
    the live ``predict_open`` entry-point callback. (v1 note: we deep-link to
    the predictions menu rather than enumerating individual markets here.)

Each launch is rendered as a line + a ``tbuy_<idx>`` button. The list is cached
in ``context.user_data["trending"]`` so callback_data stays tiny (just the
index). ``tbuy_<idx>`` seeds ``context.user_data["paste_token"]`` and re-renders
the SAME preset-amount Buy keyboard the paste card uses (build_buy_keyboard) —
so the Buy buttons remain ``pbuy_<amount>`` and the swap conversation's
``^pbuy_`` entry_point handles execution. NO surface executes a swap directly.
"""

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from bot.config.chains import get_chain_by_name
from bot.handlers.paste_trade import _short, build_buy_keyboard
from bot.services.sniping import launch_detector

logger = logging.getLogger(__name__)

MAX_TRENDING = 8


def _build_trending(context: ContextTypes.DEFAULT_TYPE) -> list[dict]:
    """Collect the trending list and cache it for tbuy_<idx> lookups.

    Returns the same list it stashes in ``context.user_data["trending"]``. Each
    entry is a compact dict the buy path can read without exceeding Telegram's
    64-byte callback_data limit.
    """
    items: list[dict] = []
    try:
        launches = launch_detector.get_recent_launches(limit=MAX_TRENDING)
    except Exception as e:  # never let a discovery fetch break the command
        logger.warning("trending: get_recent_launches failed: %s", e)
        launches = []

    for launch in launches:
        mint = getattr(launch, "token_mint", None)
        if not mint:
            continue
        items.append(
            {
                "address": mint,
                "chain": "solana",
                "symbol": getattr(launch, "symbol", None) or "Token",
            }
        )

    context.user_data["trending"] = items
    return items


def _render_view(items: list[dict]) -> tuple[str, InlineKeyboardMarkup]:
    """Build the compact 'what's hot' message + keyboard."""
    rows = []

    if items:
        text = "🔥 *Trending now*\n_Fresh Solana launches the bot is watching:_\n\n"
        for i, it in enumerate(items):
            text += f"• *{it['symbol']}*  `{_short(it['address'])}`\n"
            rows.append([InlineKeyboardButton(f"Buy {it['symbol']}", callback_data=f"tbuy_{i}")])
    else:
        text = (
            "🔥 *Trending now*\n\n"
            "No fresh launches detected just yet — they appear here as they "
            "happen. Paste any token address to trade it, or browse predictions."
        )

    # Predictions deep-link into the live /predict menu (NOT a pbuy buy path).
    rows.append([InlineKeyboardButton("🔮 Trending predictions", callback_data="predict_open")])
    rows.append([InlineKeyboardButton("🔄 Refresh", callback_data="trending_open")])
    return text, InlineKeyboardMarkup(rows)


async def trending_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/trending — render the pull-only 'what's hot' view."""
    items = _build_trending(context)
    text, keyboard = _render_view(items)
    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=keyboard)


async def trending_open_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """``trending_open`` inline tile / Refresh — same view, edited in place."""
    query = update.callback_query
    await query.answer()
    items = _build_trending(context)
    text, keyboard = _render_view(items)
    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=keyboard)


async def trending_buy_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """``tbuy_<idx>`` — seed paste_token from the cached entry, show Buy keyboard.

    Preserves the money-path guardrail: this only stashes ``paste_token`` and
    renders ``build_buy_keyboard`` (whose buttons are ``pbuy_<amount>``). The
    actual swap is driven by the swap ConversationHandler's ``^pbuy_``
    entry_point — this handler never executes a swap.
    """
    query = update.callback_query
    await query.answer()

    try:
        idx = int(query.data.replace("tbuy_", ""))
    except ValueError:
        await query.answer("Invalid selection.", show_alert=True)
        return

    items = context.user_data.get("trending") or []
    if idx < 0 or idx >= len(items):
        await query.answer("That list expired — tap Refresh.", show_alert=True)
        return

    entry = items[idx]
    # Build the same paste_token shape swap.paste_buy_entry expects. Solana
    # launches use 9 decimals; name falls back to the symbol.
    info = {
        "chain": entry["chain"],
        "address": entry["address"],
        "symbol": entry.get("symbol") or "Token",
        "name": entry.get("symbol") or "Solana token",
        "decimals": 9,
    }
    context.user_data["paste_token"] = info

    chain_config = get_chain_by_name(info["chain"])
    native = chain_config.native_token if chain_config else "SOL"
    chain_label = chain_config.display_name if chain_config else info["chain"]
    chain_emoji = chain_config.logo_emoji if chain_config else ""

    text = (
        f"*{info['symbol']}*\n"
        f"{chain_emoji} {chain_label}  `{_short(info['address'])}`\n\n"
        f"Buy with {native}:"
    )

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=build_buy_keyboard(native)
    )
