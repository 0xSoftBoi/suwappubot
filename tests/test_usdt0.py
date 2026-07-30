"""Focused tests for the real USDT0 (LayerZero-OFT) implementation.

All RPC calls are mocked — no network. See tests/test_bridge_providers.py
for the broader bridge-provider suite (route gating, disabled-by-default,
Tron rejection, etc.) that also covers this provider.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from web3 import Web3

from bot.services.bridge.usdt0_api import (
    ERC20_APPROVE_ABI,
    NATIVE_FEE_BUFFER_BPS,
    NATIVE_FEE_CEILING_NATIVE_UNITS,
    OFT_ABI,
    OFT_ADDRESSES,
    USDT0Bridge,
)

ADDR = "0x1111111111111111111111111111111111111111"
RECIPIENT = "0x2222222222222222222222222222222222222222"


def _buffered(native_fee: int) -> int:
    return (native_fee * (10_000 + NATIVE_FEE_BUFFER_BPS)) // 10_000


def _mock_web3(native_fee=12345):
    """A MagicMock Web3 whose eth.contract(...).functions.quoteSend(...).call()
    returns a fixed (nativeFee, lzTokenFee) tuple, and whose encode_abi always
    succeeds — enough to exercise get_quote's full happy path."""
    mock_contract = MagicMock()
    mock_contract.functions.quoteSend.return_value.call.return_value = (native_fee, 0)
    mock_contract.encode_abi.return_value = "0xdeadbeef"

    mock_web3 = MagicMock()
    mock_web3.eth.contract.return_value = mock_contract
    mock_web3.from_wei = lambda wei, unit: Web3.from_wei(wei, unit)
    return mock_web3, mock_contract


def _mock_price_service(native_price=3000.0):
    return patch(
        "bot.services.price_service.price_service.get_prices",
        AsyncMock(return_value={"ETH": native_price}),
    )


@pytest.mark.asyncio
async def test_bytes32_recipient_padding_is_correct():
    """Classic fund-losing bug: `to` must be the recipient right-aligned
    (left-padded with zero bytes) in the 32-byte field, not left-aligned."""
    mock_web3, mock_contract = _mock_web3()

    with (
        _mock_price_service(),
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()
        quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="plasma",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
            to_address=RECIPIENT,
        )

    assert quote is not None
    send_param_call = mock_contract.functions.quoteSend.call_args
    send_param = send_param_call[0][0]
    to_bytes32 = send_param[1]

    assert len(to_bytes32) == 32
    # First 12 bytes are zero padding, last 20 bytes are the recipient.
    assert to_bytes32[:12] == b"\x00" * 12
    assert to_bytes32[12:] == Web3.to_bytes(hexstr=RECIPIENT)
    assert Web3.to_checksum_address(to_bytes32[-20:].hex()) == Web3.to_checksum_address(RECIPIENT)


@pytest.mark.asyncio
async def test_approve_emitted_only_for_ethereum_lockbox():
    """approvalRequired() == True only on Ethereum (lockbox); satellite
    chains use native OFT mint/burn and must NOT get an approve_tx."""
    mock_web3, _ = _mock_web3()

    with (
        _mock_price_service(),
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()

        satellite_quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="plasma",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
        )
        assert satellite_quote is not None
        assert "approval_tx" not in satellite_quote.transaction_request

        ethereum_quote = await provider.get_quote(
            from_chain="ethereum",
            to_chain="arbitrum",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
        )
        assert ethereum_quote is not None
        assert "approval_tx" in ethereum_quote.transaction_request
        approve_tx = ethereum_quote.transaction_request["approval_tx"]
        assert approve_tx["to"] == Web3.to_checksum_address(OFT_ADDRESSES["ethereum"]["token"])
        assert approve_tx["value"] == 0


@pytest.mark.asyncio
async def test_quote_send_failure_returns_none():
    """If quoteSend() reverts/errors, fail closed — never guess a fee."""
    mock_contract = MagicMock()
    mock_contract.functions.quoteSend.return_value.call.side_effect = Exception("revert")
    mock_web3 = MagicMock()
    mock_web3.eth.contract.return_value = mock_contract

    with (
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()
        quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="plasma",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
        )
    assert quote is None


@pytest.mark.asyncio
async def test_tron_rejected_even_when_enabled():
    mock_web3, _ = _mock_web3()
    with (
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()
        quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="tron",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
        )
    assert quote is None


@pytest.mark.asyncio
async def test_unconfigured_chain_returns_none():
    mock_web3, _ = _mock_web3()
    with (
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()
        quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="polygon",  # not on USDT0
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
        )
    assert quote is None


@pytest.mark.asyncio
async def test_min_amount_ld_floor_never_exceeds_amount():
    mock_web3, _ = _mock_web3()
    with (
        _mock_price_service(),
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()
        quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="plasma",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
            slippage_bps=50,  # 0.5%
        )
    assert quote is not None
    assert int(quote.to_amount_min) <= int(quote.from_amount)
    # 50 bps of 1_000_000 = 5_000 -> floor should be exactly 995_000.
    assert int(quote.to_amount_min) == 995_000


@pytest.mark.asyncio
async def test_output_never_better_than_input_1to1():
    mock_web3, _ = _mock_web3()
    with (
        _mock_price_service(),
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()
        quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="plasma",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
        )
    assert quote is not None
    assert int(quote.to_amount) == int(quote.from_amount)
    assert int(quote.to_amount) <= int(quote.from_amount)


