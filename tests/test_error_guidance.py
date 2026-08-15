"""Tests for bot.services.error_guidance.classify_swap_failure.

Covers each classified category from the real exception/message shapes raised
across the swap engine + quote validator, the ErrorCode fast path, and the
invariant that the unknown bucket always yields a reference id.
"""

from bot.services.error_guidance import (
    CAT_ALLOWANCE_MISSING,
    CAT_BRIDGE_TIMEOUT,
    CAT_INSUFFICIENT_BALANCE,
    CAT_INSUFFICIENT_GAS,
    CAT_NO_ROUTE,
    CAT_RPC_TIMEOUT,
    CAT_SIMULATION_REVERT,
    CAT_SLIPPAGE_EXCEEDED,
    CAT_UNKNOWN,
    CAT_UNSUPPORTED,
    CAT_USER_REJECTED,
    ErrorGuidance,
    classify_swap_failure,
)
from bot.utils.exceptions import ErrorCode, SwapError

# --- Substring classification (real engine/validator message strings) -------


def test_insufficient_gas_from_engine_message():
    msg = (
        "Insufficient gas. You need at least 0.00042 ETH on Ethereum to cover "
        "transaction fees. Send some ETH to your wallet first."
    )
    g = classify_swap_failure(msg, {"from_chain": "ethereum"})
    assert g.category == CAT_INSUFFICIENT_GAS
    assert g.is_fund_loss is False
    assert "ETH" in g.next_action  # native token filled in


def test_insufficient_balance_from_validator_message():
    msg = "Insufficient SOL balance. Have: 0.1000, Need: 1.0000"
    g = classify_swap_failure(msg, {"from_chain": "solana", "from_token": "SOL"})
    assert g.category == CAT_INSUFFICIENT_BALANCE
    assert "SOL" in g.explanation


def test_slippage_exceeded_from_validator_message():
    msg = "Slippage tolerance too high (12.0%). Maximum allowed: 10.0%."
    g = classify_swap_failure(msg)
    assert g.category == CAT_SLIPPAGE_EXCEEDED
    assert g.action_payload.get("button_callback") == "swap_requote"


def test_quote_expired_classified_as_slippage():
    msg = "Quote expired. Quote is 45 seconds old (max 30s). Please get a new quote."
    g = classify_swap_failure(msg)
    assert g.category == CAT_SLIPPAGE_EXCEEDED


def test_allowance_missing_from_approval_failure():
    msg = "ERC20 approval failed (tx: 0xabc123)"
    g = classify_swap_failure(msg)
    assert g.category == CAT_ALLOWANCE_MISSING


def test_rpc_timeout():
    g = classify_swap_failure("Request timed out talking to the RPC endpoint")
    assert g.category == CAT_RPC_TIMEOUT
    assert "safe" in g.explanation.lower()


def test_bridge_timeout_promoted_for_cross_chain():
    # A generic timeout on a cross-chain swap becomes a bridge timeout.
    g = classify_swap_failure(
        "connection timed out",
        {"from_chain": "ethereum", "to_chain": "arbitrum", "is_cross_chain": True},
    )
    assert g.category == CAT_BRIDGE_TIMEOUT


def test_simulation_revert_from_safety_message():
    msg = "⚠️ Safety simulation FAILED: token not tradeable. Trade blocked to protect your funds."
    g = classify_swap_failure(msg, {"reason": "token not tradeable"})
    assert g.category == CAT_SIMULATION_REVERT
    assert "token not tradeable" in g.explanation
    assert g.is_fund_loss is False


def test_user_rejected():
    g = classify_swap_failure("User rejected the request")
    assert g.category == CAT_USER_REJECTED


def test_no_route():
    g = classify_swap_failure("No provider returned a valid quote. Please try again.")
    assert g.category == CAT_NO_ROUTE


def test_unsupported_pair():
    g = classify_swap_failure("Token not supported on Solana: FOO or BAR")
    assert g.category == CAT_UNSUPPORTED


# --- ErrorCode fast path beats substrings -----------------------------------


def test_error_code_takes_precedence():
    # Message says nothing useful, but the code is authoritative.
    exc = SwapError("boom", code=ErrorCode.SLIPPAGE_EXCEEDED)
    g = classify_swap_failure(exc)
    assert g.category == CAT_SLIPPAGE_EXCEEDED


def test_simulation_failed_code():
    exc = SwapError("blocked", code=ErrorCode.SIMULATION_FAILED)
    assert classify_swap_failure(exc).category == CAT_SIMULATION_REVERT


def test_insufficient_gas_code():
    exc = SwapError("x", code=ErrorCode.INSUFFICIENT_GAS)
    assert classify_swap_failure(exc).category == CAT_INSUFFICIENT_GAS


# --- Unknown path always has a reference id ---------------------------------


def test_unknown_yields_reference_id():
    g = classify_swap_failure("totally novel failure mode with no keywords xyzzy")
    assert g.category == CAT_UNKNOWN
    assert g.reference_id
    assert len(g.reference_id) == 8
    int(g.reference_id, 16)  # raises if not hex


def test_unknown_message_includes_reference():
    g = classify_swap_failure(RuntimeError("opaque internal error qqq"))
    assert g.category == CAT_UNKNOWN
    assert g.reference_id in g.to_message()
    assert "Reference" in g.to_message()


def test_every_classification_has_reference_id():
    # The reference id is always generated, not only on the unknown path.
    g = classify_swap_failure("Insufficient gas for transaction fees")
    assert g.reference_id
    assert len(g.reference_id) == 8


# --- Message rendering & tone -----------------------------------------------


def test_no_raw_exception_text_leaks_for_unknown():
    secret = "postgres://user:pw@db-host/secret"
    g = classify_swap_failure(RuntimeError(secret))
    body = g.to_message()
    assert secret not in body
    assert "pw@db-host" not in body


def test_fund_loss_flag_drives_alarm_emoji():
    g = classify_swap_failure("Insufficient gas for transaction fees")
    assert g.is_fund_loss is False
    assert "🔴" not in g.to_message()


def test_no_input_classifies_unknown():
    g = classify_swap_failure(None)
    assert g.category == CAT_UNKNOWN
    assert g.reference_id


def test_guidance_is_dataclass_with_required_fields():
    g = classify_swap_failure("Insufficient SOL balance. Have: 0, Need: 1", {"from_token": "SOL"})
    assert isinstance(g, ErrorGuidance)
    for field_name in (
        "category",
        "title",
        "explanation",
        "next_action",
        "action_payload",
        "is_fund_loss",
        "reference_id",
    ):
        assert hasattr(g, field_name)
