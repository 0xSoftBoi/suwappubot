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

import dataclasses
import logging
import re
import time
from typing import Any, Dict, Optional

from telegram import Update
from telegram.ext import ContextTypes

from bot.config.settings import settings
from bot.config.chains import CHAINS, get_chain_by_name, resolve_chain_name
from bot.config.tokens import TOKENS, get_token_by_symbol
from bot.utils.rate_limiter import nl_parse_limiter, enforce_rate_limit_for_update
from bot.utils.tos_utils import enforce_tos
from bot.services.nl_intent_service import TradeIntent, parse_trade_intent
from bot.handlers.quickswap import quickswap_command
from bot.handlers.balance import balance_command
from bot.handlers.portfolio import portfolio_command
from bot.handlers.paste_trade import on_freeform_text

logger = logging.getLogger(__name__)

FALLBACK_MESSAGE = "Sorry, I couldn't understand that — try /s <amount> <token> <chain> to swap."

# --- Stateful clarification follow-up ---------------------------------------
#
# handle_nl_text used to be fully stateless: every message (including a reply
# to our own "which token?" clarification question) was parsed from scratch,
# so a bare follow-up like "2 ETH" failed to parse on its own, re-asked the
# same question, and burned another (capped, paid) LLM call. We now persist
# the last clarification-pending TradeIntent per user for a short TTL so a
# follow-up can be merged deterministically (free, no LLM) or, failing that,
# handed to the LLM parser WITH the pending intent as context.

NL_PENDING_INTENT_KEY = "nl_pending_trade_intent"
NL_PENDING_INTENT_TTL_SECONDS = 5 * 60

# First match wins: "on the eth one on base" binds "the", which fails to resolve
# and leaves the chain unset rather than guessing — same deliberate tradeoff as
# _ON_CHAIN_RE in nl_deterministic_parser.py. Unresolved candidates defer to the LLM.
_BARE_CHAIN_RE = re.compile(r"\b(?:on|en|sur)\s+([a-zA-Z0-9_-]+)\b", re.IGNORECASE)
# Anchor against ordinal suffixes ("the 2nd one") so a list-selection number
# isn't misread as a swap amount. Negative lookahead blocks "2nd"/"3rd"/etc
# whether or not there's a space before the suffix.
_BARE_AMOUNT_RE = re.compile(r"\b([0-9]+(?:\.[0-9]+)?)\b(?!\s*(?:st|nd|rd|th)\b)")
_BARE_AMOUNT_TOKEN_RE = re.compile(
    r"\b([0-9]+(?:\.[0-9]+)?)(?!\s*(?:st|nd|rd|th)\b)\s+([a-zA-Z][a-zA-Z0-9_-]*)"
)


def _user_data_dict(context: ContextTypes.DEFAULT_TYPE) -> Optional[Dict[str, Any]]:
    """Return context.user_data if it's actually a dict (real PTB contexts),
    else None (e.g. loosely-mocked test contexts) — callers must treat None
    as "persistence unavailable, degrade to stateless behavior"."""
    user_data = getattr(context, "user_data", None)
    return user_data if isinstance(user_data, dict) else None


def _load_pending_intent(context: ContextTypes.DEFAULT_TYPE) -> Optional[TradeIntent]:
    user_data = _user_data_dict(context)
    if user_data is None:
        return None
    entry = user_data.get(NL_PENDING_INTENT_KEY)
    if not entry:
        return None
    if time.time() - entry.get("ts", 0) > NL_PENDING_INTENT_TTL_SECONDS:
        user_data.pop(NL_PENDING_INTENT_KEY, None)
        return None
    data = entry.get("intent")
    if not data:
        return None
    try:
        return TradeIntent(**data)
    except TypeError:
        return None


def _save_pending_intent(context: ContextTypes.DEFAULT_TYPE, intent: TradeIntent) -> None:
    user_data = _user_data_dict(context)
    if user_data is None:
        return
    user_data[NL_PENDING_INTENT_KEY] = {
        "intent": dataclasses.asdict(intent),
        "ts": time.time(),
    }


def _clear_pending_intent(context: ContextTypes.DEFAULT_TYPE) -> None:
    user_data = _user_data_dict(context)
    if user_data is None:
        return
    user_data.pop(NL_PENDING_INTENT_KEY, None)


