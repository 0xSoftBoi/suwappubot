"""Tests for CCTP V1 -> V2 upgrade in bot/services/cctp_api.py.

All HTTP/RPC is mocked -- no live calls. Covers:
  - V2 depositForBurn arg encoding (7-arg signature)
  - Fast vs Standard minFinalityThreshold mapping
  - maxFee bound enforcement (refuses when unset/zero)
  - Solana build fails closed
  - Unsupported chain (Tron) rejected
  - V1 path still works
"""

import pytest

from bot.services.cctp_api import (
    CircleCCTPAPI,
    CCTPError,
    CCTPQuote,
    CCTPTransferMode,
    CCTP_V2_FINALITY_THRESHOLD,
    MESSAGE_TRANSMITTER_ADDRESSES,
    MESSAGE_TRANSMITTER_V2_ADDRESS,
    TOKEN_MESSENGER_V2_ADDRESS,
)
from bot.config.settings import settings


@pytest.fixture
def api():
    return CircleCCTPAPI()


@pytest.fixture(autouse=True)
def _reset_fast_fee_setting():
    """Ensure each test starts from the conservative default (no Fast fee cap)."""
    original = getattr(settings, "cctp_v2_max_fast_fee_bps", 0)
    original_mode = getattr(settings, "cctp_v2_default_mode", "standard")
    settings.cctp_v2_max_fast_fee_bps = 0
    settings.cctp_v2_default_mode = "standard"
    yield
    settings.cctp_v2_max_fast_fee_bps = original
    settings.cctp_v2_default_mode = original_mode


# ---------------------------------------------------------------------------
# Finality threshold mapping
# ---------------------------------------------------------------------------


def test_finality_threshold_mapping():
    assert CCTP_V2_FINALITY_THRESHOLD[CCTPTransferMode.FAST] == 1000
    assert CCTP_V2_FINALITY_THRESHOLD[CCTPTransferMode.STANDARD] == 2000


@pytest.mark.asyncio
async def test_get_quote_defaults_to_standard(api):
    quote = await api.get_quote("ethereum", "base", "1000000")
    assert quote.version == 2
    assert quote.mode == "standard"
    assert quote.min_finality_threshold == 2000
    assert quote.max_fee == 0


@pytest.mark.asyncio
async def test_get_quote_fast_mode_with_bounded_fee(api):
    settings.cctp_v2_max_fast_fee_bps = 5  # 5 bps
    quote = await api.get_quote("ethereum", "base", "1000000", mode=CCTPTransferMode.FAST)
    assert quote.mode == "fast"
    assert quote.min_finality_threshold == 1000
    # 1_000_000 * 5 // 10_000 = 500
    assert quote.max_fee == 500


@pytest.mark.asyncio
async def test_get_quote_fast_mode_refuses_without_bps_cap(api):
    # cctp_v2_max_fast_fee_bps left at 0 (default/unset) by fixture.
    with pytest.raises(CCTPError):
        await api.get_quote("ethereum", "base", "1000000", mode=CCTPTransferMode.FAST)


# ---------------------------------------------------------------------------
# V2 arg encoding
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_burn_transaction_v2_arg_encoding(api):
    settings.cctp_v2_max_fast_fee_bps = 10
    quote = await api.get_quote("ethereum", "base", "1000000", mode=CCTPTransferMode.FAST)
    tx = api.build_burn_transaction_v2(
        quote, from_address="0x1111111111111111111111111111111111111111"
    )
    assert tx["to"].lower() == TOKEN_MESSENGER_V2_ADDRESS.lower()
    assert tx["value"] == 0
    assert tx["data"].startswith("0x")
    # depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)
    # selector should be present and data long enough for 7 encoded args.
    assert len(tx["data"]) > 10 + 7 * 64 - 64  # rough sanity bound on calldata size


@pytest.mark.asyncio
async def test_build_burn_transaction_dispatches_to_v2_by_default(api):
    quote = await api.get_quote("ethereum", "base", "1000000")
    assert quote.version == 2
    tx = api.build_burn_transaction(
        quote, from_address="0x1111111111111111111111111111111111111111"
    )
    assert tx["to"].lower() == TOKEN_MESSENGER_V2_ADDRESS.lower()


