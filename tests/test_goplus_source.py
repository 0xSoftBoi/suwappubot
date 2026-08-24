"""GoPlus as the primary LP-lock and holder source. Fixtures below are lightly
trimmed copies of real responses captured live (Base KEYCAT/RUSSELL, Solana),
not invented shapes — the whole point of this module is that assumed shapes
have already produced one confident, wrong safety verdict this session."""

from unittest.mock import AsyncMock, patch

import pytest

from bot.services.token_intel.goplus_source import (
    GoPlusResult,
    LOCKED_THRESHOLD_PCT,
    _parse_evm,
    _parse_solana,
    fetch,
)

KEYCAT_TOKEN = "0x377feeed4820b3b28d1ab429509e7a0789824fca"

# Real shape: a UniswapV4 position held by the shared position manager,
# NOT locked. The bug this whole module exists to correct reported this
# specific token as locked=True, burned=99.98%.
KEYCAT_FIXTURE = {
    "holders": [
        {
            "address": "0x000000000000000000000000000000000000dead",
            "percent": "0.999842274490990297",
            "is_contract": 0,
        },
        {
            "address": "0x9bd25e67bf390437c8faf480ac735a27bcf6168c",
            "percent": "0.000042791664856831",
            "is_contract": 1,
        },
        {
            "address": "0x694e18d15c672d6e86c857ccb1dab42d53dc00db",
            "percent": "0.000001182376525333",
            "is_contract": 0,
        },
    ],
    "lp_holders": [
        {
            "address": "0x944f4fae927e2f76f72fdb23967fc6244b8deefc",
            "percent": "1.000000000000000000",
            "is_contract": 1,
            "is_locked": 0,
        }
    ],
    "is_honeypot": "0",
    "buy_tax": "0",
    "sell_tax": "0",
    "is_mintable": "1",
}


def test_the_regression_this_module_exists_for():
    # The bug: the retired Blockscout heuristic reported this exact token as
    # locked=True. The correct answer, per GoPlus's position-level data, is
    # False — the LP sits unlocked in the standard V4 position manager.
    r = _parse_evm(KEYCAT_FIXTURE)
    assert r.lp_locked is False
    assert "0.0%" in r.lp_lock_reason


def test_a_burned_or_locked_lp_reads_as_locked():
    fixture = {
        "holders": [],
        "lp_holders": [{"address": "0xlocker", "percent": "1.0", "is_locked": 1}],
    }
    r = _parse_evm(fixture)
    assert r.lp_locked is True


def test_partial_lock_below_threshold_is_not_locked():
    fixture = {
        "holders": [],
        "lp_holders": [
            {"address": "0xlocked", "percent": "0.3", "is_locked": 1},
            {"address": "0xfree", "percent": "0.7", "is_locked": 0},
        ],
    }
    r = _parse_evm(fixture)
    assert r.lp_locked is False
    assert LOCKED_THRESHOLD_PCT == 50.0


def test_no_lp_holder_data_is_undetermined_not_unlocked():
    r = _parse_evm({"holders": [], "lp_holders": []})
    assert r.lp_locked is None


def test_top_holder_pct_excludes_contract_addresses():
    # "a deep pool is not a whale" — the existing project convention.
    r = _parse_evm(KEYCAT_FIXTURE)
    # The burn address (99.98%) and the one contract holder (0.004%) are both
    # excluded; only the one real wallet counts.
    assert r.top_holder_pct == pytest.approx(0.000118, abs=0.0001)
    assert r.contract_held_pct == pytest.approx(0.0043, abs=0.01)


def test_a_burn_address_is_not_counted_as_a_whale():
    # THE case. A dead-address holding 99% of supply is not a concentration
    # risk — it is supply gone forever, and GoPlus tags it is_contract: 0, same
    # as an ordinary wallet, so this can only be caught by address.
    fixture = {
        "holders": [
            {"address": "0x000000000000000000000000000000000000dead", "percent": "0.9999"},
            {"address": "0xrealwallet", "percent": "0.0001"},
        ],
        "lp_holders": [],
    }
    r = _parse_evm(fixture)
    assert r.top_holder_pct == pytest.approx(0.01, abs=0.005)


def test_tax_fields_convert_fraction_to_bps():
    fixture = {"holders": [], "lp_holders": [], "buy_tax": "0.05", "sell_tax": "0.1"}
    r = _parse_evm(fixture)
    assert r.buy_tax_bps == 500
    assert r.sell_tax_bps == 1000


class TestSolana:
    def test_takes_the_highest_volume_pool_not_the_highest_burn(self):
        # A decoy pool with tiny volume and 100% burn must not override the
        # pool everyone is actually trading against.
        fixture = {
            "holders": [],
            "dex": [
                {"dex_name": "decoy", "burn_percent": 100.0, "day": {"volume": "50"}},
                {"dex_name": "raydium", "burn_percent": 12.0, "day": {"volume": "9000000"}},
            ],
        }
        r = _parse_solana(fixture)
        assert r.lp_locked is False
        assert "raydium" in r.lp_lock_reason

    def test_high_burn_on_the_real_pool_reads_as_locked(self):
        fixture = {
            "holders": [],
            "dex": [{"dex_name": "raydium", "burn_percent": 98.34, "day": {"volume": "1000"}}],
        }
        r = _parse_solana(fixture)
        assert r.lp_locked is True

    def test_no_dex_pools_is_undetermined(self):
        assert _parse_solana({"holders": [], "dex": []}).lp_locked is None

    def test_mintable_and_freezable_read_from_nested_status(self):
        fixture = {
            "holders": [],
            "dex": [],
            "mintable": {"status": "1"},
            "freezable": {"status": "0"},
        }
        r = _parse_solana(fixture)
        assert r.mintable is True
        assert r.freezable is False


@pytest.mark.asyncio
class TestFetch:
    async def test_hyperevm_returns_none_not_a_guess(self):
        # GoPlus does not cover HyperEVM. This must not silently produce a
        # verdict — the caller falls back to "no source covers this chain".
        assert await fetch("hyperevm", KEYCAT_TOKEN) is None

    async def test_a_malformed_response_is_treated_as_no_data(self):
        # code != 1, or a non-dict result — same discipline as everywhere else
        # this session: validate shape, not just HTTP status.
        with patch(
            "bot.services.token_intel.goplus_source._throttled_get",
            new=AsyncMock(return_value=None),
        ):
            assert await fetch("base", KEYCAT_TOKEN) is None

    async def test_a_covered_evm_chain_calls_the_evm_endpoint(self):
        with patch(
            "bot.services.token_intel.goplus_source._fetch_evm",
            new=AsyncMock(return_value=KEYCAT_FIXTURE),
        ) as m:
            r = await fetch("base", KEYCAT_TOKEN)
            assert r.lp_locked is False
            m.assert_awaited_once_with("8453", KEYCAT_TOKEN)

    async def test_solana_calls_the_solana_endpoint_not_the_evm_one(self):
        with patch(
            "bot.services.token_intel.goplus_source._fetch_solana",
            new=AsyncMock(return_value={"holders": [], "dex": []}),
        ) as m:
            r = await fetch("solana", "AnyMintAddress")
            assert r is not None
            m.assert_awaited_once_with("AnyMintAddress")