def _try_merge_followup(pending: TradeIntent, text: str) -> Optional[TradeIntent]:
    """Deterministically merge a bare clarification-reply ("2 ETH", "on
    base", "the one on base", "actually make it 2 ETH") into whichever
    fields `pending` is still missing. Returns a completed, ready-to-execute
    TradeIntent, or None if the reply doesn't cleanly resolve the gap (the
    caller should then fall back to the LLM, passing `pending` as context).

    No LLM call, no network I/O — pure regex + config lookups, same
    zero-cost tier as bot/services/nl_deterministic_parser.py.
    """
    stripped = text.strip()
    if not stripped:
        return None

    merged = dataclasses.replace(pending)
    lowered = stripped.lower()
    filled_something = False

    # Working copy of `lowered` with any matched "on <chain>" clause stripped
    # out BEFORE the amount/token scans run below — regardless of whether the
    # candidate word resolves to a known chain — so a leftover chain word
    # (e.g. "eth" in "on eth") can never be misread as a bare token-symbol
    # reply by the loop further down.
    scan_text = lowered
    chain_m = _BARE_CHAIN_RE.search(lowered)
    candidate = None
    if chain_m:
        candidate = chain_m.group(1).strip()
        scan_text = (
            lowered[: chain_m.start()] + " " + lowered[chain_m.end() :]  # noqa: E203
        ).strip()  # noqa: E203
        scan_text = re.sub(r"\s+", " ", scan_text)
        if candidate and not merged.chain:
            resolved_chain = resolve_chain_name(candidate)
            if resolved_chain:
                merged.chain = resolved_chain
                filled_something = True

    amount_token_m = _BARE_AMOUNT_TOKEN_RE.search(scan_text)
    if merged.amount is None and amount_token_m:
        merged.amount = float(amount_token_m.group(1))
        merged.amount_unit = "native"
        filled_something = True
        token_raw = amount_token_m.group(2)
        token_info = get_token_by_symbol(token_raw.upper())
        if token_info:
            if not merged.token_out:
                merged.token_out = token_raw.upper()
            elif not merged.token_in:
                merged.token_in = token_raw.upper()
    elif merged.amount is None:
        amount_m = _BARE_AMOUNT_RE.search(scan_text)
        if amount_m:
            merged.amount = float(amount_m.group(1))
            merged.amount_unit = "native"
            filled_something = True

    if not merged.token_out or not merged.token_in:
        # Try every whitespace-separated word as a bare token-symbol reply
        # ("usdc", "the one on base" -> "base" won't resolve as a token and
        # is skipped, "eth" will). `candidate` (the chain word, if any) is
        # excluded as defense-in-depth even though it's already stripped
        # from `scan_text` above.
        for word in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]*", scan_text):
            if word in ("on", "en", "sur", "the", "one"):
                continue
            if candidate and word == candidate.lower():
                continue
            token_info = get_token_by_symbol(word.upper())
            if not token_info:
                continue
            if not merged.token_out:
                merged.token_out = word.upper()
                filled_something = True
            elif not merged.token_in:
                merged.token_in = word.upper()
                filled_something = True

    if not filled_something:
        return None

    # Note: we deliberately do NOT require token_in/token_out/amount to all
    # be present here — a merge that only resolves e.g. the chain is still a
    # valid, real merge (the caller, handle_nl_text, applies its own
    # completeness gate before deciding whether to execute vs. fall back).
    # Requiring full completeness here caused legitimate single-field merges
    # (e.g. "on eth" resolving only the chain) to be silently discarded.

    # Cap at 0.9 — a deterministic merge is not proof the whole intent is
    # right. But when the merge actually completes all three required swap
    # fields (token_in/token_out/amount), floor it above the handler's 0.6
    # execute-vs-defer threshold: `pending.confidence` was deliberately low
    # *because* those fields were still missing (that's why we asked the
    # clarifying question in the first place), so once the gap is closed
    # deterministically that low number is no longer a meaningful signal —
    # keeping it would make a fully-resolved reply ("2 ETH") silently fall
    # through to the freeform-text handler instead of executing.
    if merged.token_in and merged.token_out and merged.amount:
        merged.confidence = min(max(pending.confidence, 0.75), 0.9)
    else:
        merged.confidence = min(pending.confidence, 0.9)
    merged.clarification = None
    return merged


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

        pending_intent = _load_pending_intent(context)

        if not _looks_like_trade_text(text) and pending_intent is None:
            # Not trade-like and not a reply to our own clarification —
            # return silently so casual chat is never interrupted and no
            # paid LLM call is made. (A bare clarification reply like "the
            # one on base" wouldn't pass this pre-filter on its own, so we
            # must not gate it when a pending intent is in play.)
            return

        allowed = await enforce_rate_limit_for_update(update, nl_parse_limiter)
        if not allowed:
            return

        nl_context = {
            "available_chains": list(CHAINS.keys()),
        }

        user_id = update.effective_user.id if update.effective_user else None

        intent: Optional[TradeIntent] = None
        if pending_intent is not None:
            merged = _try_merge_followup(pending_intent, text)
            if merged is not None and merged.token_in and merged.token_out and merged.amount:
                _clear_pending_intent(context)
                intent = merged
            else:
                # Partial or failed merge: keep (updated) progress pending and
                # let the LLM see the merged state so the next reply can finish it.
                progress = merged if merged is not None else pending_intent
                _save_pending_intent(context, progress)
                nl_context["pending_intent"] = dataclasses.asdict(progress)

        if intent is None:
            intent = await parse_trade_intent(text, context=nl_context, user_id=user_id)

        if intent.clarification:
            if intent.action == "swap":
                # Persist so the user's next reply can be merged instead of
                # re-parsed from scratch (the dead clarification loop this
                # fixes).
                _save_pending_intent(context, intent)
            else:
                _clear_pending_intent(context)
            await update.message.reply_text(intent.clarification)
            return

        _clear_pending_intent(context)

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
