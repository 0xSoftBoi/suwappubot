"""Error handling and user-friendly error messages."""

import re
from typing import Optional
from dataclasses import dataclass, field


@dataclass
class UserFriendlyError:
    """An error with both technical and user-friendly messages."""
    code: str
    user_message: str
    technical_message: str
    suggestion: Optional[str] = None
    recovery_actions: Optional[list[tuple[str, str]]] = field(default=None)
    """List of (button_text, callback_data) pairs for recovery buttons."""


# Error message mappings
ERROR_MESSAGES = {
    # Li.Fi errors
    "NO_ROUTES_FOUND": UserFriendlyError(
        code="NO_ROUTES_FOUND",
        user_message="❌ No swap route found for this pair.",
        technical_message="Li.Fi returned no routes",
        suggestion="Try a different token pair or smaller amount.",
        recovery_actions=[("Try Different Pair", "swap_start"), ("Main Menu", "main_menu")],
    ),
    "INSUFFICIENT_LIQUIDITY": UserFriendlyError(
        code="INSUFFICIENT_LIQUIDITY",
        user_message="❌ Not enough liquidity for this swap.",
        technical_message="Insufficient liquidity in pools",
        suggestion="Try a smaller amount or wait for more liquidity."
    ),
    "AMOUNT_TOO_LOW": UserFriendlyError(
        code="AMOUNT_TOO_LOW",
        user_message="❌ Amount is too low for this swap.",
        technical_message="Amount below minimum threshold",
        suggestion="Increase the swap amount."
    ),
    "AMOUNT_TOO_HIGH": UserFriendlyError(
        code="AMOUNT_TOO_HIGH",
        user_message="❌ Amount is too high for this swap.",
        technical_message="Amount exceeds maximum threshold",
        suggestion="Try a smaller amount or split into multiple swaps."
    ),

    # Transaction errors
    "INSUFFICIENT_BALANCE": UserFriendlyError(
        code="INSUFFICIENT_BALANCE",
        user_message="❌ Insufficient balance for this swap.",
        technical_message="Wallet balance too low",
        suggestion="Check your balance and try a smaller amount.",
        recovery_actions=[("Try Different Amount", "swap_start"), ("Main Menu", "main_menu")],
    ),
    "INSUFFICIENT_GAS": UserFriendlyError(
        code="INSUFFICIENT_GAS",
        user_message="❌ Not enough gas to complete transaction.",
        technical_message="Insufficient native token for gas",
        suggestion="Add more ETH/BNB/MATIC for gas fees.",
        recovery_actions=[("View Wallets", "wallet_menu"), ("Main Menu", "main_menu")],
    ),
    "SLIPPAGE_TOO_HIGH": UserFriendlyError(
        code="SLIPPAGE_TOO_HIGH",
        user_message="❌ Price moved too much during swap.",
        technical_message="Slippage exceeded tolerance",
        suggestion="Increase slippage tolerance or try again.",
        recovery_actions=[("Retry", "swap_requote"), ("Settings", "settings_menu")],
    ),
    "TRANSACTION_REVERTED": UserFriendlyError(
        code="TRANSACTION_REVERTED",
        user_message="❌ Transaction was reverted.",
        technical_message="Smart contract reverted execution",
        suggestion="Try again with higher gas or different settings."
    ),
    "TRANSACTION_TIMEOUT": UserFriendlyError(
        code="TRANSACTION_TIMEOUT",
        user_message="⏰ Transaction timed out.",
        technical_message="Transaction not mined in time",
        suggestion="Check explorer for status. May still complete."
    ),

    # Network errors
    "RPC_ERROR": UserFriendlyError(
        code="RPC_ERROR",
        user_message="❌ Network connection error.",
        technical_message="RPC endpoint failed",
        suggestion="Please try again in a moment."
    ),
    "NETWORK_CONGESTED": UserFriendlyError(
        code="NETWORK_CONGESTED",
        user_message="🚧 Network is congested.",
        technical_message="High network traffic",
        suggestion="Wait a few minutes or increase gas price."
    ),

    # API errors
    "RATE_LIMITED": UserFriendlyError(
        code="RATE_LIMITED",
        user_message="⏳ Too many requests. Please wait.",
        technical_message="API rate limit exceeded",
        suggestion="Wait a moment before trying again."
    ),
    "API_ERROR": UserFriendlyError(
        code="API_ERROR",
        user_message="❌ Service temporarily unavailable.",
        technical_message="External API error",
        suggestion="Please try again in a moment."
    ),

    # Wallet errors
    "INVALID_ADDRESS": UserFriendlyError(
        code="INVALID_ADDRESS",
        user_message="❌ Invalid wallet address.",
        technical_message="Address validation failed",
        suggestion="Check the address format."
    ),
    "WALLET_NOT_FOUND": UserFriendlyError(
        code="WALLET_NOT_FOUND",
        user_message="❌ Wallet not found.",
        technical_message="No wallet in database",
        suggestion="Add a wallet first with /w."
    ),

    # Quote errors
    "QUOTE_EXPIRED": UserFriendlyError(
        code="QUOTE_EXPIRED",
        user_message="⏰ Quote expired.",
        technical_message="Quote TTL exceeded",
        suggestion="Get a new quote and try again.",
        recovery_actions=[("Get New Quote", "swap_requote"), ("Main Menu", "main_menu")],
    ),
    "PRICE_IMPACT_HIGH": UserFriendlyError(
        code="PRICE_IMPACT_HIGH",
        user_message="⚠️ High price impact detected.",
        technical_message="Price impact > 5%",
        suggestion="Consider swapping a smaller amount."
    ),

    # --- Provider-specific errors ---
    "PROVIDER_TIMEOUT": UserFriendlyError(
        code="PROVIDER_TIMEOUT",
        user_message="⏰ Quote provider timed out.",
        technical_message="Provider quote request timed out",
        suggestion="Trying again may help.",
        recovery_actions=[("Retry", "swap_requote"), ("Main Menu", "main_menu")],
    ),
    "ALL_PROVIDERS_FAILED": UserFriendlyError(
        code="ALL_PROVIDERS_FAILED",
        user_message="❌ All swap providers unavailable.",
        technical_message="No provider returned a valid quote",
        suggestion="Please try again.",
        recovery_actions=[("Retry", "swap_requote"), ("Main Menu", "main_menu")],
    ),
    "SIMULATION_FAILED": UserFriendlyError(
        code="SIMULATION_FAILED",
        user_message="❌ Safety check failed. Trade blocked to protect funds.",
        technical_message="Deep simulation blocked the trade",
        suggestion="The token may be unsafe. Proceed with caution.",
    ),
    "APPROVAL_FAILED": UserFriendlyError(
        code="APPROVAL_FAILED",
        user_message="❌ Token approval failed.",
        technical_message="Token approval transaction reverted",
        suggestion="Check allowance settings and try again.",
        recovery_actions=[("Retry", "swap_start"), ("Main Menu", "main_menu")],
    ),
    "BRIDGE_PENDING": UserFriendlyError(
        code="BRIDGE_PENDING",
        user_message="🌉 Bridge transfer in progress.",
        technical_message="Cross-chain bridge still processing",
        suggestion="Check /hx for status.",
    ),
    "UNSUPPORTED_CHAIN": UserFriendlyError(
        code="UNSUPPORTED_CHAIN",
        user_message="❌ This chain is not supported for this swap route.",
        technical_message="Chain not supported by provider",
        suggestion="Try a different chain.",
        recovery_actions=[("Try Different Pair", "swap_start"), ("Main Menu", "main_menu")],
    ),
    "UNSUPPORTED_TOKEN": UserFriendlyError(
        code="UNSUPPORTED_TOKEN",
        user_message="❌ Token not recognized.",
        technical_message="Token not found in registry",
        suggestion="Check the token symbol.",
        recovery_actions=[("Try Different Pair", "swap_start"), ("Main Menu", "main_menu")],
    ),
    "WALLET_LOCKED": UserFriendlyError(
        code="WALLET_LOCKED",
        user_message="🔒 Wallet is busy with another swap.",
        technical_message="Concurrent swap on same wallet",
        suggestion="Please wait for the current swap to complete.",
        recovery_actions=[("Check Status", "main_menu"), ("Main Menu", "main_menu")],
    ),
    "GAS_ESTIMATION_FAILED": UserFriendlyError(
        code="GAS_ESTIMATION_FAILED",
        user_message="❌ Could not estimate gas. The transaction may fail.",
        technical_message="Gas estimation reverted",
        suggestion="The transaction may revert. Try a different amount or pair.",
        recovery_actions=[("Retry", "swap_start"), ("Main Menu", "main_menu")],
    ),
    "NONCE_ERROR": UserFriendlyError(
        code="NONCE_ERROR",
        user_message="❌ Transaction nonce conflict.",
        technical_message="Nonce conflict detected",
        suggestion="Please retry.",
        recovery_actions=[("Retry", "swap_start"), ("Main Menu", "main_menu")],
    ),
    "COW_ORDER_EXPIRED": UserFriendlyError(
        code="COW_ORDER_EXPIRED",
        user_message="⏰ CoW order expired without fill.",
        technical_message="CoW Protocol order not filled in time",
        suggestion="Try again.",
        recovery_actions=[("Retry", "swap_requote"), ("Main Menu", "main_menu")],
    ),
    "JITO_BUNDLE_FAILED": UserFriendlyError(
        code="JITO_BUNDLE_FAILED",
        user_message="❌ MEV bundle was not included.",
        technical_message="Jito bundle dropped",
        suggestion="Retrying via standard RPC.",
        recovery_actions=[("Retry", "swap_requote"), ("Main Menu", "main_menu")],
    ),
    "DECRYPTION_FAILED": UserFriendlyError(
        code="DECRYPTION_FAILED",
        user_message="❌ Could not access wallet.",
        technical_message="Wallet key decryption error",
        suggestion="Please re-import your wallet.",
        recovery_actions=[("Wallet Settings", "wallet_menu"), ("Main Menu", "main_menu")],
    ),
    "TWO_FA_REQUIRED": UserFriendlyError(
        code="TWO_FA_REQUIRED",
        user_message="🔐 2FA verification required for this swap.",
        technical_message="2FA needed but not provided",
        suggestion="Enter your verification code.",
    ),
    "PAIR_NOT_SUPPORTED": UserFriendlyError(
        code="PAIR_NOT_SUPPORTED",
        user_message="❌ This token pair is not supported on these chains.",
        technical_message="No route exists for this pair",
        suggestion="Try a different token pair or chain combination.",
        recovery_actions=[("Try Different Pair", "swap_start"), ("Main Menu", "main_menu")],
    ),

    # Generic
    "UNKNOWN_ERROR": UserFriendlyError(
        code="UNKNOWN_ERROR",
        user_message="❌ An unexpected error occurred.",
        technical_message="Unknown error",
        suggestion="Please try again or contact support."
    ),
}


