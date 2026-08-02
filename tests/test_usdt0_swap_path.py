"""USDT0 end-to-end wiring in swap_engine: quote adapter + executor.

USDT0 addresses were verified on-chain (scripts/verify_onchain_constants.py),
but until now nothing connected a USDT0 BridgeQuote to execute_swap — the
provider was reachable only through router.py's RouteOption, which has no
consumers. These tests cover the two halves that make it a real rail:

* `_get_usdt0_quote` — BridgeQuote -> SwapQuote, including the percent->bps
  slippage unit change and carrying the execution calldata forward so
  execution never re-quotes.
* `_execute_usdt0_swap` — honours the per-chain approve asymmetry that was
  verified via `approvalRequired()`: satellites are native mint/burn OFTs and
  need NO approve, Ethereum is a lockbox that requires one.
"""

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from web3 import Web3

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.bridge.base import BridgeQuote
from bot.services.swap_engine import SwapEngine, SwapError, SwapQuote

SENDER = "0x1111111111111111111111111111111111111111"
OFT = "0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92"
TOKEN = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"

SIGNED_APPROVE = "0x" + "aa" * 110
SIGNED_SEND = "0x" + "bb" * 110
APPROVE_BYTES = bytes.fromhex(SIGNED_APPROVE[2:])
SEND_BYTES = bytes.fromhex(SIGNED_SEND[2:])


def _bridge_quote(approval_tx=None, native_fee=1_000_000_000_000_000):
    tx = {"to": OFT, "data": "0xdeadbeef", "value": native_fee}
    if approval_tx:
        tx["approval_tx"] = {"to": TOKEN, "data": "0x095ea7b3", "value": 0}
    return BridgeQuote(
        provider="usdt0",
        from_chain="arbitrum",
        to_chain="plasma",
        from_token="USDT",
        to_token="USDT",
        from_amount="1000000",
        to_amount="1000000",
        to_amount_min="995000",
        gas_cost_usd=2.5,
        fee_cost_usd=0.0,
        estimated_time=120,
        transaction_request=tx,
        raw_response={"eid_src": 30110, "eid_dst": 30383, "native_fee": str(native_fee)},
        settlement="tx",
        trust_model="liquidity",
    )


def _engine():
    engine = SwapEngine.__new__(SwapEngine)
    engine._get_token_amount_human = MagicMock(return_value=1.0)
    return engine


# --- quote adapter ---------------------------------------------------------


def test_slippage_is_converted_percent_to_bps():
    """swap_engine speaks percent, BridgeProvider speaks bps."""
    engine = _engine()
    captured = {}

    async def _fake_get_quote(**kwargs):
        captured.update(kwargs)
        return _bridge_quote()

    with patch("bot.services.swap_engine.usdt0_api.get_quote", _fake_get_quote):
        asyncio.run(
            engine._get_usdt0_quote(
                "arbitrum", "plasma", "USDT", 1.0, "1000000", SENDER, slippage=0.5
            )
        )

    assert captured["slippage_bps"] == 50, "0.5% must become 50 bps"


def test_sub_one_percent_slippage_never_truncates_to_zero():
    """int() would floor 0.5 -> 0 bps and the provider rejects 0."""
    engine = _engine()
    captured = {}

    async def _fake_get_quote(**kwargs):
        captured.update(kwargs)
        return _bridge_quote()

    with patch("bot.services.swap_engine.usdt0_api.get_quote", _fake_get_quote):
        asyncio.run(
            engine._get_usdt0_quote(
                "arbitrum", "plasma", "USDT", 1.0, "1000000", SENDER, slippage=0.001
            )
        )

    assert captured["slippage_bps"] >= 1


def test_quote_carries_execution_calldata_forward():
    """Execution must not re-quote — a fresh quoteSend could return a
    different fee or minAmountLD than the user agreed to."""
    engine = _engine()

    with patch(
        "bot.services.swap_engine.usdt0_api.get_quote",
        AsyncMock(return_value=_bridge_quote()),
    ):
        quote = asyncio.run(
            engine._get_usdt0_quote(
                "arbitrum", "plasma", "USDT", 1.0, "1000000", SENDER, slippage=0.5
            )
        )

    assert quote.provider == "usdt0"
    assert quote.raw_quote["send_to"] == OFT
    assert quote.raw_quote["send_data"] == "0xdeadbeef"
    assert quote.raw_quote["send_value"] == 1_000_000_000_000_000
    # 1:1 rail — output never above input.
    assert int(quote.to_amount) <= int(quote.from_amount)
    assert int(quote.to_amount_min) <= int(quote.to_amount)
    # The LayerZero fee must surface in the cost so ranking is honest.
    assert quote.total_cost_usd > 0


def test_provider_returning_none_raises_so_the_race_logs_it():
    """get_quote() filters on isinstance(r, SwapQuote), so a None would be
    dropped silently rather than logged."""
    engine = _engine()

    with patch("bot.services.swap_engine.usdt0_api.get_quote", AsyncMock(return_value=None)):
        with pytest.raises(SwapError, match="USDT0 could not quote"):
            asyncio.run(
                engine._get_usdt0_quote(
                    "arbitrum", "plasma", "USDT", 1.0, "1000000", SENDER, slippage=0.5
                )
            )


# --- executor -------------------------------------------------------------


