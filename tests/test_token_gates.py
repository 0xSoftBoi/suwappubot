"""Tests for the shared blacklist + compliance address gate (aegis-goal 2.2).

Covers:
  1. bot/services/token_security/address_gate.py — the shared check itself:
     blacklist hit, compliance hit, clean address, and the blacklist
     fail-open / compliance fail-closed failure policies.
  2. bot/handlers/paste_trade.py _render_token_card — blacklisted/sanctioned
     address renders with no Buy keyboard and no stashed paste_token; clean
     address is unaffected (unchanged behavior).
  3. bot/handlers/snipe.py receive_contract — a hit refuses to arm the snipe
     (stays in ENTER_CONTRACT, no token_mint stashed); clean address proceeds.
  4. bot/handlers/intel.py _gate_banner — a hit prepends a warning banner
     without blocking the report; a check_address_gate failure degrades to
     no banner (informational surface must never block on this).

All external services (blacklist_service, compliance_service, token_analyzer,
pump_fun/alchemy lookups) are mocked. No network.
"""

import os
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pytest  # noqa: E402

from bot.services.compliance import (  # noqa: E402
    ComplianceError,
    ComplianceResult,
    ComplianceMode,
    ScreeningPolicy,
)
from bot.services.token_security.address_gate import (  # noqa: E402
    AddressGateResult,
    check_address_gate,
)  # noqa: E402
from bot.services.token_security.blacklist_service import BlacklistCheckResult  # noqa: E402

ADDR_EVM = "0x1234567890123456789012345678901234567890"
ADDR_SOL = "So11111111111111111111111111111111111111112"


def _clean_result():
    return BlacklistCheckResult(is_blacklisted=False)


def _blacklisted_result(reason="rug_pull"):
    r = BlacklistCheckResult(is_blacklisted=True)
    r.reasons = [reason]
    return r


def _compliance_error(
    reason="Compliance check failed: token 0x1234…7890 (OFAC-sanctioned address)",
):
    result = ComplianceResult(
        allowed=False, mode=ComplianceMode.ENFORCE, policy=ScreeningPolicy.BLOCKLIST_ONLY
    )
    return ComplianceError(reason, result)


# ---------------------------------------------------------------------------
# 1. check_address_gate unit tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gate_clean_address_not_blocked(monkeypatch):
    from bot.services.token_security import address_gate

    monkeypatch.setattr(
        address_gate.blacklist_service, "check", AsyncMock(return_value=_clean_result())
    )
    monkeypatch.setattr(
        address_gate.compliance_service, "assert_compliant", MagicMock(return_value=None)
    )

    result = await check_address_gate(ADDR_EVM, chain="ethereum")
    assert result == AddressGateResult(blocked=False)


@pytest.mark.asyncio
async def test_gate_blacklisted_address_blocks(monkeypatch):
    from bot.services.token_security import address_gate

    monkeypatch.setattr(
        address_gate.blacklist_service,
        "check",
        AsyncMock(return_value=_blacklisted_result("rug_pull")),
    )
    monkeypatch.setattr(
        address_gate.compliance_service, "assert_compliant", MagicMock(return_value=None)
    )

    result = await check_address_gate(ADDR_SOL, chain="solana")
    assert result.blocked is True
    assert "Blacklisted" in result.reason
    assert "rug_pull" in result.reason


@pytest.mark.asyncio
async def test_gate_sanctioned_address_blocks(monkeypatch):
    from bot.services.token_security import address_gate

    monkeypatch.setattr(
        address_gate.blacklist_service, "check", AsyncMock(return_value=_clean_result())
    )
    monkeypatch.setattr(
        address_gate.compliance_service,
        "assert_compliant",
        MagicMock(side_effect=_compliance_error()),
    )

    result = await check_address_gate(ADDR_EVM, chain="ethereum")
    assert result.blocked is True
    assert "Sanctioned" in result.reason


@pytest.mark.asyncio
async def test_gate_blacklist_error_fails_open(monkeypatch):
    """The local blacklist store is fast/local -- an error there must not
    block address entry; it should log and continue to the compliance check.
    """
    from bot.services.token_security import address_gate

    monkeypatch.setattr(
        address_gate.blacklist_service,
        "check",
        AsyncMock(side_effect=RuntimeError("store unavailable")),
    )
    monkeypatch.setattr(
        address_gate.compliance_service, "assert_compliant", MagicMock(return_value=None)
    )

    result = await check_address_gate(ADDR_EVM, chain="ethereum")
    assert result.blocked is False


