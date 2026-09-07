"""MONEY-PATH tests for SwapEngine._execute_relay_swap.

Relay returns ready-to-sign steps. These tests pin the guarantees the executor
makes before signing anything:

- the fresh re-quote may not deliver below the minimum the user approved, and
  an approved minimum of zero is refused outright;
- every step must target the origin chain;
- an approve step must target the input token and approve at most the input;
- native value across steps must equal the input for native swaps and be zero
  for ERC-20 swaps;
- a reverted approve aborts before the deposit is sent;
- the deposit hash is returned as soon as it is broadcast (no receipt wait).
"""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from web3 import Web3

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.swap_engine import SwapEngine, SwapError, SwapQuote  # noqa: E402

SENDER = "0x1111111111111111111111111111111111111111"
BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
DEPOSITORY = "0x4cd00e387622c35bddb9b4c962c136462338bc31"
INPUT = 25_000_000  # 25 USDC

SIGNED_A = "0x" + "aa" * 110
SIGNED_B = "0x" + "bb" * 110


def _approve_calldata(spender: str, amount: int) -> str:
    return "0x095ea7b3" + spender[2:].lower().rjust(64, "0") + format(amount, "x").rjust(64, "0")


def _steps(approve_amount=INPUT, approve_to=BASE_USDC, deposit_value=0, chain_id=8453):
    return [
        {
            "step_id": "approve",
            "to": approve_to,
            "data": _approve_calldata(DEPOSITORY, approve_amount),
            "value": 0,
            "chainId": chain_id,
            "gas": 60000,
        },
        {
            "step_id": "deposit",
            "to": DEPOSITORY,
            "data": "0x49290c1c" + "00" * 64,
            "value": deposit_value,
            "chainId": chain_id,
            "gas": 75925,
        },
    ]


def _relay_quote(to_amount_min="24401618", steps=None):
    return SimpleNamespace(
        request_id="0xreq",
        to_amount_min=to_amount_min,
        to_amount_human=24.9,
        steps=_steps() if steps is None else steps,
    )


def _quote(to_amount_min="24401618", from_token="USDC", from_amount=str(INPUT), raw=None):
    return SwapQuote(
        provider="relay",
        from_chain="base",
        to_chain="arbitrum",
        from_token=from_token,
        to_token="USDC",
        from_amount=from_amount,
        from_amount_human=25.0,
        to_amount="24899610",
        to_amount_human=24.9,
        to_amount_min=to_amount_min,
        gas_cost_usd=0.001,
        fee_cost_usd=0.1,
        total_cost_usd=0.001,
        estimated_time=1,
        price_impact=0.4,
        exchange_rate=0.996,
        raw_quote=raw if raw is not None else {"recipient": SENDER, "slippage_bps": 50},
    )


def _engine(relay_quote, receipt_status=1, balance_wei=10**18):
    engine = SwapEngine()
    engine._get_wallet_for_signing = AsyncMock(
        return_value=SimpleNamespace(is_turnkey_wallet=False)
    )
    engine.relay = SimpleNamespace(get_quote=AsyncMock(return_value=relay_quote))
    engine.wallet_service = SimpleNamespace(
        sign_evm_transaction=AsyncMock(side_effect=[SIGNED_A, SIGNED_B, SIGNED_A, SIGNED_B])
    )
    web3 = MagicMock()
    web3.eth.get_transaction_count.return_value = 7
    web3.eth.gas_price = 1_000_000
    web3.eth.get_balance.return_value = balance_wei
    web3.eth.estimate_gas.return_value = 100_000
    web3.eth.wait_for_transaction_receipt.return_value = {"status": receipt_status}
    web3.eth.send_raw_transaction.side_effect = lambda raw: Web3.keccak(raw)
    return engine, web3


async def _run(engine, web3, quote):
    with patch("bot.services.swap_engine.rpc_manager") as rpc:
        rpc.get_web3.return_value = web3
        return await engine._execute_relay_swap(quote, {"user_id": 1, "address": SENDER})


@pytest.mark.asyncio
async def test_happy_path_signs_approve_then_deposit_and_returns_deposit_hash():
    engine, web3 = _engine(_relay_quote())
    tx_hash = await _run(engine, web3, _quote())

    sent = [c.args[0] for c in web3.eth.send_raw_transaction.call_args_list]
    assert sent == [bytes.fromhex(SIGNED_A[2:]), bytes.fromhex(SIGNED_B[2:])]
    assert tx_hash == Web3.keccak(bytes.fromhex(SIGNED_B[2:])).hex()
    # Approve waited for a receipt; the final deposit did not.
    assert web3.eth.wait_for_transaction_receipt.call_count == 1

    signed = [c.args[1] for c in engine.wallet_service.sign_evm_transaction.call_args_list]
    assert signed[0]["to"].lower() == BASE_USDC.lower()
    assert signed[1]["to"].lower() == DEPOSITORY.lower()
    assert all(tx["chainId"] == 8453 for tx in signed)
    assert signed[1]["gas"] == int(75925 * 1.25)

    # Re-quoted with the slippage the user accepted, for the same recipient.
    kwargs = engine.relay.get_quote.call_args.kwargs
    assert kwargs["slippage_bps"] == 50
    assert kwargs["to_address"] == SENDER


