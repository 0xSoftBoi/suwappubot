"""Regression test for the LayerZero/Stargate cross-chain decimals bug.

LayerZeroAPI.get_quote() computes amount_out/amount_out_min in SOURCE-chain
local decimals (Stargate's sendParam.amountLD/minAmountLD use the source
token's decimals). SwapEngine._get_layerzero_quote() must scale that raw
figure into DESTINATION decimals before converting to a human-readable
float — otherwise a bsc(18dp)->ethereum(6dp) USDT bridge displays/ranks as
~1e12x too large (10 USDT bsc->ethereum showing as ~9.95e12 USDT).

The fix must NOT touch the raw amount_out/amount_out_min strings that flow
into SwapQuote.to_amount/to_amount_min, because _execute_layerzero_swap ->
LayerZeroAPI.build_send_transaction feeds to_amount_min straight into the
on-chain minAmountLD calldata, which Stargate expects in SOURCE decimals.
"""

import os
from unittest.mock import AsyncMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")
os.environ.setdefault("SECRET_KEY", "test-secret")

import pytest  # noqa: E402

from bot.config.tokens import get_token_address, get_token_decimals  # noqa: E402
from bot.services.layerzero_api import LayerZeroAPI, LayerZeroQuote  # noqa: E402
from bot.services.swap_engine import SwapEngine  # noqa: E402

ADDR = "0x1111111111111111111111111111111111111111"

# USDT is 18dp on bsc, 6dp on ethereum (bot/config/tokens.py _PER_CHAIN_DECIMALS).
BSC_DECIMALS = get_token_decimals("USDT", "bsc")
ETH_DECIMALS = get_token_decimals("USDT", "ethereum")


def _bsc_to_eth_lz_quote(
    amount_in_human: float = 10.0, slippage_pct: float = 0.5
) -> LayerZeroQuote:
    """Build a LayerZeroQuote the way LayerZeroAPI.get_quote() does: the
    on-chain sendParam (and therefore amount_out/amount_out_min) is
    denominated in SOURCE (bsc, 18dp) decimals."""
    amount_in_raw = int(amount_in_human * (10**BSC_DECIMALS))
    min_amount = int(amount_in_raw * (1 - slippage_pct / 100))
    return LayerZeroQuote(
        src_chain="bsc",
        dst_chain="ethereum",
        token_symbol="USDT",
        amount_in=str(amount_in_raw),
        amount_out=str(min_amount),  # LayerZeroAPI's "conservative estimate"
        amount_out_min=str(min_amount),
        native_fee="1000000000000000",
        native_fee_usd=0.30,
        fee_trusted=True,
        estimated_time=120,
        pool_address="0x138EB30f73BC423c6455C53df6D89CB01d9eBc63",
        dst_eid=30101,
        raw_data={
            "send_param": {
                "dstEid": 30101,
                "to": ADDR,
                "amountLD": amount_in_raw,
                "minAmountLD": min_amount,
            },
            "native_fee": "1000000000000000",
        },
    )


@pytest.mark.asyncio
async def test_layerzero_quote_human_amount_scaled_to_destination_decimals():
    """bsc(18dp) -> ethereum(6dp) USDT: to_amount_human must be ~the input
    amount (9.95, after 0.5% slippage), never ~1e12x that."""
    engine = SwapEngine()
    lz_quote = _bsc_to_eth_lz_quote(amount_in_human=10.0, slippage_pct=0.5)

    engine.layerzero.get_quote = AsyncMock(return_value=lz_quote)

    swap_quote = await engine._get_layerzero_quote(
        from_chain="bsc",
        to_chain="ethereum",
        token="USDT",
        amount=10.0,
        amount_raw=lz_quote.amount_in,
        from_address=ADDR,
        slippage=0.5,
    )

    # Correct value: ~9.95 USDT, not ~9.95e12.
    assert swap_quote.to_amount_human == pytest.approx(9.95, rel=1e-6)
    assert swap_quote.to_amount_human < 100  # sanity bound, catches any 1e12x regression

    # The raw execution-facing fields must remain UNSCALED (source/bsc
    # decimals) — build_send_transaction needs these exact strings for
    # on-chain minAmountLD calldata.
    assert swap_quote.to_amount == lz_quote.amount_out
    assert swap_quote.to_amount_min == lz_quote.amount_out_min
    assert int(swap_quote.to_amount_min) == int(10 * (10**BSC_DECIMALS) * 0.995)


