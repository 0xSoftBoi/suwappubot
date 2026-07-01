"""Natural-language trade intent parsing.

IMPORTANT (MONEY-PATH boundary): this module NEVER quotes, signs, or executes
a swap. It only turns free-text ("swap 50 usdc for eth on base", "vende la
mitad de mi sol") into a structured, best-effort `TradeIntent`. Callers
(bot/handlers/nl_trade.py) are responsible for validating the intent and
handing off into the EXISTING swap confirmation flow — the same
CONFIRM_SWAP -> ENTER_2FA_CODE conversation / quote+execute code used today.

On any error (missing API key, network failure, malformed model response) we
return a low-confidence "unknown" intent with a clarification message. We
never raise out of `parse_trade_intent`.
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional

from bot.config.settings import settings

logger = logging.getLogger(__name__)

Action = Literal["swap", "quote", "balance", "portfolio", "unknown"]
AmountUnit = Literal["native", "usd", "percent"]

FALLBACK_CLARIFICATION = (
    "Sorry, I couldn't understand that — try /s <amount> <token> <chain> to swap."
)

_client: Optional["anthropic.AsyncAnthropic"] = None


def _get_client():
    """Lazily construct and cache a single AsyncAnthropic client for reuse
    across calls, instead of constructing a new client per request."""
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


_TOOL_NAME = "record_trade_intent"

_TOOL_SCHEMA: Dict[str, Any] = {
    "name": _TOOL_NAME,
    "description": "Record the structured trade intent parsed from the user's message.",
    "input_schema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["swap", "quote", "balance", "portfolio", "unknown"],
                "description": "What the user wants to do.",
            },
            "token_in": {
                "type": ["string", "null"],
                "description": "Token symbol being sold/sent, e.g. 'USDC'. Null if not applicable.",
            },
            "token_out": {
                "type": ["string", "null"],
                "description": "Token symbol being bought/received, e.g. 'ETH'. Null if not applicable.",
            },
            "amount": {
                "type": ["number", "null"],
                "description": "Numeric amount. If the user said 'half'/'50%', use amount_unit='percent' and amount=50.",
            },
            "amount_unit": {
                "type": "string",
                "enum": ["native", "usd", "percent"],
                "description": "Unit for `amount`: native token units, USD, or percent of holdings.",
            },
            "chain": {
                "type": ["string", "null"],
                "description": "Chain/network name if mentioned, e.g. 'base', 'ethereum', 'solana'.",
            },
            "confidence": {
                "type": "number",
                "description": "0.0-1.0 confidence that the parse is correct and complete.",
            },
            "clarification": {
                "type": ["string", "null"],
                "description": (
                    "A short, natural-language follow-up question to ask the user if any "
                    "required field for the chosen action is missing or ambiguous. Null if "
                    "the intent is complete and confident."
                ),
            },
        },
        "required": ["action", "amount_unit", "confidence"],
    },
}

_SYSTEM_PROMPT = """You are the natural-language trade intent parser for a crypto trading \
Telegram bot. You understand input in ANY language (English, Spanish, etc.) and normalize \
it to a single structured tool call — you do not need to translate anything yourself, just \
extract the underlying intent directly into the schema.

You NEVER execute trades. You only extract structured intent. Actions:
- "swap": the user wants to exchange one token for another (or sell a token for the \
default/likely output, e.g. USDC).
- "quote": the user wants a price/quote without necessarily executing.
- "balance": the user is asking about their wallet balance.
- "portfolio": the user is asking about their overall holdings/portfolio.
- "unknown": anything else, or too ambiguous to classify.

Rules:
- If the user references a fraction/percentage of holdings ("half", "50%", "all"), set \
amount_unit="percent" and amount as a 0-100 number (e.g. "half" -> 50, "all" -> 100).
- If a dollar amount is given ("$50", "50 dollars"), set amount_unit="usd".
- Otherwise amount_unit="native" (an amount denominated in the token itself).
- For action="swap", required fields are token_in, token_out, amount, and amount_unit. If any \
are missing or ambiguous, set confidence below 0.6 and fill `clarification` with a short \
natural-language question (in the same language as the user's message) asking exactly what's \
missing.
- For action="balance"/"portfolio", no token/amount fields are required.
- Always call the record_trade_intent tool exactly once. Never respond with plain text."""


@dataclass
class TradeIntent:
    action: Action = "unknown"
    token_in: Optional[str] = None
    token_out: Optional[str] = None
    amount: Optional[float] = None
    amount_unit: AmountUnit = "native"
    chain: Optional[str] = None
    confidence: float = 0.0
    clarification: Optional[str] = None


def _fallback(message: str = FALLBACK_CLARIFICATION) -> TradeIntent:
    return TradeIntent(action="unknown", clarification=message, confidence=0.0)


def _build_context_blurb(context: Optional[Dict[str, Any]]) -> str:
    if not context:
        return ""
    parts = []
    chains = context.get("available_chains")
    if chains:
        parts.append(f"Available chains: {', '.join(str(c) for c in chains)}.")
    wallet_chains = context.get("wallet_chains")
    if wallet_chains:
        parts.append(f"User's wallet chains: {', '.join(str(c) for c in wallet_chains)}.")
    recent_tokens = context.get("recent_tokens")
    if recent_tokens:
        parts.append(f"Recently used tokens: {', '.join(str(t) for t in recent_tokens)}.")
    return " ".join(parts)


async def parse_trade_intent(text: str, *, context: Optional[Dict[str, Any]] = None) -> TradeIntent:
    """Parse free-text into a structured TradeIntent. Never raises.

    This function performs NO quoting/execution — it is purely an LLM-backed
    text -> structured-schema mapper.
    """
    if not text or not text.strip():
        return _fallback()

    if not settings.ANTHROPIC_API_KEY:
        return _fallback()

    try:
        client = _get_client()

        context_blurb = _build_context_blurb(context)
        user_content = text if not context_blurb else f"{text}\n\n[Context: {context_blurb}]"

        response = await client.messages.create(
            model=settings.NL_TRADING_MODEL,
            max_tokens=300,
            system=_SYSTEM_PROMPT,
            tools=[_TOOL_SCHEMA],
            tool_choice={"type": "tool", "name": _TOOL_NAME},
            messages=[{"role": "user", "content": user_content}],
        )

        tool_use_block = None
        for block in response.content:
            if getattr(block, "type", None) == "tool_use":
                tool_use_block = block
                break

        if tool_use_block is None:
            logger.warning("nl_intent_service: no tool_use block in response")
            return _fallback()

        data = tool_use_block.input or {}

        intent = TradeIntent(
            action=data.get("action", "unknown"),
            token_in=data.get("token_in"),
            token_out=data.get("token_out"),
            amount=data.get("amount"),
            amount_unit=data.get("amount_unit", "native"),
            chain=data.get("chain"),
            confidence=float(data.get("confidence", 0.0) or 0.0),
            clarification=data.get("clarification"),
        )

        # Enforce the confidence/required-field gate server-side too, in case
        # the model didn't self-police correctly.
        if intent.action == "swap" and not intent.clarification:
            missing = not (intent.token_in and intent.token_out and intent.amount)
            if missing or intent.confidence < 0.6:
                intent.clarification = intent.clarification or (
                    "Which tokens and how much would you like to swap? "
                    "e.g. 'swap 50 USDC to ETH on base'."
                )
                intent.confidence = min(intent.confidence, 0.59)

        if intent.confidence < 0.6 and not intent.clarification:
            intent.clarification = FALLBACK_CLARIFICATION

        return intent

    except Exception:
        logger.exception("nl_intent_service: failed to parse trade intent")
        return _fallback()