def get_error_message(error_code: str) -> UserFriendlyError:
    """Get user-friendly error message for an error code."""
    return ERROR_MESSAGES.get(error_code, ERROR_MESSAGES["UNKNOWN_ERROR"])


def format_error_for_user(error: UserFriendlyError) -> str:
    """Format error for display to user."""
    message = error.user_message
    if error.suggestion:
        message += f"\n\n💡 {error.suggestion}"
    return message


def format_error_with_buttons(error: UserFriendlyError):
    """Format error with recovery action buttons.

    Returns:
        Tuple of (text, InlineKeyboardMarkup | None)
    """
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    text = format_error_for_user(error)

    if not error.recovery_actions:
        return text, None

    buttons = [
        InlineKeyboardButton(label, callback_data=cb)
        for label, cb in error.recovery_actions
    ]
    # Put all buttons in one row (max 2-3 is fine)
    keyboard = InlineKeyboardMarkup([buttons])
    return text, keyboard


# Ordered list of (pattern, error_code) for detect_error_code.
# More specific patterns come first; generic ones last.
_ERROR_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Provider-specific
    (re.compile(r"cow.*expired|order expired", re.IGNORECASE), "COW_ORDER_EXPIRED"),
    (re.compile(r"bundle|jito", re.IGNORECASE), "JITO_BUNDLE_FAILED"),
    # Simulation / safety
    (re.compile(r"simulation|honeypot|safety", re.IGNORECASE), "SIMULATION_FAILED"),
    # Approval
    (re.compile(r"approval|allowance", re.IGNORECASE), "APPROVAL_FAILED"),
    # Wallet locking
    (re.compile(r"locked|busy|concurrent", re.IGNORECASE), "WALLET_LOCKED"),
    # Gas estimation
    (re.compile(r"gas estimation|estimate gas", re.IGNORECASE), "GAS_ESTIMATION_FAILED"),
    # Nonce
    (re.compile(r"nonce", re.IGNORECASE), "NONCE_ERROR"),
    # Decryption
    (re.compile(r"decrypt|decryption", re.IGNORECASE), "DECRYPTION_FAILED"),
    # Timeouts (provider-level)
    (re.compile(r"timed out|timeout|deadline", re.IGNORECASE), "PROVIDER_TIMEOUT"),
    # All providers failed
    (re.compile(r"all .* failed|no quotes", re.IGNORECASE), "ALL_PROVIDERS_FAILED"),
    # Unsupported chain/token
    (re.compile(r"not supported|unsupported", re.IGNORECASE), "UNSUPPORTED_CHAIN"),
    # Original patterns (kept in priority order)
    (re.compile(r"no routes?", re.IGNORECASE), "NO_ROUTES_FOUND"),
    (re.compile(r"insufficient liquidity|liquidity", re.IGNORECASE), "INSUFFICIENT_LIQUIDITY"),
    (re.compile(r"insufficient balance|balance", re.IGNORECASE), "INSUFFICIENT_BALANCE"),
    (re.compile(r"insufficient.*gas", re.IGNORECASE), "INSUFFICIENT_GAS"),
    (re.compile(r"slippage", re.IGNORECASE), "SLIPPAGE_TOO_HIGH"),
    (re.compile(r"revert", re.IGNORECASE), "TRANSACTION_REVERTED"),
    (re.compile(r"rate limit|429", re.IGNORECASE), "RATE_LIMITED"),
    (re.compile(r"price impact", re.IGNORECASE), "PRICE_IMPACT_HIGH"),
    (re.compile(r"expired", re.IGNORECASE), "QUOTE_EXPIRED"),
    (re.compile(r"rpc|connection", re.IGNORECASE), "RPC_ERROR"),
]


def detect_error_code(error_message: str) -> str:
    """Try to detect error code from error message string.

    Checks exception's error_code attribute first (if present), then falls
    back to pattern matching on the message text.
    """
    # Database/schema errors should never match swap-specific codes
    error_lower = error_message.lower()
    if "column" in error_lower and ("does not exist" in error_lower or "no such column" in error_lower):
        return "UNKNOWN_ERROR"

    for pattern, code in _ERROR_PATTERNS:
        if pattern.search(error_message):
            return code

    return "UNKNOWN_ERROR"


def detect_error_code_from_exception(exception: Exception) -> str:
    """Detect error code from an exception, preferring its error_code attribute."""
    # Check for explicit error_code attribute first
    error_code = getattr(exception, "error_code", None)
    if error_code and error_code in ERROR_MESSAGES:
        return error_code

    return detect_error_code(str(exception))


def handle_swap_error(exception: Exception) -> str:
    """Convert exception to user-friendly message."""
    error_code = detect_error_code_from_exception(exception)
    error = get_error_message(error_code)
    return format_error_for_user(error)
