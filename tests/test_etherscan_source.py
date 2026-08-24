"""Etherscan HyperEVM fallback — UNVERIFIED against a live key (see the module
docstring). These tests prove the module is safe by construction: absent a
key or given a shape that does not match what it expects, it returns None
rather than fabricating a number. They do not and cannot prove the assumed
field names (TokenHolderAddress/TokenHolderQuantity) are correct — that needs
one real key and one real call before this can be trusted."""

from unittest.mock import AsyncMock, patch

import pytest

from bot.services.token_intel.etherscan_source import (
    BURN_ADDRESSES,
    ETHERSCAN_CHAIN_IDS,
    fetch_holder_concentration,
)

TOKEN = "0xb75d5ee14708e7efbea939311090061d72265608"


@pytest.mark.asyncio
async def test_no_key_returns_none_without_making_a_request():
    with patch("bot.services.token_intel.etherscan_source._get_json", new=AsyncMock()) as m:
        r = await fetch_holder_concentration("hyperevm", TOKEN, None)
        assert r is None
        m.assert_not_awaited()


@pytest.mark.asyncio
async def test_an_uncovered_chain_returns_none():
    # base is GoPlus's job; this module claims only hyperevm today.
    r = await fetch_holder_concentration("base", TOKEN, "some-key")
    assert r is None


@pytest.mark.asyncio
async def test_a_failed_call_returns_none_not_a_guess():
    with patch(
        "bot.services.token_intel.etherscan_source._get_json",
        new=AsyncMock(return_value=None),
    ):
        assert await fetch_holder_concentration("hyperevm", TOKEN, "key") is None


@pytest.mark.asyncio
async def test_a_result_that_is_not_a_list_returns_none():
    # If the real shape turns out to differ from what this assumes, this is
    # the path that catches it — "no usable data" rather than a crash or a
    # confidently wrong percentage.
    with patch(
        "bot.services.token_intel.etherscan_source._get_json",
        new=AsyncMock(return_value={"status": "1", "result": "not a list"}),
    ):
        assert await fetch_holder_concentration("hyperevm", TOKEN, "key") is None


@pytest.mark.asyncio
async def test_the_assumed_shape_computes_top_holder_pct_excluding_burn():
    fixture = {
        "status": "1",
        "result": [
            {
                "TokenHolderAddress": "0xdEaD000000000000000000000000000000dEaD"[:2] + "0" * 38,
                "TokenHolderQuantity": "0",
            },
            {
                "TokenHolderAddress": "0x000000000000000000000000000000000000dead",
                "TokenHolderQuantity": "900000000000000000000",
            },
            {
                "TokenHolderAddress": "0xrealwallet00000000000000000000000000001",
                "TokenHolderQuantity": "99000000000000000000",
            },
            {
                "TokenHolderAddress": "0xrealwallet00000000000000000000000000002",
                "TokenHolderQuantity": "1000000000000000000",
            },
        ],
    }
    with patch(
        "bot.services.token_intel.etherscan_source._get_json",
        new=AsyncMock(return_value=fixture),
    ):
        r = await fetch_holder_concentration("hyperevm", TOKEN, "key")
        assert r is not None
        # Percent is of TOTAL supply (matching GoPlus's convention in
        # goplus_source.py), not of circulating-minus-burn. The burn address
        # is excluded from the CANDIDATE list, not from the denominator: it
        # holds 900/1000 of supply, so the two real wallets (99 + 1) sum to
        # 10% of total — that is the correct, expected number here, not a
        # bug. What matters is that the burn address itself never appears in
        # the sum.
        assert r.top_holder_pct == pytest.approx(10.0, abs=0.5)


@pytest.mark.asyncio
async def test_a_row_with_an_unparseable_quantity_is_skipped_not_fatal():
    fixture = {
        "status": "1",
        "result": [
            {"TokenHolderAddress": "0xgood", "TokenHolderQuantity": "100"},
            {"TokenHolderAddress": "0xbad", "TokenHolderQuantity": "not-a-number"},
        ],
    }
    with patch(
        "bot.services.token_intel.etherscan_source._get_json",
        new=AsyncMock(return_value=fixture),
    ):
        r = await fetch_holder_concentration("hyperevm", TOKEN, "key")
        assert r is not None
        assert r.top_holder_pct == pytest.approx(100.0)


def test_hyperevm_is_the_only_covered_chain_today():
    # A reminder to update this test, not just the map, if that ever changes.
    assert ETHERSCAN_CHAIN_IDS == {"hyperevm": "999"}


def test_burn_addresses_match_the_rest_of_the_codebase():
    from bot.services.token_intel.goplus_source import (
        BURN_ADDRESSES as GOPLUS_BURN_ADDRESSES,
    )

    assert BURN_ADDRESSES == GOPLUS_BURN_ADDRESSES
