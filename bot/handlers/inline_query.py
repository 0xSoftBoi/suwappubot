"""Telegram inline mode — a $0 virality lever.

A user types ``@<botname> BTC`` (or a token symbol / contract address) in ANY
chat — group, DM, channel — and gets an inline result card they can send:
current price + 24h change + a "Trade on Suwappu" button carrying THEIR
referral link. No command, no bot membership in that chat required.

Speed & safety contract (Telegram calls this on every keystroke):
  * Every branch does at most ONE or TWO cached/single-fetch price_service
    calls — never a multi-provider or multi-RPC fan-out.
  * NEVER raises into PTB. Any failure logs server-side and answers with an
    empty result set so inline mode degrades silently instead of erroring.
  * Answers are ``is_personal=True`` (results embed a per-user referral link)
    with a short ``cache_time`` so Telegram avoids re-querying us for repeat
    keystrokes from the same user while still refreshing prices often enough
    to stay meaningful.

Referral-code handling (see bot/handlers/referral.py + bot/handlers/start.py
for the canonical /start REFCODE flow this reuses):
  * We only surface a code for users who already exist in our DB (i.e. have
    run /start at least once). ``referral_service.get_or_create_code`` is the
    exact call ``/ref`` uses on every invocation — a single indexed SELECT
    that only INSERTs once, ever, per user — so reusing it here is cheap and
    consistent with existing usage.
  * Inline queries can be fired by people who have never touched the bot (in
    any chat where the bot is @-mentioned inline). We deliberately do NOT
    create a shadow user row off the back of a read-only inline keystroke —
    unknown users get a plain ``?start=inline`` link instead.

Contract-address queries are intentionally price-less in v1: resolving token
metadata for an arbitrary pasted address (see bot/handlers/paste_trade.py
get_token_info) probes pump.fun / Alchemy across a chain list, which is fine
for a user-initiated paste but too slow/heavy for a per-keystroke inline
callback. Instead we detect the chain family only (a local, algorithmic check
— no network call) and hand the user a deep link into the bot for the full
price/security card.

IMPORTANT: this handler alone does not turn inline mode on. Inline mode must
ALSO be enabled for the bot via BotFather (/setinline) — see the final
delivery notes.
"""

import asyncio
import logging
from typing import Optional

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InlineQueryResultArticle,
    InputTextMessageContent,
    Update,
)
from telegram.ext import ContextTypes

from bot.models.user import User
from bot.services.price_service import TOKEN_TO_COINGECKO, price_service
from bot.services.referral_service import referral_service
from bot.utils.formatters import escape_markdown, format_usd
from bot.utils.validators import detect_address_chain
from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)

# Shown for an empty query ("@botname " with nothing typed yet). All present in
# TOKEN_TO_COINGECKO so price_service.get_prices() can batch-fetch them in ONE
# cached call. Kept to 5 to stay well inside Telegram's answer window; 24h
# change is intentionally skipped for this view (see _build_price_article) to
# avoid N sequential CoinGecko round-trips on a cold cache.
DEFAULT_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "ARB"]

_CHAIN_LABELS = {
    "evm": "EVM",
    "solana": "Solana",
    "tron": "TRON",
    "starknet": "Starknet",
}

CACHE_TIME_SECONDS = 30


def _short_addr(address: str) -> str:
    if len(address) <= 12:
        return address
    return f"{address[:6]}...{address[-4:]}"


async def _get_referral_trade_url(context: ContextTypes.DEFAULT_TYPE, telegram_user_id: int) -> str:
    """Build the 'Trade on Suwappu' deep link for the querying user.

    Falls back to a plain (code-less) link on any lookup failure or if the
    user has no bot record yet — see module docstring for why we never
    create one here. The DB lookup runs via ``run_in_db`` (a dedicated thread
    pool) since Telegram fires this on every keystroke and this bot runs a
    single-instance polling loop — a blocking call here would stall every
    other user.
    """
    bot_username = context.bot.username
    fallback = f"https://t.me/{bot_username}?start=inline"

    def _lookup_code() -> Optional[str]:
        with get_session() as session:
            db_user = session.query(User).filter(User.telegram_id == telegram_user_id).first()
            if not db_user:
                return None
            user_id = db_user.id
        code = referral_service.get_or_create_code(user_id)
        return code.code

    try:
        code = await run_in_db(_lookup_code)
        if code is None:
            return fallback
        return f"https://t.me/{bot_username}?start={code}"
    except Exception as e:
        logger.error(f"inline_query: referral code lookup failed: {e}")
        return fallback


def _trade_keyboard(trade_url: Optional[str], label: str) -> Optional[InlineKeyboardMarkup]:
    if not trade_url:
        return None
    return InlineKeyboardMarkup([[InlineKeyboardButton(label, url=trade_url)]])


