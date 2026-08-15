"""/feed — verified trade feed (markets.xyz-parity GAP 3).

A pull-only, markets.xyz-style social feed where every entry is a REAL
executed trade sourced from ``TraderTrade`` (bot/services/feed_service.py),
not a self-reported post. Follows the same conventions as /trending
(bot/handlers/trending.py):

  * PULL-ONLY: renders on /feed or the "📰 Trade Feed" inline tile in the
    more-menu (``feed_page_0``, bot/handlers/start.py) / pagination taps —
    no background push.
  * The page is cached in ``context.user_data["feed_items"]`` so
    callback_data stays tiny (index-based), same trick /trending uses.
  * Buttons never execute anything themselves:
      - "🧬 Copy trader" hands off to the EXISTING trader-profile/follow
        flow (``copy_view_<trader_id>``, bot/handlers/copy.py) — the
        already-registered follow buttons live there.
      - "💱 Trade it" seeds ``context.user_data["paste_token"]`` and shows
        the SAME Buy keyboard paste-to-trade/trending use
        (``build_buy_keyboard`` -> swap conversation's ``^pbuy_`` entry
        point). When the traded token can't be resolved to a real address
        (most long-tail tokens — TraderTrade only stores a symbol), it
        falls back to the existing "paste the address" hint
        (``paste_check_hint``) instead of guessing wrong — no dead button,
        no wrong-token buy.

Privacy: feed_service already filters to opted-in, feed-visible traders only
(TraderProfile.is_public AND show_in_feed). This handler never reads or
displays a wallet address.
"""

import logging

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from bot.config.chains import ChainType, get_chain_by_name
from bot.config.tokens import get_token_address, get_token_by_symbol
from bot.handlers.paste_trade import _short, build_buy_keyboard
from bot.services import feed_service

logger = logging.getLogger(__name__)

_DEFAULT_DECIMALS_BY_CHAIN_TYPE = {
    ChainType.EVM: 18,
    ChainType.SOLANA: 9,
    ChainType.TRON: 6,
    ChainType.STARKNET: 18,
}


def _resolve_buy_target(entry: dict) -> dict | None:
    """Best-effort resolve a feed entry's traded token to a real on-chain
    address so "Trade it" can seed the existing Buy keyboard. Returns None
    when the symbol can't be confidently resolved (most long-tail tokens)."""
    chain_cfg = get_chain_by_name(entry["chain"])
    if not chain_cfg:
        return None

    address = get_token_address(entry["to_token"], entry["chain"])
    if not address:
        return None

    token_cfg = get_token_by_symbol(entry["to_token"])
    decimals = (
        token_cfg.decimals
        if token_cfg
        else _DEFAULT_DECIMALS_BY_CHAIN_TYPE.get(chain_cfg.chain_type, 18)
    )
    name = token_cfg.name if token_cfg else entry["to_token"]

    return {
        "chain": entry["chain"],
        "address": address,
        "symbol": entry["to_token"],
        "name": name,
        "decimals": decimals,
    }


def _render_feed(
    items: list[dict], offset: int, has_more: bool
) -> tuple[str, InlineKeyboardMarkup]:
    rows = []

    if items:
        text = "📰 *Verified Trade Feed*\n_Real fills from opted-in traders:_\n\n"
        for i, entry in enumerate(items):
            text += feed_service.format_feed_entry_line(entry) + "\n"
            rows.append(
                [
                    InlineKeyboardButton(
                        f"🧬 Copy {entry['handle']}",
                        callback_data=f"copy_view_{entry['trader_id']}",
                    ),
                    InlineKeyboardButton(
                        f"💱 Trade {entry['to_token']}", callback_data=f"fbuy_{i}"
                    ),
                ]
            )
    else:
        text = (
            "📰 *Verified Trade Feed*\n\n"
            "No public trades yet. Go public in /profile to be the first "
            "one on the feed!"
        )

    nav = []
    if offset > 0:
        prev_offset = max(offset - feed_service.FEED_PAGE_SIZE, 0)
        nav.append(InlineKeyboardButton("⬅️ Prev", callback_data=f"feed_page_{prev_offset}"))
    if has_more:
        next_offset = offset + feed_service.FEED_PAGE_SIZE
        nav.append(InlineKeyboardButton("➡️ Next", callback_data=f"feed_page_{next_offset}"))
    if nav:
        rows.append(nav)

    rows.append([InlineKeyboardButton("🔄 Refresh", callback_data=f"feed_page_{offset}")])
    return text, InlineKeyboardMarkup(rows)


def _load_page(context: ContextTypes.DEFAULT_TYPE, offset: int) -> tuple[list[dict], bool]:
    page = feed_service.get_global_feed(limit=feed_service.FEED_PAGE_SIZE, offset=offset)
    context.user_data["feed_items"] = page["items"]
    context.user_data["feed_offset"] = offset
    return page["items"], page["has_more"]


async def feed_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """/feed — render page 1 of the global verified trade feed."""
    items, has_more = _load_page(context, 0)
    text, keyboard = _render_feed(items, 0, has_more)
    await update.message.reply_text(text, parse_mode="Markdown", reply_markup=keyboard)


async def feed_page_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """``feed_page_<offset>`` — pagination / refresh, edited in place."""
    query = update.callback_query
    await query.answer()

    try:
        offset = int(query.data.replace("feed_page_", ""))
    except ValueError:
        offset = 0

    items, has_more = _load_page(context, offset)
    text, keyboard = _render_feed(items, offset, has_more)
    await query.edit_message_text(text, parse_mode="Markdown", reply_markup=keyboard)


async def feed_buy_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """``fbuy_<idx>`` — resolve the traded token from the cached feed page and
    seed the SAME Buy keyboard paste-to-trade/trending use. Falls back to the
    "paste the address" hint when the token can't be confidently resolved —
    never executes a swap here."""
    query = update.callback_query
    await query.answer()

    try:
        idx = int(query.data.replace("fbuy_", ""))
    except ValueError:
        await query.answer("Invalid selection.", show_alert=True)
        return

    items = context.user_data.get("feed_items") or []
    if idx < 0 or idx >= len(items):
        await query.answer("That feed page expired — tap Refresh.", show_alert=True)
        return

    entry = items[idx]
    target = _resolve_buy_target(entry)

    if not target:
        await query.edit_message_text(
            f"💱 *{entry['to_token']}*\n\n"
            "I don't have a verified contract address for this token yet — "
            "paste the token's address and I'll run a safety check and show "
            "Buy options.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("🔎 How do I find it?", callback_data="paste_check_hint")]]
            ),
        )
        return

    context.user_data["paste_token"] = target

    chain_config = get_chain_by_name(target["chain"])
    native = chain_config.native_token if chain_config else "ETH"
    chain_label = chain_config.display_name if chain_config else target["chain"]
    chain_emoji = chain_config.logo_emoji if chain_config else ""

    text = (
        f"*{target['symbol']}*\n"
        f"{chain_emoji} {chain_label}  `{_short(target['address'])}`\n\n"
        f"Buy with {native}:"
    )

    await query.edit_message_text(
        text, parse_mode="Markdown", reply_markup=build_buy_keyboard(native)
    )
