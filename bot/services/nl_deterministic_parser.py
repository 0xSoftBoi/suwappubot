"""Deterministic (regex-only, zero-network) parser for natural-language trade
intents.

MONEY-PATH boundary: like bot/services/nl_intent_service.py, this module
NEVER quotes, signs, or executes a swap. It only turns a narrow set of
well-formed free-text commands ("swap 50 usdc for eth on base") into the same
`TradeIntent` shape the LLM path produces — purely to avoid paying for an LLM
call when the text is unambiguous.

If the text doesn't cleanly match one of the supported command shapes, or any
referenced token/chain symbol doesn't resolve against the known config,
`parse_deterministic` returns `None` so the caller can fall back to the LLM
parser. It never guesses.
"""

import re
from typing import Any, Dict, Optional

from bot.config.chains import resolve_chain_name
from bot.config.tokens import get_token_by_symbol
from bot.services.nl_intent_service import TradeIntent

# --- Keyword tables (small, data-driven — not a combinatorial explosion) ---

VERB_KEYWORDS: Dict[str, list] = {
    "swap": [
        "swap",
        "convert",
        "trade",
        "exchange",
        "cambia",
        "cambiar",
        "échange",
        "echange",
        "échanger",
        "echanger",
        "换",
    ],
    "buy": ["buy", "compra", "comprar", "achète", "achete", "acheter", "买"],
    "sell": ["sell", "vende", "vender", "vends", "vendre", "卖"],
}

_ALL_VERBS = [v for verbs in VERB_KEYWORDS.values() for v in verbs]
_ALL_VERBS.sort(key=len, reverse=True)
_VERB_RE = re.compile(r"\b(" + "|".join(re.escape(v) for v in _ALL_VERBS) + r")\b", re.IGNORECASE)

_TO_WORDS = r"(?:to|for|into|->|por|hacia|en|pour|vers|换成)"
# NOTE: this is intentionally NOT end-anchored. An end-anchored pattern only
# catches a chain clause that is the very last thing in the message, so
# trailing filler ("... on base right now") silently drops the chain instead
# of matching it — the caller then emits chain=None at confidence=1.0, which
# is worse than deferring to the LLM. Searching anywhere is safe because the
# caller (`_extract_chain_suffix` / `parse_deterministic`) always resolves the
# captured word against `get_chain_by_name` before trusting it, and defers to
# the LLM (returns None) if it doesn't resolve — so a false-positive match on
# a Spanish/French connector word ("en"/"sur" also mean "in"/"on" generically)
# can never silently produce a wrong or fabricated chain.
_ON_CHAIN_RE = re.compile(r"\b(?:on|en|sur)\s+([a-zA-Z0-9_-]+)\b", re.IGNORECASE)

_ALL_PERCENT_WORDS = {
    "half": 50.0,
    "mitad": 50.0,
    "moitié": 50.0,
    "moitie": 50.0,
    "all": 100.0,
    "todo": 100.0,
    "toda": 100.0,
    "tout": 100.0,
    "全部": 100.0,
}

_AMOUNT_USD_RE = re.compile(
    r"^\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(usd|dollars?|bucks?|dolares?|dólares?)?\s*$",
    re.IGNORECASE,
)
_AMOUNT_PERCENT_RE = re.compile(
    r"^([0-9]+(?:\.[0-9]+)?)\s*(?:%|percent|por ?ciento|pourcent)\s*$", re.IGNORECASE
)
_AMOUNT_DOLLAR_SIGN_RE = re.compile(r"^\$")

_FILLER_WORDS = {"my", "some", "of", "de", "mi", "mis", "du", "de la", "de mon", "mon", "ma"}


def _strip_fillers(tokens: list) -> list:
    return [t for t in tokens if t not in _FILLER_WORDS]


def _parse_amount(token: str) -> Optional[tuple]:
    """Return (amount, unit) for a single amount token, or None."""
    token = token.strip()
    lowered = token.lower()
    if lowered in _ALL_PERCENT_WORDS:
        return (_ALL_PERCENT_WORDS[lowered], "percent")

    m = _AMOUNT_PERCENT_RE.match(token)
    if m:
        return (float(m.group(1)), "percent")

    if token.startswith("$"):
        m = _AMOUNT_USD_RE.match(token)
        if m:
            return (float(m.group(1)), "usd")

    m = _AMOUNT_USD_RE.match(token)
    if m:
        amount = float(m.group(1))
        unit = "usd" if m.group(2) else "native"
        return (amount, unit)

    return None


def _resolve_token(symbol: str) -> Optional[str]:
    if not symbol:
        return None
    info = get_token_by_symbol(symbol.upper())
    if info is None:
        return None
    return info.symbol.upper() if hasattr(info, "symbol") else symbol.upper()