@pytest.mark.asyncio
async def test_layerzero_quote_same_decimals_route_unaffected():
    """A same-decimals route (e.g. USDC 6dp -> 6dp) must be unaffected by the
    scaling logic — human amount stays a straight decimals division."""
    engine = SwapEngine()

    src_decimals = get_token_decimals("USDC", "ethereum")
    dst_decimals = get_token_decimals("USDC", "arbitrum")
    assert src_decimals == dst_decimals == 6

    amount_in_raw = int(10.0 * (10**src_decimals))
    min_amount = int(amount_in_raw * 0.995)
    lz_quote = LayerZeroQuote(
        src_chain="ethereum",
        dst_chain="arbitrum",
        token_symbol="USDC",
        amount_in=str(amount_in_raw),
        amount_out=str(min_amount),
        amount_out_min=str(min_amount),
        native_fee="1000000000000000",
        native_fee_usd=1.0,
        fee_trusted=True,
        estimated_time=120,
        pool_address="0xc026395860Db2d07ee33e05fE50ed7bD583189C7",
        dst_eid=30110,
        raw_data={},
    )
    engine.layerzero.get_quote = AsyncMock(return_value=lz_quote)

    swap_quote = await engine._get_layerzero_quote(
        from_chain="ethereum",
        to_chain="arbitrum",
        token="USDC",
        amount=10.0,
        amount_raw=lz_quote.amount_in,
        from_address=ADDR,
        slippage=0.5,
    )

    assert swap_quote.to_amount_human == pytest.approx(9.95, rel=1e-6)
    assert swap_quote.to_amount == lz_quote.amount_out
    assert swap_quote.to_amount_min == lz_quote.amount_out_min


def test_build_send_transaction_uses_source_decimal_min_amount_unchanged():
    """Offline pattern: a provider-less Web3() with a mocked rpc_manager.
    build_send_transaction's encoded minAmountLD/amountLD must exactly match
    the SOURCE-decimal (bsc, 18dp) raw quote figures — completely unaffected
    by the destination-decimals display fix in swap_engine.py."""
    from unittest.mock import patch

    from eth_abi import decode
    from web3 import Web3

    lz_quote = _bsc_to_eth_lz_quote(amount_in_human=10.0, slippage_pct=0.5)
    provider_less_web3 = Web3()

    with patch(
        "bot.services.rpc_manager.rpc_manager.get_web3",
        return_value=provider_less_web3,
    ):
        api = LayerZeroAPI()
        tx_bundle = api.build_send_transaction(quote=lz_quote, sender_address=ADDR)

    send_data = tx_bundle["send_tx"]["data"]
    # sendToken's function selector is the first 4 bytes; decode the
    # _sendParam tuple that follows to check amountLD/minAmountLD.
    calldata = bytes.fromhex(send_data[2:] if send_data.startswith("0x") else send_data)
    selector, body = calldata[:4], calldata[4:]
    assert len(selector) == 4

    send_param_type = "(uint32,bytes32,uint256,uint256,bytes,bytes,bytes)"
    fee_type = "(uint256,uint256)"
    decoded = decode([send_param_type, fee_type, "address"], body)
    dst_eid, _to, amount_ld, min_amount_ld, _extra, _compose, _oft_cmd = decoded[0]

    # Both remain in SOURCE (bsc, 18dp) decimals — exactly the strings
    # LayerZeroQuote carried in, not the destination-decimals display value.
    assert amount_ld == int(lz_quote.amount_in)
    assert min_amount_ld == int(lz_quote.amount_out_min)
    assert dst_eid == lz_quote.dst_eid

    # Token address used for approval must be the SOURCE-chain (bsc) USDT.
    assert tx_bundle["approval_tx"]["to"].lower() == get_token_address("USDT", "bsc").lower()
