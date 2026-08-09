"""Failure diagnosis for swap/transaction errors.

Turns a raised exception (or its message) into a calm, plain-language
explanation plus the ONE exact next action the user should take. The goal is
to never show "something went wrong" — every failure is classified into a
named cause with a concrete remedy.

Design principles (from UX research, see swap.py callers):
  1. Name the exact problem — generic "an error occurred" is forbidden.
  2. Assist, don't admonish — no blame, no theatrical apologies, no raw revert
     hex. Reserve the 🔴 alarm for genuine fund loss only.
  3. Split "you can fix this" from "you must wait / go elsewhere" — every cause
     maps to exactly one next action.
  4. Reassure on safety where true ("your funds are safe") for timeouts and
     reverts where no money moved.

Classification matches on the real :class:`~bot.utils.exceptions.ErrorCode`
when present (strong signal) and otherwise on substrings found in the actual
``SwapError`` messages raised across ``bot/services/swap_engine.py`` and
``bot/utils/quote_validator.py`` — it does not invent error shapes.

The mapping table (``_CATEGORY_COPY``) is declarative so copy can be edited
without touching the classification logic.
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass, field
from typing import Any, Optional

from bot.utils.exceptions import ErrorCode, SwapError

logger = logging.getLogger(__name__)


# --- Categories -------------------------------------------------------------

# Canonical category names. Stored on the swap row (error_category column) for
# analytics and used as the lookup key into the declarative copy table.
CAT_INSUFFICIENT_GAS = "insufficient_gas"
CAT_INSUFFICIENT_BALANCE = "insufficient_balance"
CAT_SLIPPAGE_EXCEEDED = "slippage_exceeded"
CAT_ALLOWANCE_MISSING = "allowance_missing"
CAT_RPC_TIMEOUT = "rpc_timeout"
CAT_BRIDGE_TIMEOUT = "bridge_timeout"
CAT_SIMULATION_REVERT = "simulation_revert"
CAT_USER_REJECTED = "user_rejected"
CAT_NO_ROUTE = "no_route"
CAT_UNSUPPORTED = "unsupported"
CAT_UNKNOWN = "unknown"


@dataclass
class ErrorGuidance:
    """A classified, user-facing diagnosis of a swap failure.

    Attributes:
        category: Canonical machine name (also stored on the swap row).
        title: Short headline line (already contains the lead emoji).
        explanation: One or two calm, plain-language sentences naming the cause.
        next_action: The single concrete thing the user should do next.
        action_payload: Hints for the UI layer — ``retry`` (bool, show a
            Retry/Re-quote button), ``button_text``/``button_callback`` (an
            explicit inline button), or ``deep_link`` (a target screen).
        is_fund_loss: True only when funds genuinely moved/were lost. Drives the
            🔴 alarm; False for timeouts, reverts, and pre-flight rejections.
        reference_id: Always present. Short hex id the user can quote to support
            (and that is logged server-side for correlation).
    """

    category: str
    title: str
    explanation: str
    next_action: str
    action_payload: dict[str, Any] = field(default_factory=dict)
    is_fund_loss: bool = False
    reference_id: str = ""

    def to_message(self) -> str:
        """Render the guidance as a Markdown Telegram message body."""
        lead = "🔴 " if self.is_fund_loss else ""
        lines = [
            f"{lead}*{self.title}*",
            "",
            self.explanation,
            "",
            f"➡️ *Next:* {self.next_action}",
        ]
        if self.category == CAT_UNKNOWN:
            lines += ["", f"_Reference: `{self.reference_id}`_"]
        return "\n".join(lines)


# --- Declarative copy table -------------------------------------------------
#
# Keep this table editable in isolation: each entry is pure copy + UI hints.
# ``{CHAIN}`` / ``{TOKEN}`` / ``{NATIVE}`` placeholders are filled from context
# at classify time. ``ref`` indicates the unknown bucket (which surfaces the
# reference id in the message).

_CATEGORY_COPY: dict[str, dict[str, Any]] = {
    CAT_INSUFFICIENT_GAS: {
        "title": "Not enough gas",
        "explanation": (
            "You don't have enough {NATIVE} on {CHAIN} to cover the network "
            "fee. Your funds are safe — nothing was spent."
        ),
        "next_action": "Top up a little {NATIVE} on {CHAIN}, then retry.",
        "action_payload": {"retry": True, "button_text": "🔄 Retry"},
        "is_fund_loss": False,
    },
    CAT_INSUFFICIENT_BALANCE: {
        "title": "Not enough balance",
        "explanation": (
            "You don't have enough {TOKEN} on {CHAIN} for this swap. Your funds "
            "are safe — nothing was spent."
        ),
        "next_action": "Lower the amount or fund this wallet, then retry.",
        "action_payload": {"retry": True, "button_text": "🔄 Retry"},
        "is_fund_loss": False,
    },
    CAT_SLIPPAGE_EXCEEDED: {
        "title": "Price moved too much",
        "explanation": (
            "The price moved more than your slippage limit while the swap was "
            "confirming, so it was stopped. Your funds are safe."
        ),
        "next_action": "Get a fresh quote and try again.",
        "action_payload": {
            "retry": True,
            "button_text": "🔄 Re-quote",
            "button_callback": "swap_requote",
        },
        "is_fund_loss": False,
    },
    CAT_ALLOWANCE_MISSING: {
        "title": "One-time approval needed",
        "explanation": (
            "This token needs a one-time approval before it can be swapped. "
            "Your funds are safe — nothing was spent."
        ),
        "next_action": "Approve the token, then retry the swap.",
        "action_payload": {"retry": True, "button_text": "🔄 Retry"},
        "is_fund_loss": False,
    },
    CAT_RPC_TIMEOUT: {
        "title": "The network is slow right now",
        "explanation": (
            "{CHAIN} took too long to respond, so we paused before spending "
            "anything. Your funds are safe."
        ),
        "next_action": "Try again in a moment — it usually clears quickly.",
        "action_payload": {"retry": True, "button_text": "🔄 Retry"},
        "is_fund_loss": False,
    },
    CAT_BRIDGE_TIMEOUT: {
        "title": "The bridge is taking longer than usual",
        "explanation": (
            "Your transaction was submitted but the bridge hasn't confirmed "
            "yet. This is normal during congestion — your funds are safe and "
            "in transit."
        ),
        "next_action": "Check the status in a few minutes — no action needed now.",
        "action_payload": {"retry": False, "button_text": "📊 Check status"},
        "is_fund_loss": False,
    },
    CAT_SIMULATION_REVERT: {
        "title": "Swap stopped before spending",
        "explanation": (
            "We simulated the swap first and it would fail on-chain, so we "
            "stopped it before spending anything. Your funds are safe.{REASON}"
        ),
        "next_action": "Re-quote and try again, or pick a different token/route.",
        "action_payload": {
            "retry": True,
            "button_text": "🔄 Re-quote",
            "button_callback": "swap_requote",
        },
        "is_fund_loss": False,
    },
    CAT_USER_REJECTED: {
        "title": "Transaction declined",
        "explanation": "You declined this transaction, so nothing was spent.",
        "next_action": "Start the swap again whenever you're ready.",
        "action_payload": {"retry": True, "button_text": "🔄 Try again"},
        "is_fund_loss": False,
    },
    CAT_NO_ROUTE: {
        "title": "No route available right now",
        "explanation": (
            "No provider could route this swap at the moment. This is usually "
            "thin liquidity or a momentary provider hiccup. Your funds are safe."
        ),
        "next_action": "Try again shortly, or adjust the amount/token pair.",
        "action_payload": {"retry": True, "button_text": "🔄 Try again"},
        "is_fund_loss": False,
    },
    CAT_UNSUPPORTED: {
        "title": "This pair isn't supported",
        "explanation": (
            "This token or chain combination isn't supported for swapping yet. "
            "Your funds are safe — nothing was spent."
        ),
        "next_action": "Pick a different token or chain and try again.",
        "action_payload": {"retry": True, "button_text": "🔄 Try again"},
        "is_fund_loss": False,
    },
    CAT_UNKNOWN: {
        "title": "We hit a snag completing your swap",
        "explanation": (
            "Something unexpected interrupted this swap. We checked first and, "
            "as far as we can tell, your funds are safe."
        ),
        "next_action": "Contact support with the reference below and we'll dig in.",
        "action_payload": {"retry": True, "button_text": "🔄 Try again"},
        "is_fund_loss": False,
    },
}


# --- ErrorCode → category fast path -----------------------------------------
#
# When a SwapError carries a real ErrorCode, trust it over substring matching.

_CODE_TO_CATEGORY: dict[ErrorCode, str] = {
    ErrorCode.INSUFFICIENT_GAS: CAT_INSUFFICIENT_GAS,
    ErrorCode.INSUFFICIENT_BALANCE: CAT_INSUFFICIENT_BALANCE,
    ErrorCode.SLIPPAGE_EXCEEDED: CAT_SLIPPAGE_EXCEEDED,
    ErrorCode.APPROVAL_FAILED: CAT_ALLOWANCE_MISSING,
    ErrorCode.PROVIDER_TIMEOUT: CAT_RPC_TIMEOUT,
    ErrorCode.RPC_ERROR: CAT_RPC_TIMEOUT,
    ErrorCode.SIMULATION_FAILED: CAT_SIMULATION_REVERT,
    ErrorCode.TRANSACTION_REVERTED: CAT_SIMULATION_REVERT,
    ErrorCode.NO_ROUTE_FOUND: CAT_NO_ROUTE,
    ErrorCode.INSUFFICIENT_LIQUIDITY: CAT_NO_ROUTE,
    ErrorCode.PRICE_IMPACT_TOO_HIGH: CAT_SLIPPAGE_EXCEEDED,
    ErrorCode.CHAIN_NOT_SUPPORTED: CAT_UNSUPPORTED,
    ErrorCode.TOKEN_NOT_SUPPORTED: CAT_UNSUPPORTED,
}


# --- Substring rules --------------------------------------------------------
#
# Ordered most-specific → least-specific. Each entry: (category, [needles]).
# Matched case-insensitively against the lowered error message. Order matters:
# e.g. "insufficient gas" must beat the generic "insufficient" balance rule,
# and "user rejected" must beat a generic revert rule.

_SUBSTRING_RULES: list[tuple[str, tuple[str, ...]]] = [
    # User explicitly declined / cancelled signing.
    (
        CAT_USER_REJECTED,
        ("user rejected", "user denied", "rejected the request", "declined", "user cancelled"),
    ),
    # Gas / native-token shortfall (engine: "Insufficient gas. You need at least ...").
    (
        CAT_INSUFFICIENT_GAS,
        ("insufficient gas", "insufficient funds for gas", "need more", "for transaction fees"),
    ),
    # One-time token approval problems (engine: "ERC20 approval failed", "Tempo DEX approval failed").
    (
        CAT_ALLOWANCE_MISSING,
        ("approval failed", "allowance", "not approved", "approve "),
    ),
    # Slippage / price movement / expired quote (validator: "Quote expired", "Slippage tolerance ...").
    (
        CAT_SLIPPAGE_EXCEEDED,
        (
            "slippage",
            "price moved",
            "price impact",
            "min-out",
            "minimum output",
            # Standard router slippage reverts (Uniswap/1inch/etc.) — must be
            # listed before the generic "execution reverted" rule below so a
            # slippage failure isn't mislabeled as a bare simulation revert.
            "too little received",
            "insufficient_output_amount",
            "insufficient output amount",
            "exceeds max slippage",
            "quote expired",
            "quote is",
        ),
    ),
    # Safety simulation blocked the trade (engine: "Safety simulation FAILED: ...").
    (
        CAT_SIMULATION_REVERT,
        (
            "simulation failed",
            "safety simulation",
            "trade blocked",
            "would fail on-chain",
            "execution reverted",
            "revert",
        ),
    ),
    # Cross-chain bridge still settling.
    (
        CAT_BRIDGE_TIMEOUT,
        ("bridge timeout", "bridge is", "still in transit", "awaiting bridge", "bridge pending"),
    ),
    # Generic network/RPC slowness or timeout.
    (
        CAT_RPC_TIMEOUT,
        ("timeout", "timed out", "rpc", "connection", "network is slow", "too many requests"),
    ),
    # Balance shortfall (validator: "Insufficient {TOKEN} balance", handler: "Insufficient funds").
    (
        CAT_INSUFFICIENT_BALANCE,
        ("insufficient balance", "insufficient funds", "not enough", "balance"),
    ),
    # No provider could route.
    (
        CAT_NO_ROUTE,
        ("no provider returned", "no route", "no valid quote", "insufficient liquidity"),
    ),
    # Unsupported pair / chain.
    (
        CAT_UNSUPPORTED,
        ("not supported", "does not support", "not available", "unsupported"),
    ),
]


def _extract_message(exc_or_message: Any) -> str:
    """Coerce an exception or raw value into a plain message string."""
    if exc_or_message is None:
        return ""
    if isinstance(exc_or_message, str):
        return exc_or_message
    if isinstance(exc_or_message, BaseException):
        return str(exc_or_message)
    return str(exc_or_message)


def _classify_category(exc_or_message: Any, message: str) -> str:
    """Decide the category from ErrorCode (preferred) then substrings."""
    # 1. Trust an explicit ErrorCode when present and meaningful.
    if isinstance(exc_or_message, SwapError):
        code = getattr(exc_or_message, "code", None)
        if isinstance(code, ErrorCode) and code in _CODE_TO_CATEGORY:
            return _CODE_TO_CATEGORY[code]

    # 2. Fall back to ordered substring matching on the message text.
    lowered = message.lower()
    for category, needles in _SUBSTRING_RULES:
        if any(needle in lowered for needle in needles):
            return category

    return CAT_UNKNOWN


def _native_token_for_chain(chain: Optional[str]) -> str:
    """Best-effort native gas token symbol for a chain (e.g. ETH, SOL)."""
    if not chain:
        return "gas"
    try:
        from bot.config.chains import get_chain_by_name

        cfg = get_chain_by_name(chain)
        if cfg and cfg.native_token:
            return cfg.native_token
    except Exception:  # pragma: no cover - defensive, never block a diagnosis
        pass
    return "gas"


def _display_chain(chain: Optional[str]) -> str:
    """Human chain label (display_name when known, else the raw value)."""
    if not chain:
        return "this chain"
    try:
        from bot.config.chains import get_chain_by_name

        cfg = get_chain_by_name(chain)
        if cfg and cfg.display_name:
            return cfg.display_name
    except Exception:  # pragma: no cover - defensive
        pass
    return chain


def classify_swap_failure(
    exc_or_message: Any,
    context: Optional[dict[str, Any]] = None,
) -> ErrorGuidance:
    """Classify a swap failure into structured, user-facing guidance.

    Args:
        exc_or_message: The raised exception (ideally a
            :class:`~bot.utils.exceptions.SwapError`) or a raw message string.
        context: Optional hints used to fill copy placeholders. Recognized
            keys: ``from_chain`` / ``chain``, ``to_chain``, ``from_token`` /
            ``token``, and ``is_cross_chain`` (promotes an ambiguous timeout to
            a bridge timeout). All optional — the copy degrades gracefully.

    Returns:
        An :class:`ErrorGuidance`. The ``unknown`` path always carries a
        non-empty ``reference_id``.
    """
    context = context or {}
    message = _extract_message(exc_or_message)

    category = _classify_category(exc_or_message, message)

    # Promote a generic RPC timeout to a bridge timeout when this is a known
    # cross-chain swap — the reassurance ("in transit") is materially different.
    if category == CAT_RPC_TIMEOUT and context.get("is_cross_chain"):
        category = CAT_BRIDGE_TIMEOUT

    copy = _CATEGORY_COPY.get(category, _CATEGORY_COPY[CAT_UNKNOWN])

    chain = context.get("from_chain") or context.get("chain") or context.get("to_chain")
    token = context.get("from_token") or context.get("token") or "your token"
    native = _native_token_for_chain(chain)
    chain_label = _display_chain(chain)

    # Surface a sanitized simulation reason when one is present — never raw hex.
    reason = ""
    if category == CAT_SIMULATION_REVERT:
        raw_reason = context.get("reason")
        if raw_reason:
            reason = f"\n\nReason: {str(raw_reason).strip()[:140]}"

    def _fill(value: str) -> str:
        filled = (
            value.replace("{NATIVE}", native)
            .replace("{CHAIN}", chain_label)
            .replace("{TOKEN}", token)
            .replace("{REASON}", reason)
        )
        # Sentence-case the leading character. Templates that begin with a
        # substituted value (e.g. "{CHAIN} took too long") would otherwise
        # render lowercase mid-sentence ("this chain took too long...").
        if filled and filled[0].islower():
            filled = filled[0].upper() + filled[1:]
        return filled

    # A reference id is ALWAYS generated (cheap) so the unknown path — and any
    # logging correlation — always has one to quote.
    reference_id = secrets.token_hex(4)

    guidance = ErrorGuidance(
        category=category,
        title=_fill(copy["title"]),
        explanation=_fill(copy["explanation"]),
        next_action=_fill(copy["next_action"]),
        action_payload=dict(copy.get("action_payload", {})),
        is_fund_loss=bool(copy.get("is_fund_loss", False)),
        reference_id=reference_id,
    )

    # Server-side correlation: the raw detail is logged, never shown.
    logger.info(
        "swap_failure_classified category=%s ref=%s detail=%r",
        category,
        reference_id,
        message[:300],
    )

    return guidance


# --- Generic (non-swap) handler helper --------------------------------------
#
# Some handlers fail on things that were never a swap (a gas-price fetch, a 2FA
# check, a quote lookup) but still must never echo a raw exception into chat.
# This is a smaller, chain/swap-agnostic sibling of ``classify_swap_failure``
# for those call sites — see swap.py's ``_render_swap_failure`` for the
# full-card pattern this mirrors at one-line scale.

_GENERIC_RATE_LIMIT_NEEDLES = ("rate limit", "too many requests", "429")
_GENERIC_NETWORK_NEEDLES = (
    "timeout",
    "timed out",
    "connection",
    "rpc",
    "network",
    "unreachable",
)


def user_facing_error(exc_or_message: Any, *, prefix: str = "❌ ") -> str:
    """Render one calm, human-readable line for a non-swap handler failure.

    For handlers that hit a plain service/API error (fetching gas prices, a
    quote lookup, a 2FA check, ...) rather than an on-chain swap — too small to
    warrant the full :class:`ErrorGuidance` card. Still never echoes a raw
    exception:

    - ``ValueError`` is this codebase's convention for a service raising a
      deliberate, already user-safe validation message (see
      ``bot/services/twofa.py``) — shown as-is.
    - Anything else is classified into a short, generic cause (network/
      timeout, rate limit) or a calm fallback carrying a reference id.

    The raw detail is always logged server-side first, so callers don't need
    a separate log line purely to capture the exception text (they should
    still log with ``exc_info=True`` when the traceback itself is useful).
    """
    message = _extract_message(exc_or_message)
    reference_id = secrets.token_hex(4)
    logger.info("user_facing_error ref=%s detail=%r", reference_id, message[:300])

    if isinstance(exc_or_message, ValueError) and message.strip():
        return f"{prefix}{message.strip()}"

    lowered = message.lower()
    if any(needle in lowered for needle in _GENERIC_RATE_LIMIT_NEEDLES):
        return (
            f"{prefix}We're being rate-limited right now — please wait a few seconds and try again."
        )
    if any(needle in lowered for needle in _GENERIC_NETWORK_NEEDLES):
        return f"{prefix}The network is slow or unreachable right now. Please try again shortly."

    return (
        f"{prefix}Something unexpected happened. Please try again in a moment. "
        f"_Reference: `{reference_id}`_"
    )