def _resolve_chain(name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    return resolve_chain_name(name)


def _detect_verb_action(text: str) -> Optional[str]:
    m = _VERB_RE.search(text)
    if not m:
        return None
    matched = m.group(1).lower()
    for action, keywords in VERB_KEYWORDS.items():
        if matched in (kw.lower() for kw in keywords):
            return action
    return None


def _extract_chain_suffix(text: str) -> tuple:
    """Find and strip an 'on/en/sur <chain>' clause anywhere in the text,
    returning (remaining_text, chain_name_or_None).

    The candidate word is NOT validated here — the caller is responsible for
    resolving it via `get_chain_by_name` and deferring to the LLM (returning
    None from `parse_deterministic`) if it doesn't resolve to a known chain.
    """
    m = _ON_CHAIN_RE.search(text)
    if not m:
        return text, None
    chain_raw = m.group(1)
    remaining = (text[: m.start()] + " " + text[m.end() :]).strip()
    remaining = re.sub(r"\s+", " ", remaining)
    return remaining, chain_raw


def parse_deterministic(
    text: str, *, context: Optional[Dict[str, Any]] = None
) -> Optional[TradeIntent]:
    """Pure-regex, zero-network parse of `text` into a TradeIntent.

    Returns None (never raises) whenever the text doesn't cleanly match one
    of the supported deterministic command shapes, or references a token /
    chain symbol we don't recognize — the caller should fall back to the LLM
    parser in that case.
    """
    if not text or not text.strip():
        return None

    normalized = text.strip().lower()

    action = _detect_verb_action(normalized)
    if action is None:
        return None

    remaining, chain_raw = _extract_chain_suffix(normalized)
    chain = _resolve_chain(chain_raw) if chain_raw else None
    if chain_raw and chain is None:
        # Explicit chain mentioned but unrecognized — don't guess, defer to LLM.
        return None

    # Strip the matched verb keyword itself.
    verb_pattern = re.compile(
        r"\b(" + "|".join(re.escape(v) for v in VERB_KEYWORDS[action]) + r")\b",
        re.IGNORECASE,
    )
    remaining = verb_pattern.sub(" ", remaining, count=1).strip()

    tokens = [t for t in re.split(r"\s+", remaining) if t]
    tokens = _strip_fillers(tokens)
    if not tokens:
        return None

    try:
        if action == "swap":
            return _parse_swap(tokens, chain)
        if action == "buy":
            return _parse_buy(tokens, chain)
        if action == "sell":
            return _parse_sell(tokens, chain)
    except Exception:
        return None

    return None


def _split_on_connector(tokens: list) -> Optional[tuple]:
    """Split tokens on a 'to/for/into/->' style connector. Returns
    (left_tokens, right_tokens) or None if no connector found."""
    connectors = {"to", "for", "into", "->", "por", "hacia", "vers", "换成"}
    for i, t in enumerate(tokens):
        if t in connectors:
            return tokens[:i], tokens[i + 1 :]
    return None


def _parse_swap(tokens: list, chain: Optional[str]) -> Optional[TradeIntent]:
    split = _split_on_connector(tokens)
    if not split:
        return None
    left, right = split
    if not left or not right:
        return None

    amount_result = _parse_amount(left[0])
    if amount_result is None:
        return None
    amount, unit = amount_result

    if len(left) < 2:
        return None
    token_in_raw = left[1]
    token_out_raw = right[0]

    token_in = _resolve_token(token_in_raw)
    token_out = _resolve_token(token_out_raw)
    if not token_in or not token_out:
        return None

    return TradeIntent(
        action="swap",
        token_in=token_in,
        token_out=token_out,
        amount=amount,
        amount_unit=unit,
        chain=chain,
        confidence=1.0,
        clarification=None,
    )


def _parse_buy(tokens: list, chain: Optional[str]) -> Optional[TradeIntent]:
    if not tokens:
        return None
    amount_result = _parse_amount(tokens[0])
    if amount_result is None:
        return None
    amount, unit = amount_result

    # "buy N X" is inherently ambiguous in our input-amount model: the bare number
    # attaches to the OUTPUT token ("buy 100 eth" = 100 ETH out) but our intent
    # amount is the INPUT (from-token) amount, so a native-unit buy would silently
    # size the trade wrong (spend 100 USDC). Defer any native-unit buy to the LLM,
    # which has the semantic context to disambiguate. (usd/percent units are
    # blocked from execution downstream and route to a clarification, so they're
    # safe to keep here.)  MONEY-PATH: prevents a wrong-sized confirm card.
    if unit == "native":
        return None

    rest = tokens[1:]
    if not rest:
        return None

    token_out_raw = rest[0]
    token_in_raw = None
    if "with" in rest:
        idx = rest.index("with")
        token_out_raw = rest[0] if idx > 0 else None
        with_rest = rest[idx + 1 :]
        if with_rest:
            token_in_raw = with_rest[0]
        if token_out_raw is None:
            return None

    token_out = _resolve_token(token_out_raw)
    if not token_out:
        return None

    token_in = _resolve_token(token_in_raw) if token_in_raw else "USDC"
    if token_in_raw and not token_in:
        return None

    return TradeIntent(
        action="swap",
        token_in=token_in,
        token_out=token_out,
        amount=amount,
        amount_unit=unit,
        chain=chain,
        confidence=1.0,
        clarification=None,
    )


def _parse_sell(tokens: list, chain: Optional[str]) -> Optional[TradeIntent]:
    if not tokens:
        return None
    amount_result = _parse_amount(tokens[0])
    if amount_result is None:
        return None
    amount, unit = amount_result

    rest = tokens[1:]
    if not rest:
        return None

    split = _split_on_connector(rest)
    if split:
        left, right = split
        if not left or not right:
            return None
        token_in_raw = left[0]
        token_out_raw = right[0]
    else:
        token_in_raw = rest[0]
        token_out_raw = "USDC"

    token_in = _resolve_token(token_in_raw)
    token_out = _resolve_token(token_out_raw)
    if not token_in or not token_out:
        return None

    return TradeIntent(
        action="swap",
        token_in=token_in,
        token_out=token_out,
        amount=amount,
        amount_unit=unit,
        chain=chain,
        confidence=1.0,
        clarification=None,
    )
