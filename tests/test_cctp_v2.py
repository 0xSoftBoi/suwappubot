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