# ---------------------------------------------------------------------------
# maxFee bound enforcement
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_burn_transaction_v2_refuses_fast_with_zero_max_fee(api):
    quote = await api.get_quote("ethereum", "base", "1000000")
    # Manually force a Fast-threshold quote with an unset maxFee to simulate a
    # caller bypassing get_quote's own refusal -- build must still fail closed.
    fast_no_fee = CCTPQuote(**{**quote.__dict__, "min_finality_threshold": 1000, "max_fee": None})
    with pytest.raises(CCTPError):
        api.build_burn_transaction_v2(
            fast_no_fee, from_address="0x1111111111111111111111111111111111111111"
        )


@pytest.mark.asyncio
async def test_build_burn_transaction_v2_refuses_fast_with_explicit_zero_fee(api):
    quote = await api.get_quote("ethereum", "base", "1000000")
    fast_zero_fee = CCTPQuote(**{**quote.__dict__, "min_finality_threshold": 1000, "max_fee": 0})
    with pytest.raises(CCTPError):
        api.build_burn_transaction_v2(
            fast_zero_fee, from_address="0x1111111111111111111111111111111111111111"
        )


@pytest.mark.asyncio
async def test_compute_bounded_max_fee_returns_none_when_unset(api):
    settings.cctp_v2_max_fast_fee_bps = 0
    assert api._compute_bounded_max_fee("1000000") is None


@pytest.mark.asyncio
async def test_compute_bounded_max_fee_bounds_correctly(api):
    settings.cctp_v2_max_fast_fee_bps = 25  # 25 bps
    fee = api._compute_bounded_max_fee("2000000")
    assert fee == (2_000_000 * 25) // 10_000


# ---------------------------------------------------------------------------
# Solana fails closed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_burn_transaction_v2_solana_destination_fails_closed(api):
    quote = await api.get_quote("ethereum", "base", "1000000")
    solana_quote = CCTPQuote(**{**quote.__dict__, "to_chain": "solana"})
    with pytest.raises(CCTPError):
        api.build_burn_transaction_v2(
            solana_quote, from_address="0x1111111111111111111111111111111111111111"
        )


def test_solana_not_in_supported_domains(api):
    # Solana is quote/domain metadata only -- never an executable EVM route.
    assert not api.is_supported_route("ethereum", "solana", "USDC")
    assert not api.is_supported_route("solana", "ethereum", "USDC")


# ---------------------------------------------------------------------------
# Unsupported chain (Tron) rejected
# ---------------------------------------------------------------------------


def test_tron_route_not_supported(api):
    assert not api.is_supported_route("ethereum", "tron", "USDC")
    assert not api.is_supported_route("tron", "ethereum", "USDC")


def test_tron_domain_lookup_raises(api):
    with pytest.raises(CCTPError):
        api.get_domain_id("tron")


@pytest.mark.asyncio
async def test_get_quote_rejects_tron_route(api):
    with pytest.raises(CCTPError):
        await api.get_quote("ethereum", "tron", "1000000")


# ---------------------------------------------------------------------------
# V1 path still works (kept intact and reachable)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_v1_quote_and_burn_tx_still_work(api):
    quote = await api.get_quote("ethereum", "base", "1000000", version=1)
    assert quote.version == 1
    assert quote.mode is None
    assert quote.max_fee is None

    tx = api.build_burn_transaction(
        quote, from_address="0x1111111111111111111111111111111111111111"
    )
    # V1 TokenMessenger address (ethereum), not the V2 shared address.
    assert tx["to"].lower() != TOKEN_MESSENGER_V2_ADDRESS.lower()
    assert tx["value"] == 0
    assert tx["data"].startswith("0x")


def test_v1_addresses_still_resolvable(api):
    assert api.get_token_messenger("ethereum", version=1) != TOKEN_MESSENGER_V2_ADDRESS
    assert api.get_token_messenger("ethereum", version=2) == TOKEN_MESSENGER_V2_ADDRESS


# ---------------------------------------------------------------------------
# HIGH 1: mint helper must resolve the V2 transmitter for a V2 burn
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_quote_v2_resolves_v2_message_transmitter(api):
    quote = await api.get_quote("ethereum", "base", "1000000")
    assert quote.version == 2
    assert quote.message_transmitter.lower() == MESSAGE_TRANSMITTER_V2_ADDRESS.lower()


