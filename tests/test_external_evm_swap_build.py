"""MONEY-PATH: external EVM builds approve Li.Fi's declared spender only."""

import os
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import bot.services.swap_engine as swap_module  # noqa: E402
from bot.config.chains import ChainType  # noqa: E402
from bot.services.swap_engine import SwapEngine, SwapError, SwapQuote  # noqa: E402

SENDER = "0x1111111111111111111111111111111111111111"
TOKEN = "0x2222222222222222222222222222222222222222"
TX_TARGET = "0x3333333333333333333333333333333333333333"
APPROVAL_TARGET = "0x4444444444444444444444444444444444444444"


def _quote(with_approval_target: bool = True) -> SwapQuote:
    estimate = {"approvalAddress": APPROVAL_TARGET} if with_approval_target else {}
    return SwapQuote(
        provider="lifi",
        from_chain="base",
        to_chain="base",
        from_token="USDC",
        to_token="ETH",
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount="1",
        to_amount_human=0.0003,
        to_amount_min="1",
        gas_cost_usd=0.0,
        fee_cost_usd=0.0,
        total_cost_usd=0.0,
        estimated_time=30,
        price_impact=0.0,
        exchange_rate=1.0,
        raw_quote={
            "transactionRequest": {
                "to": TX_TARGET,
                "data": "0x1234",
                "value": "0",
                "gasLimit": "21000",
            },
            "estimate": estimate,
        },
        timestamp=datetime.now(timezone.utc),
    )


def _engine(monkeypatch, quote: SwapQuote):
    engine = SwapEngine()
    engine._get_lifi_quote = AsyncMock(return_value=quote)
    engine._get_token_amount_raw = MagicMock(return_value=1_000_000)

    token_contract = MagicMock()
    token_contract.functions.allowance.return_value.call.return_value = 0
    token_contract.encode_abi.return_value = "0xapprove"
    web3 = MagicMock()
    web3.eth.contract.return_value = token_contract
    engine.wallet_service._get_web3 = MagicMock(return_value=web3)

    monkeypatch.setattr(
        swap_module,
        "get_chain_by_name",
        lambda _chain: SimpleNamespace(chain_type=ChainType.EVM, chain_id=8453),
    )
    monkeypatch.setattr(swap_module, "get_token_address", lambda _token, _chain: TOKEN)
    return engine, token_contract


async def test_external_build_uses_approval_address_not_transaction_target(monkeypatch):
    engine, token_contract = _engine(monkeypatch, _quote())

    _, payload = await engine.build_external_evm_swap(
        from_chain="base",
        to_chain="base",
        from_token="USDC",
        to_token="ETH",
        amount=1.0,
        from_address=SENDER,
        slippage=0.5,
    )

    assert payload["tx"]["to"].lower() == TX_TARGET.lower()
    assert payload["spender"].lower() == APPROVAL_TARGET.lower()
    allowance_args = token_contract.functions.allowance.call_args.args
    assert allowance_args[1].lower() == APPROVAL_TARGET.lower()
    approve_args = token_contract.encode_abi.call_args.kwargs["args"]
    assert approve_args[0].lower() == APPROVAL_TARGET.lower()


async def test_external_erc20_build_fails_closed_without_approval_address(monkeypatch):
    engine, _ = _engine(monkeypatch, _quote(with_approval_target=False))

    with pytest.raises(SwapError, match="approval target"):
        await engine.build_external_evm_swap(
            from_chain="base",
            to_chain="base",
            from_token="USDC",
            to_token="ETH",
            amount=1.0,
            from_address=SENDER,
            slippage=0.5,
        )