def _make_article(
    result_id: str,
    title: str,
    description: str,
    text: str,
    trade_url: Optional[str],
    button_label: str,
) -> InlineQueryResultArticle:
    """Shared constructor — every article variant differs only in these
    strings (id/title/description/text/button label)."""
    return InlineQueryResultArticle(
        id=result_id,
        title=title,
        description=description,
        input_message_content=InputTextMessageContent(text, parse_mode="Markdown"),
        reply_markup=_trade_keyboard(trade_url, button_label),
    )


def _build_price_article(
    symbol: str,
    price: Optional[float],
    change_24h: Optional[float],
    trade_url: Optional[str],
) -> InlineQueryResultArticle:
    """Compact price card for a known token symbol."""
    price_str = format_usd(price) if price is not None else "N/A"

    change_bits = ""
    if change_24h is not None:
        arrow = "🟢" if change_24h >= 0 else "🔴"
        change_bits = f" {arrow} {change_24h:+.2f}% (24h)"

    title = f"{symbol}  {price_str}{change_bits}"
    text = (
        f"*{escape_markdown(symbol)}*  {escape_markdown(price_str)}{escape_markdown(change_bits)}\n\n"
        "_via Suwappu — non-custodial cross-chain swaps_"
    )

    return _make_article(
        result_id=f"price_{symbol}",
        title=title,
        description="Send a live price card with your Suwappu trade link",
        text=text,
        trade_url=trade_url,
        button_label="💱 Trade on Suwappu",
    )


def _build_address_article(
    address: str, chain_family: Optional[str], trade_url: Optional[str]
) -> InlineQueryResultArticle:
    """Card for a pasted contract address — chain-detected only, no metadata
    fetch (see module docstring)."""
    chain_label = _CHAIN_LABELS.get(chain_family, "on-chain")
    short = _short_addr(address)

    text = (
        f"📄 *Contract address* ({escape_markdown(chain_label)})\n"
        f"`{escape_markdown(address)}`\n\n"
        "_Open Suwappu to view live price, 24h change, and a honeypot/rug "
        "check before trading._"
    )

    return _make_article(
        result_id=f"addr_{short}",
        title=f"{chain_label} address: {short}",
        description=f"{chain_label} address detected — open Suwappu for price & security check",
        text=text,
        trade_url=trade_url,
        button_label="🔎 Open in Suwappu",
    )


def _no_results_article() -> InlineQueryResultArticle:
    return InlineQueryResultArticle(
        id="no_results",
        title="No results",
        description="Try a symbol like SOL or BTC, or paste a contract address",
        input_message_content=InputTextMessageContent(
            "🔍 No results — try a symbol like *SOL* or *BTC*, or paste a contract address.",
            parse_mode="Markdown",
        ),
    )


async def inline_query_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """``@<botname> <query>`` — price card / trending list / no-results article.

    Never raises into PTB — any exception is logged and answered with an
    empty result set.
    """
    query = update.inline_query
    try:
        text = (query.query or "").strip()
        from_user = query.from_user

        async def _resolve_trade_url() -> Optional[str]:
            # Lazily resolved — only the branches that actually build a
            # price/address article need it, and this is a DB round-trip we
            # don't want to pay on the (very common) no-results path.
            return await _get_referral_trade_url(context, from_user.id) if from_user else None

        results: list[InlineQueryResultArticle] = []

        if not text:
            # Empty query -> a handful of major tokens as a default browse
            # list. Single batched price_service.get_prices() call — no
            # per-symbol 24h-change fetch here to keep this fast on a cold
            # cache (see DEFAULT_SYMBOLS docstring above).
            trade_url = await _resolve_trade_url()
            prices = await price_service.get_prices(DEFAULT_SYMBOLS)
            for symbol in DEFAULT_SYMBOLS:
                results.append(_build_price_article(symbol, prices.get(symbol), None, trade_url))
        else:
            is_address, chain_family = detect_address_chain(text)

            if is_address:
                trade_url = await _resolve_trade_url()
                results.append(_build_address_article(text, chain_family, trade_url))
            else:
                symbol = text.upper()
                if symbol in TOKEN_TO_COINGECKO:
                    # Cold-cache case fires two independent CoinGecko
                    # round-trips — run them concurrently rather than
                    # sequentially.
                    price, change = await asyncio.gather(
                        price_service.get_price(symbol),
                        price_service.get_token_change_24h(symbol),
                    )
                    if price is None and change is None:
                        results.append(_no_results_article())
                    else:
                        trade_url = await _resolve_trade_url()
                        results.append(_build_price_article(symbol, price, change, trade_url))
                else:
                    results.append(_no_results_article())

        await query.answer(results, cache_time=CACHE_TIME_SECONDS, is_personal=True)
    except Exception as e:
        logger.error(f"inline_query_handler failed: {e}")
        try:
            await update.inline_query.answer([], cache_time=CACHE_TIME_SECONDS, is_personal=True)
        except Exception:
            pass  # Answering the fallback itself failed — nothing more we can do.