def _exec_engine(events):
    engine = SwapEngine.__new__(SwapEngine)
    engine._get_wallet_for_signing = AsyncMock(
        return_value=SimpleNamespace(is_turnkey_wallet=False)
    )

    web3 = MagicMock()
    web3.eth.get_transaction_count.return_value = 7
    web3.eth.gas_price = 1_000_000_000
    web3.eth.estimate_gas.return_value = 200_000
    web3.eth.wait_for_transaction_receipt.return_value = {"status": 1, "blockNumber": 1}

    def _send(raw):
        if raw == SEND_BYTES:
            events.append("send")
            return Web3.keccak(SEND_BYTES)
        events.append("approve")
        return Web3.keccak(APPROVE_BYTES)

    web3.eth.send_raw_transaction.side_effect = _send

    signed = []

    async def _sign(wallet, tx):
        signed.append(tx)
        # Approve is the only tx with value 0 and a token `to`.
        return SIGNED_APPROVE if tx["to"].lower() == TOKEN.lower() else SIGNED_SEND

    engine.wallet_service = SimpleNamespace(sign_evm_transaction=AsyncMock(side_effect=_sign))
    engine._get_web3_with_fallback = MagicMock(return_value=web3)
    return engine, web3, signed


def _swap_quote(raw):
    return SwapQuote(
        provider="usdt0",
        from_chain="arbitrum",
        to_chain="plasma",
        from_token="USDT",
        to_token="USDT",
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1000000",
        to_amount_human=1.0,
        to_amount_min="995000",
        gas_cost_usd=2.5,
        fee_cost_usd=0.0,
        total_cost_usd=2.5,
        estimated_time=120,
        price_impact=0.0,
        exchange_rate=1.0,
        raw_quote=raw,
    )


def _raw(approval=None, value=1_000_000_000_000_000):
    raw = {"send_to": OFT, "send_data": "0xdeadbeef", "send_value": value, "eid_dst": 30383}
    raw["approval_tx"] = approval
    return raw


def test_no_approve_on_a_satellite_chain():
    """approvalRequired()==0 on satellites: a spurious approve wastes gas."""
    events: list[str] = []
    engine, web3, signed = _exec_engine(events)

    with patch(
        "bot.services.swap_engine.get_chain_by_name",
        MagicMock(return_value=SimpleNamespace(chain_id=42161, native_token="ETH")),
    ):
        asyncio.run(engine._execute_usdt0_swap(_swap_quote(_raw()), {"address": SENDER}))

    assert events == ["send"], events
    assert len(signed) == 1


def test_approve_then_send_on_the_ethereum_lockbox():
    """approvalRequired()==1 on Ethereum: omitting the approve reverts."""
    events: list[str] = []
    engine, web3, signed = _exec_engine(events)
    approval = {"to": TOKEN, "data": "0x095ea7b3", "value": 0}

    with patch(
        "bot.services.swap_engine.get_chain_by_name",
        MagicMock(return_value=SimpleNamespace(chain_id=1, native_token="ETH")),
    ):
        asyncio.run(
            engine._execute_usdt0_swap(_swap_quote(_raw(approval=approval)), {"address": SENDER})
        )

    assert events == ["approve", "send"], events
    # Nonce must advance between the two.
    assert signed[0]["nonce"] == 7
    assert signed[1]["nonce"] == 8


def test_failed_approval_aborts_before_send():
    events: list[str] = []
    engine, web3, _ = _exec_engine(events)
    web3.eth.wait_for_transaction_receipt.return_value = {"status": 0}
    approval = {"to": TOKEN, "data": "0x095ea7b3", "value": 0}

    with patch(
        "bot.services.swap_engine.get_chain_by_name",
        MagicMock(return_value=SimpleNamespace(chain_id=1, native_token="ETH")),
    ):
        with pytest.raises(SwapError, match="approval failed"):
            asyncio.run(
                engine._execute_usdt0_swap(
                    _swap_quote(_raw(approval=approval)), {"address": SENDER}
                )
            )

    assert "send" not in events


def test_native_fee_is_attached_as_tx_value():
    """The LayerZero messaging fee is paid as `value`; under-paying it means
    the message is never delivered and the transfer strands mid-flight."""
    events: list[str] = []
    engine, web3, signed = _exec_engine(events)

    with patch(
        "bot.services.swap_engine.get_chain_by_name",
        MagicMock(return_value=SimpleNamespace(chain_id=42161, native_token="ETH")),
    ):
        asyncio.run(engine._execute_usdt0_swap(_swap_quote(_raw()), {"address": SENDER}))

    assert signed[0]["value"] == 1_000_000_000_000_000


@pytest.mark.parametrize(
    "raw",
    [
        {"send_data": "0x", "send_value": 1},  # no send_to
        {"send_to": OFT, "send_value": 1},  # no send_data
        {"send_to": OFT, "send_data": "0x"},  # no send_value
    ],
)
def test_missing_execution_data_fails_closed(raw):
    """Never substitute a default — a zero/absent fee strands the transfer."""
    events: list[str] = []
    engine, _, _ = _exec_engine(events)

    with patch(
        "bot.services.swap_engine.get_chain_by_name",
        MagicMock(return_value=SimpleNamespace(chain_id=42161, native_token="ETH")),
    ):
        with pytest.raises(SwapError, match="missing execution data"):
            asyncio.run(engine._execute_usdt0_swap(_swap_quote(raw), {"address": SENDER}))

    assert events == []