def test_build_receive_transaction_uses_quote_message_transmitter(api):
    """Passing the CCTPQuote directly must use its (version-matched) address,
    never fall back to a version-1-defaulted lookup."""
    quote = CCTPQuote(
        from_chain="ethereum",
        to_chain="base",
        from_amount="1000000",
        to_amount="1000000",
        to_amount_human=1.0,
        gas_cost_usd=0.2,
        bridge_fee_usd=0.0,
        total_cost_usd=0.2,
        estimated_time=20,
        token_messenger=TOKEN_MESSENGER_V2_ADDRESS,
        message_transmitter=MESSAGE_TRANSMITTER_V2_ADDRESS,
        destination_domain=6,
        usdc_address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        raw_data={},
        version=2,
    )
    tx = api.build_receive_transaction("base", b"\x01" * 32, "0x" + "ab" * 65, quote=quote)
    assert tx["to"].lower() == MESSAGE_TRANSMITTER_V2_ADDRESS.lower()


def test_build_receive_transaction_v2_default_resolves_v2_without_quote(api):
    """Even without an explicit quote, get_quote's own default (v2) must be
    mirrored here instead of silently falling back to the v1 address."""
    tx = api.build_receive_transaction("base", b"\x01" * 32, "0x" + "ab" * 65)
    assert tx["to"].lower() == MESSAGE_TRANSMITTER_V2_ADDRESS.lower()


def test_build_receive_transaction_v1_explicit_version(api):
    tx = api.build_receive_transaction("base", b"\x01" * 32, "0x" + "ab" * 65, version=1)
    assert tx["to"].lower() == MESSAGE_TRANSMITTER_ADDRESSES["base"].lower()
    assert tx["to"].lower() != MESSAGE_TRANSMITTER_V2_ADDRESS.lower()


# ---------------------------------------------------------------------------
# HIGH 2: v1 attestation must fail loud on a v2 transfer, not poll forever
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_v1_get_attestation_raises_on_v2_version(api):
    with pytest.raises(CCTPError):
        await api.get_attestation("0xdeadbeef", version=2, max_attempts=1)


@pytest.mark.asyncio
async def test_v1_get_attestation_rejects_bad_version(api):
    with pytest.raises(CCTPError):
        await api.get_attestation("0xdeadbeef", version=3, max_attempts=1)


# ---------------------------------------------------------------------------
# MEDIUM 3: FAST quotes must discount to_amount by maxFee, not overstate it
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fast_quote_discounts_to_amount_by_max_fee(api):
    settings.cctp_v2_max_fast_fee_bps = 5  # 5 bps
    quote = await api.get_quote("ethereum", "base", "1000000", mode=CCTPTransferMode.FAST)
    assert quote.max_fee == 500  # 1_000_000 * 5 // 10_000
    assert quote.to_amount == "999500"
    assert quote.to_amount_human == pytest.approx(0.9995)
    assert quote.bridge_fee_usd == pytest.approx(0.0005)
    assert quote.total_cost_usd == pytest.approx(quote.gas_cost_usd + 0.0005)


@pytest.mark.asyncio
async def test_standard_quote_keeps_full_amount_and_zero_fee(api):
    quote = await api.get_quote("ethereum", "base", "1000000")
    assert quote.mode == "standard"
    assert quote.to_amount == "1000000"
    assert quote.bridge_fee_usd == 0.0


@pytest.mark.asyncio
async def test_fast_quote_to_amount_min_reflects_max_fee_via_swap_engine_mapping(api):
    """swap_engine._get_cctp_quote sets to_amount_min = quote.to_amount, so a
    discounted to_amount (this fix) automatically fixes an otherwise
    unsatisfiable min-received assertion downstream."""
    settings.cctp_v2_max_fast_fee_bps = 10
    quote = await api.get_quote("ethereum", "base", "5000000", mode=CCTPTransferMode.FAST)
    expected_min = str(5_000_000 - quote.max_fee)
    assert quote.to_amount == expected_min


# ---------------------------------------------------------------------------
# LOW 5: min_finality_threshold must be exactly 1000 or 2000
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_burn_transaction_v2_rejects_unsupported_finality_threshold(api):
    settings.cctp_v2_max_fast_fee_bps = 10
    quote = await api.get_quote("ethereum", "base", "1000000", mode=CCTPTransferMode.FAST)
    bad_quote = CCTPQuote(**{**quote.__dict__, "min_finality_threshold": 1500})
    with pytest.raises(CCTPError):
        api.build_burn_transaction_v2(
            bad_quote, from_address="0x1111111111111111111111111111111111111111"
        )
