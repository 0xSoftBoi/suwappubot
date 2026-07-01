"""Natural-language trade intent handler.

Feature-flagged OFF by default via settings.NL_TRADING_ENABLED.

MONEY-PATH INVARIANT: this handler never quotes or executes a swap itself. A
resolved "swap" intent is converted into the exact same `context.args` shape
that the /s command parses, and control is handed to the EXISTING
`quickswap_command` (bot/handlers/quickswap.py) — the same function the /s
CommandHandler calls. That function still requires the user to tap the
"✅ Confirm Swap" button (quickswap_confirm_callback) before
`swap_engine.execute_swap` ever runs. No quote/execute logic is duplicated
here.
"""

import logging
import re

from telegram import Update
from telegram.ext import ContextTypes

from bot.config.settings import settings
from bot.config.chains import CHAINS, get_chain_by_name
from bot.config.tokens import TOKENS, get_token_by_symbol
from bot.utils.rate_limiter import nl_parse_limiter, enforce_rate_limit_for_update
from bot.utils.tos_utils import enforce_tos
from bot.services.nl_intent_service import parse_trade_intent
from bot.handlers.quickswap import quickswap_command
from bot.handlers.balance import balance_command
from bot.handlers.portfolio import portfolio_command
from bot.handlers.paste_trade import on_freeform_text

logger = logging.getLogger(__name__)

FALLBACK_MESSAGE = "Sorry, I couldn't understand that — try /s <amount> <token> <chain> to swap."

# --- Cheap local pre-filter (no I/O, computed once at import time) ---------
#
# Cost-DoS guard: parse_trade_intent is a paid Anthropic API call. We only
# want to invoke it for text that plausibly looks like a trade request, so
# casual chatter ("hi", "thanks", "gm") never reaches the LLM.

_DIGIT_RE = re.compile(r"\d")

_TOKEN_SYMBOL_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(sym) for sym in TOKENS.keys()) + r")\b",
    re.IGNORECASE,
)

_KEYWORDS = frozenset(
    {
        # English
        "swap",
        "buy",
        "sell",
        "trade",
        "ape",
        "long",
        "short",
        # Non-swap NL actions this handler also supports — must not be
        # blocked by the pre-filter either.
        "balance",
        "portfolio",
        # Spanish
        "vende",
        "compra",
        "cambia",
        "intercambia",
        # French
        "acheter",
        "vendre",
        "échanger",
        "echanger",
        # Chinese
        "买",
        "卖",
        "换",
    }
)

_KEYWORD_RE = re.compile(
    r"(?:" + "|".join(re.escape(kw) for kw in _KEYWORDS if kw.isascii()) + r")",
    re.IGNORECASE,
)
_CJK_KEYWORDS = tuple(kw for kw in _KEYWORDS if not kw.isascii())


def _looks_like_trade_text(text: str) -> bool:
    """Cheap, local, no-I/O pre-filter for whether `text` plausibly is a
    trade request. Only text that passes this should ever reach the paid
    parse_trade_intent LLM call."""
    if not text:
        return False
    if _DIGIT_RE.search(text):
        return True
    if _TOKEN_SYMBOL_RE.search(text):
        return True
    if _KEYWORD_RE.search(text):
        return True
    if any(kw in text for kw in _CJK_KEYWORDS):
        return True
    return False


def _format_amount_arg(amount, amount_unit: str) -> str:
    """Render the parsed amount back into the token amount quickswap expects.

    quickswap only understands a plain numeric amount of the from-token — it
    has no concept of percent/USD sizing, so those are only accepted when we
    can't safely translate them. This is pure arg-normalization, not new
    execution logic.
    """
    return str(amount)


@enforce_tos
async def handle_nl_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Best-effort natural-language trading fallback for free-text messages.

    No-op when NL_TRADING_ENABLED is False. Never raises — any unexpected
    error results in a graceful fallback message rather than a crash.
    """
    if not settings.NL_TRADING_ENABLED:
        # Defensive no-op: main.py only registers this handler when the flag
        # is on, but if it's ever wired up unconditionally, fall through to
        # the existing freeform-text handler instead of swallowing the
        # update silently.
        await on_freeform_text(update, context)
        return

    if not update.message or not update.message.text:
        return

    try:
        text = update.message.text.strip()
        if not text:
            return

        if not _looks_like_trade_text(text):
            # Not trade-like — return silently so casual chat is never
            # interrupted and no paid LLM call is made.
            return

        allowed = await enforce_rate_limit_for_update(update, nl_parse_limiter)
        if not allowed:
            return

        nl_context = {
            "available_chains": list(CHAINS.keys()),
        }

        user_id = update.effective_user.id if update.effective_user else None
        intent = await parse_trade_intent(text, context=nl_context, user_id=user_id)

        if intent.clarification:
            await update.message.reply_text(intent.clarification)
            return

        if intent.action == "balance":
            await balance_command(update, context)
            return

        if intent.action == "portfolio":
            await portfolio_command(update, context)
            return

        if intent.action in ("swap", "quote") and intent.confidence >= 0.6:
            if not (intent.token_in and intent.token_out and intent.amount):
                await update.message.reply_text(FALLBACK_MESSAGE)
                return

            if intent.amount_unit != "native":
                # percent/USD sizing isn't something quickswap's arg format
                # supports today — ask the user to specify a plain amount
                # rather than guessing at a conversion (no execution logic
                # duplicated here).
                await update.message.reply_text(
                    "I can't size that automatically yet — "
                    f"try `/s <amount> {intent.token_in} {intent.token_out}` "
                    "with a specific amount.",
                    parse_mode="Markdown",
                )
                return

            token_in_info = get_token_by_symbol(intent.token_in.upper())
            token_out_info = get_token_by_symbol(intent.token_out.upper())
            if not token_in_info or not token_out_info:
                await update.message.reply_text(FALLBACK_MESSAGE)
                return

            if intent.chain and not get_chain_by_name(intent.chain):
                # Unknown chain — let quickswap fall back to its own default
                # chain resolution rather than failing outright.
                intent.chain = None

            args = [_format_amount_arg(intent.amount, intent.amount_unit), intent.token_in]
            if intent.chain:
                args.append(intent.chain)
            args.append(intent.token_out)
            if intent.chain:
                args.append(intent.chain)

            context.args = args
            await quickswap_command(update, context)
            return

        # Unclassified / low-confidence intent: don't dead-end the user with a
        # generic fallback — delegate to the existing paste-to-trade /
        # keyword-router handler so address pastes and casual phrases still
        # get their normal response. No swap logic is duplicated here.
        await on_freeform_text(update, context)

    except Exception:
        logger.exception("handle_nl_text: unexpected error")
        try:
            await on_freeform_text(update, context)
        except Exception:
            pass