@pytest.mark.asyncio
async def test_gate_compliance_unexpected_error_propagates(monkeypatch):
    """Mirrors the swap-flow policy exactly: only ComplianceError (the
    deliberate block signal) is caught. Any other exception from
    assert_compliant must propagate, not be silently swallowed as fail-open,
    same as an unwrapped compliance_service call inside execute_swap would.
    """
    from bot.services.token_security import address_gate

    monkeypatch.setattr(
        address_gate.blacklist_service, "check", AsyncMock(return_value=_clean_result())
    )
    monkeypatch.setattr(
        address_gate.compliance_service,
        "assert_compliant",
        MagicMock(side_effect=RuntimeError("compliance service down")),
    )

    with pytest.raises(RuntimeError):
        await check_address_gate(ADDR_EVM, chain="ethereum")


# ---------------------------------------------------------------------------
# 2. paste_trade._render_token_card
# ---------------------------------------------------------------------------


def _make_update_and_context():
    update = MagicMock()
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    update.effective_user = MagicMock(id=42)
    context = MagicMock()
    context.user_data = {}
    return update, context


@pytest.mark.asyncio
async def test_paste_trade_blocked_address_no_buy_keyboard(monkeypatch):
    from bot.handlers import paste_trade

    monkeypatch.setattr(
        paste_trade,
        "get_token_info",
        AsyncMock(
            return_value={
                "chain": "ethereum",
                "address": ADDR_EVM,
                "symbol": "SCAM",
                "name": "Scam Token",
                "decimals": 18,
            }
        ),
    )
    monkeypatch.setattr(
        paste_trade,
        "check_address_gate",
        AsyncMock(return_value=AddressGateResult(blocked=True, reason="Blacklisted — rug_pull")),
    )

    update, context = _make_update_and_context()
    await paste_trade._render_token_card(update, context, ADDR_EVM, "evm")

    assert "paste_token" not in context.user_data
    update.message.reply_text.assert_awaited_once()
    args, kwargs = update.message.reply_text.call_args
    assert "BLOCKED" in args[0]
    assert kwargs.get("reply_markup") is None


@pytest.mark.asyncio
async def test_paste_trade_clean_address_shows_buy_keyboard(monkeypatch):
    from bot.handlers import paste_trade

    monkeypatch.setattr(
        paste_trade,
        "get_token_info",
        AsyncMock(
            return_value={
                "chain": "solana",
                "address": ADDR_SOL,
                "symbol": "GOOD",
                "name": "Good Token",
                "decimals": 9,
            }
        ),
    )
    monkeypatch.setattr(
        paste_trade.token_analyzer, "quick_check", AsyncMock(return_value=(True, []))
    )
    monkeypatch.setattr(
        paste_trade, "check_address_gate", AsyncMock(return_value=AddressGateResult(blocked=False))
    )

    update, context = _make_update_and_context()
    await paste_trade._render_token_card(update, context, ADDR_SOL, "solana")

    assert context.user_data["paste_token"]["address"] == ADDR_SOL
    update.message.reply_text.assert_awaited_once()
    args, kwargs = update.message.reply_text.call_args
    assert kwargs.get("reply_markup") is not None


@pytest.mark.asyncio
async def test_paste_trade_honeypot_still_blocks_before_gate_runs(monkeypatch):
    """Regression guard: the pre-existing Solana honeypot hard-block must
    still fire and must NOT be masked by the new gate check.
    """
    from bot.handlers import paste_trade

    monkeypatch.setattr(
        paste_trade,
        "get_token_info",
        AsyncMock(
            return_value={
                "chain": "solana",
                "address": ADDR_SOL,
                "symbol": "HP",
                "name": "Honeypot Token",
                "decimals": 9,
            }
        ),
    )
    monkeypatch.setattr(
        paste_trade.token_analyzer,
        "quick_check",
        AsyncMock(return_value=(False, ["Token appears to be a honeypot"])),
    )
    gate_mock = AsyncMock(return_value=AddressGateResult(blocked=False))
    monkeypatch.setattr(paste_trade, "check_address_gate", gate_mock)

    update, context = _make_update_and_context()
    await paste_trade._render_token_card(update, context, ADDR_SOL, "solana")

    assert "paste_token" not in context.user_data
    args, kwargs = update.message.reply_text.call_args
    assert "HONEYPOT DETECTED" in args[0]
    # Honeypot hard-block returns before the address gate is ever consulted.
    gate_mock.assert_not_awaited()