@pytest.mark.asyncio
async def test_fresh_min_below_approved_min_is_refused():
    engine, web3 = _engine(_relay_quote(to_amount_min="24000000"))
    with pytest.raises(SwapError):
        await _run(engine, web3, _quote(to_amount_min="24401618"))
    web3.eth.send_raw_transaction.assert_not_called()


@pytest.mark.asyncio
async def test_zero_approved_min_is_refused_not_bypassed():
    """A rehydrated quote without to_amount_min must not run unprotected."""
    engine, web3 = _engine(_relay_quote())
    with pytest.raises(SwapError):
        await _run(engine, web3, _quote(to_amount_min="0"))
    web3.eth.send_raw_transaction.assert_not_called()


@pytest.mark.asyncio
async def test_unparseable_min_fails_closed():
    engine, web3 = _engine(_relay_quote(to_amount_min="None"))
    with pytest.raises(SwapError):
        await _run(engine, web3, _quote())
    web3.eth.send_raw_transaction.assert_not_called()


@pytest.mark.asyncio
async def test_step_on_wrong_chain_is_refused():
    engine, web3 = _engine(_relay_quote(steps=_steps(chain_id=42161)))
    with pytest.raises(SwapError, match="targets chain"):
        await _run(engine, web3, _quote())
    web3.eth.send_raw_transaction.assert_not_called()


@pytest.mark.asyncio
async def test_approve_to_wrong_token_is_refused():
    engine, web3 = _engine(_relay_quote(steps=_steps(approve_to=DEPOSITORY)))
    with pytest.raises(SwapError, match="approve targets"):
        await _run(engine, web3, _quote())
    web3.eth.send_raw_transaction.assert_not_called()


@pytest.mark.asyncio
async def test_unlimited_approval_is_refused():
    engine, web3 = _engine(_relay_quote(steps=_steps(approve_amount=2**256 - 1)))
    with pytest.raises(SwapError, match="approve amount"):
        await _run(engine, web3, _quote())
    web3.eth.send_raw_transaction.assert_not_called()


@pytest.mark.asyncio
async def test_erc20_deposit_with_native_value_is_refused():
    engine, web3 = _engine(_relay_quote(steps=_steps(deposit_value=10**18)))
    with pytest.raises(SwapError, match="carries native value"):
        await _run(engine, web3, _quote())
    web3.eth.send_raw_transaction.assert_not_called()


@pytest.mark.asyncio
async def test_native_deposit_value_must_equal_input():
    eth_in = 10**16
    good = [
        {
            "step_id": "deposit",
            "to": DEPOSITORY,
            "data": "0x49290c1c" + "00" * 64,
            "value": eth_in,
            "chainId": 8453,
            "gas": 32432,
        }
    ]
    engine, web3 = _engine(_relay_quote(steps=good))
    tx_hash = await _run(engine, web3, _quote(from_token="ETH", from_amount=str(eth_in)))
    assert tx_hash
    signed = engine.wallet_service.sign_evm_transaction.call_args.args[1]
    assert signed["value"] == eth_in

    bad = [dict(good[0], value=eth_in * 3)]
    engine, web3 = _engine(_relay_quote(steps=bad))
    with pytest.raises(SwapError, match="deposit value"):
        await _run(engine, web3, _quote(from_token="ETH", from_amount=str(eth_in)))
    web3.eth.send_raw_transaction.assert_not_called()


@pytest.mark.asyncio
async def test_reverted_approve_aborts_before_deposit():
    engine, web3 = _engine(_relay_quote(), receipt_status=0)
    with pytest.raises(SwapError, match="reverted"):
        await _run(engine, web3, _quote())
    assert web3.eth.send_raw_transaction.call_count == 1  # approve only


@pytest.mark.asyncio
async def test_insufficient_native_for_gas_is_refused_before_signing():
    engine, web3 = _engine(_relay_quote(), balance_wei=0)
    with pytest.raises(SwapError, match="Insufficient"):
        await _run(engine, web3, _quote())
    engine.wallet_service.sign_evm_transaction.assert_not_called()


@pytest.mark.asyncio
async def test_deposit_target_change_since_quote_is_refused():
    raw = {
        "recipient": SENDER,
        "slippage_bps": 50,
        "steps": [{"step_id": "deposit", "to": "0x" + "9" * 40}],
    }
    engine, web3 = _engine(_relay_quote())
    with pytest.raises(SwapError, match="deposit target changed"):
        await _run(engine, web3, _quote(raw=raw))
    web3.eth.send_raw_transaction.assert_not_called()


@pytest.mark.asyncio
async def test_missing_slippage_falls_back_to_our_default_not_relays():
    engine, web3 = _engine(_relay_quote())
    await _run(engine, web3, _quote(raw={}))
    kwargs = engine.relay.get_quote.call_args.kwargs
    assert kwargs["slippage_bps"] == 50  # settings.default_slippage 0.5% -> 50 bps