@pytest.mark.asyncio
async def test_eid_resolved_correctly_per_chain():
    mock_web3, mock_contract = _mock_web3()
    with (
        _mock_price_service(),
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()
        quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="berachain",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
        )
    assert quote is not None
    send_param = mock_contract.functions.quoteSend.call_args[0][0]
    dst_eid = send_param[0]
    assert dst_eid == OFT_ADDRESSES["berachain"]["eid"] == 30362


@pytest.mark.asyncio
async def test_native_fee_used_as_transaction_value():
    """The tx value must be the BUFFERED fee (M4), not the raw quoteSend
    figure — a 15-20% headroom protects against gas moving between quote
    and signature; surplus is refunded by LayerZero automatically."""
    mock_web3, _ = _mock_web3(native_fee=987654321)
    with (
        _mock_price_service(),
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()
        quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="plasma",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
        )
    assert quote is not None
    expected = _buffered(987654321)
    assert expected > 987654321  # buffer actually adds headroom
    assert quote.transaction_request["value"] == expected
    # raw (unbuffered) fee is still surfaced for observability/debugging.
    assert quote.raw_response["native_fee"] == "987654321"
    assert quote.raw_response["native_fee_buffered"] == str(expected)


@pytest.mark.asyncio
async def test_gas_cost_usd_is_nonzero_and_ranks_honestly():
    """M3: gas_cost_usd must reflect the real native_fee charged as `value`
    -- router.py's net_output_usd subtracts (gas_cost_usd + fee_cost_usd), so
    a hardcoded 0.0 made USDT0 falsely look free."""
    native_fee = 10**16  # 0.01 ETH
    mock_web3, _ = _mock_web3(native_fee=native_fee)
    with (
        _mock_price_service(native_price=3000.0),
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()
        quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="plasma",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
        )
    assert quote is not None
    assert quote.gas_cost_usd > 0.0
    buffered_native = _buffered(native_fee) / 1e18
    assert quote.gas_cost_usd == pytest.approx(buffered_native * 3000.0, rel=1e-6)


@pytest.mark.asyncio
async def test_price_service_failure_still_returns_quote_with_zero_gas_cost():
    """A price-service hiccup must never block the quote itself -- only the
    USD display degrades (fails closed to 0.0), the on-chain `value` is
    unaffected."""
    mock_web3, _ = _mock_web3(native_fee=10**16)
    with (
        patch(
            "bot.services.price_service.price_service.get_prices",
            AsyncMock(side_effect=Exception("coingecko down")),
        ),
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()
        quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="plasma",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
        )
    assert quote is not None
    assert quote.gas_cost_usd == 0.0
    assert quote.transaction_request["value"] == _buffered(10**16)  # value unaffected


@pytest.mark.asyncio
async def test_absurd_native_fee_rejected_by_ceiling():
    """M4: an absurd/compromised-OFT quote (way above real LayerZero fees)
    must be rejected outright, not attached as `value` unbounded."""
    absurd_fee_wei = Web3.to_wei(NATIVE_FEE_CEILING_NATIVE_UNITS * 10, "ether")
    mock_web3, _ = _mock_web3(native_fee=absurd_fee_wei)
    with (
        _mock_price_service(),
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()
        quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="plasma",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
        )
    assert quote is None


@pytest.mark.asyncio
async def test_fee_just_under_ceiling_after_buffer_still_accepted():
    # Pick a raw fee such that the BUFFERED value still lands under the ceiling.
    raw_fee_wei = Web3.to_wei(NATIVE_FEE_CEILING_NATIVE_UNITS * 0.5, "ether")
    mock_web3, _ = _mock_web3(native_fee=raw_fee_wei)
    with (
        _mock_price_service(),
        patch("bot.services.bridge.usdt0_api.USDT0_BRIDGE_ENABLED", True),
        patch("bot.services.rpc_manager.rpc_manager.get_web3", return_value=mock_web3),
    ):
        provider = USDT0Bridge()
        quote = await provider.get_quote(
            from_chain="arbitrum",
            to_chain="plasma",
            from_token="USDT",
            from_amount="1000000",
            from_address=ADDR,
        )
    assert quote is not None
    assert quote.transaction_request["value"] == _buffered(raw_fee_wei)


def test_oft_addresses_all_have_required_fields():
    for chain, cfg in OFT_ADDRESSES.items():
        assert "token" in cfg and cfg["token"].startswith("0x")
        assert "oft" in cfg and cfg["oft"].startswith("0x")
        assert isinstance(cfg["eid"], int) and cfg["eid"] > 0
        assert cfg["decimals"] == 6
        assert isinstance(cfg["approval_required"], bool)

    # Verified asymmetry: only ethereum requires an approve.
    assert OFT_ADDRESSES["ethereum"]["approval_required"] is True
    for chain in ("arbitrum", "plasma", "hyperevm", "ink", "unichain", "berachain", "flare"):
        assert OFT_ADDRESSES[chain]["approval_required"] is False


def test_oft_abi_targets_correct_functions():
    fn_names = {fn["name"] for fn in OFT_ABI}
    assert fn_names == {"quoteSend", "send"}


def test_erc20_approve_abi_shape():
    assert ERC20_APPROVE_ABI[0]["name"] == "approve"