# ---------------------------------------------------------------------------
# 3. snipe.receive_contract
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_snipe_receive_contract_blocked_refuses_to_arm(monkeypatch):
    from bot.handlers import snipe

    monkeypatch.setattr(snipe, "is_solana_address", lambda addr: True)
    monkeypatch.setattr(
        snipe,
        "check_address_gate",
        AsyncMock(return_value=AddressGateResult(blocked=True, reason="Sanctioned — OFAC")),
    )
    show_amount_mock = AsyncMock()
    monkeypatch.setattr(snipe, "show_amount_selection", show_amount_mock)

    update = MagicMock()
    update.message = MagicMock(text=ADDR_SOL)
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.user_data = {"snipe": {}}

    result = await snipe.receive_contract(update, context)

    assert result == snipe.ENTER_CONTRACT
    assert "token_mint" not in context.user_data["snipe"]
    show_amount_mock.assert_not_awaited()
    args, kwargs = update.message.reply_text.call_args
    assert "Blocked" in args[0]


@pytest.mark.asyncio
async def test_snipe_receive_contract_clean_proceeds(monkeypatch):
    from bot.handlers import snipe

    monkeypatch.setattr(snipe, "is_solana_address", lambda addr: True)
    monkeypatch.setattr(
        snipe, "check_address_gate", AsyncMock(return_value=AddressGateResult(blocked=False))
    )
    show_amount_mock = AsyncMock(return_value=snipe.SELECT_AMOUNT)
    monkeypatch.setattr(snipe, "show_amount_selection", show_amount_mock)

    update = MagicMock()
    update.message = MagicMock(text=ADDR_SOL)
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.user_data = {"snipe": {}}

    result = await snipe.receive_contract(update, context)

    assert context.user_data["snipe"]["token_mint"] == ADDR_SOL
    show_amount_mock.assert_awaited_once_with(update, context, ADDR_SOL)
    assert result == snipe.SELECT_AMOUNT


# NOTE: the `/snipe <contract>` quick-path in snipe_command applies the same
# check_address_gate branch, but snipe_command is wrapped in @require_tier +
# @enforce_tos and reaches the gate only after wallet/tier/TOS setup — a
# faithful end-to-end test needs the full subscription+wallet fixture stack.
# The gate logic itself is a verbatim mirror of receive_contract's, covered by
# the three tests above; the quick-path wiring is covered by the parse/boot
# gate and a manual read. Flagged for a fixture-backed test if the money-path
# review wants belt-and-suspenders here.


@pytest.mark.asyncio
async def test_snipe_receive_contract_blacklist_error_fails_open(monkeypatch):
    """End-to-end through the real check_address_gate: a blacklist-store
    error must not block a legitimate snipe (fail-open), while compliance
    stays disabled by default (no-op) so the address proceeds.
    """
    from bot.handlers import snipe
    from bot.services.token_security import address_gate

    monkeypatch.setattr(snipe, "is_solana_address", lambda addr: True)
    monkeypatch.setattr(
        address_gate.blacklist_service,
        "check",
        AsyncMock(side_effect=RuntimeError("store down")),
    )
    show_amount_mock = AsyncMock(return_value=snipe.SELECT_AMOUNT)
    monkeypatch.setattr(snipe, "show_amount_selection", show_amount_mock)

    update = MagicMock()
    update.message = MagicMock(text=ADDR_SOL)
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.user_data = {"snipe": {}}

    result = await snipe.receive_contract(update, context)  # noqa: F841

    assert context.user_data["snipe"]["token_mint"] == ADDR_SOL
    show_amount_mock.assert_awaited_once()


# ---------------------------------------------------------------------------
# 4. intel._gate_banner
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_intel_gate_banner_blocked_shows_warning(monkeypatch):
    from bot.handlers import intel

    monkeypatch.setattr(
        intel,
        "check_address_gate",
        AsyncMock(return_value=AddressGateResult(blocked=True, reason="Blacklisted — rug_pull")),
    )
    banner = await intel._gate_banner(ADDR_EVM, "ethereum")
    assert "WARNING" in banner
    assert "Blacklisted" in banner


@pytest.mark.asyncio
async def test_intel_gate_banner_clean_is_empty(monkeypatch):
    from bot.handlers import intel

    monkeypatch.setattr(
        intel, "check_address_gate", AsyncMock(return_value=AddressGateResult(blocked=False))
    )
    banner = await intel._gate_banner(ADDR_EVM, "ethereum")
    assert banner == ""


@pytest.mark.asyncio
async def test_intel_gate_banner_error_degrades_to_no_banner(monkeypatch):
    """Informational surface: an unexpected error from check_address_gate
    (e.g. a compliance_service bug) must never block the /intel report --
    degrade to no banner instead of raising.
    """
    from bot.handlers import intel

    monkeypatch.setattr(
        intel, "check_address_gate", AsyncMock(side_effect=RuntimeError("compliance down"))
    )
    banner = await intel._gate_banner(ADDR_EVM, "ethereum")
    assert banner == ""
