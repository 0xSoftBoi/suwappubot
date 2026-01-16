"""Error handling and user-friendly error messages."""

from typing import Optional
from dataclasses import dataclass


@dataclass
class UserFriendlyError:
    """An error with both technical and user-friendly messages."""
    code: str
    user_message: str
    technical_message: str
    suggestion: Optional[str] = None


# Error message mappings
ERROR_MESSAGES = {
    # Li.Fi errors
    "NO_ROUTES_FOUND": UserFriendlyError(
        code="NO_ROUTES_FOUND",
        user_message="❌ No swap route found for this pair.",
        technical_message="Li.Fi returned no routes",
        suggestion="Try a different token pair or smaller amount."
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
        suggestion="Check your balance and try a smaller amount."
    ),
    "INSUFFICIENT_GAS": UserFriendlyError(
        code="INSUFFICIENT_GAS",
        user_message="❌ Not enough gas to complete transaction.",
        technical_message="Insufficient native token for gas",
        suggestion="Add more ETH/BNB/MATIC for gas fees."
    ),
    "SLIPPAGE_TOO_HIGH": UserFriendlyError(
        code="SLIPPAGE_TOO_HIGH",
        user_message="❌ Price moved too much during swap.",
        technical_message="Slippage exceeded tolerance",
        suggestion="Increase slippage tolerance or try again."
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
        suggestion="Get a new quote and try again."
    ),
    "PRICE_IMPACT_HIGH": UserFriendlyError(
        code="PRICE_IMPACT_HIGH",
        user_message="⚠️ High price impact detected.",
        technical_message="Price impact > 5%",
        suggestion="Consider swapping a smaller amount."
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


def detect_error_code(error_message: str) -> str:
    """Try to detect error code from error message string."""
    error_lower = error_message.lower()
    
    if "no route" in error_lower or "no routes" in error_lower:
        return "NO_ROUTES_FOUND"
    elif "insufficient liquidity" in error_lower or "liquidity" in error_lower:
        return "INSUFFICIENT_LIQUIDITY"
    elif "insufficient balance" in error_lower or "balance" in error_lower:
        return "INSUFFICIENT_BALANCE"
    elif "insufficient" in error_lower and "gas" in error_lower:
        return "INSUFFICIENT_GAS"
    elif "slippage" in error_lower:
        return "SLIPPAGE_TOO_HIGH"
    elif "revert" in error_lower:
        return "TRANSACTION_REVERTED"
    elif "timeout" in error_lower:
        return "TRANSACTION_TIMEOUT"
    elif "rate limit" in error_lower or "429" in error_lower:
        return "RATE_LIMITED"
    elif "price impact" in error_lower:
        return "PRICE_IMPACT_HIGH"
    elif "expired" in error_lower:
        return "QUOTE_EXPIRED"
    elif "rpc" in error_lower or "connection" in error_lower:
        return "RPC_ERROR"
    
    return "UNKNOWN_ERROR"


def handle_swap_error(exception: Exception) -> str:
    """Convert exception to user-friendly message."""
    error_str = str(exception)
    error_code = detect_error_code(error_str)
    error = get_error_message(error_code)
    return format_error_for_user(error)

