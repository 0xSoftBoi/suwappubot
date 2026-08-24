"""LP-lock detection: three states, and never coercing the third into the second."""

from unittest.mock import AsyncMock, patch

import pytest

from bot.services.token_intel.lp_lock import (
    BURN_ADDRESSES,
    KNOWN_LOCKERS,
    LOCKED_THRESHOLD_PCT,
    check_lp_lock,
)

PAIR = "0x17a3ad8c74c4947005afeda9965305ae2eb2518a"
BURN = "0x000000000000000000000000000000000000dead"
LOCKER = next(iter(KNOWN_LOCKERS))
WHALE = "0x1111111111111111111111111111111111111111"


def _token(supply="1000000000000000000000", decimals="18"):
    return {"total_supply": supply, "decimals": decimals}


def _holders(*pairs):
    return {"items": [{"address": {"hash": a}, "value": str(v)} for a, v in pairs]}


async def _run(responses):
    """responses: list returned by successive _get_json calls."""
    with patch("bot.services.token_intel.lp_lock._get_json", new=AsyncMock(side_effect=responses)):
        return await check_lp_lock("base", PAIR)


@pytest.mark.asyncio
async def test_burned_lp_reads_as_locked():
    r = await _run([_token(), _holders((BURN, 10**21))])
    assert r.locked is True
    assert r.burned_pct == pytest.approx(100.0)


@pytest.mark.asyncio
async def test_lp_in_a_known_locker_reads_as_locked():
    r = await _run([_token(), _holders((LOCKER, 10**21))])
    assert r.locked is True
    assert r.locker == KNOWN_LOCKERS[LOCKER]


@pytest.mark.asyncio
async def test_lp_held_by_a_wallet_reads_as_pullable():
    r = await _run([_token(), _holders((WHALE, 10**21))])
    assert r.locked is False


@pytest.mark.asyncio
async def test_partial_burn_below_threshold_is_not_locked():
    # 40% burned, 60% liquid. The deployer can still pull most of it.
    r = await _run([_token(), _holders((BURN, 4 * 10**20), (WHALE, 6 * 10**20))])
    assert r.locked is False
    assert r.burned_pct == pytest.approx(40.0)
    assert LOCKED_THRESHOLD_PCT == 50.0


@pytest.mark.asyncio
async def test_a_v3_pool_is_undetermined_not_unlocked():
    # THE case. A V3 pool has no fungible LP token, so the tokens/{addr} read
    # fails. Reporting that as "unlocked" would flag every V3 pool on Base as
    # rug-prone — plausible, confident and wrong.
    r = await _run([None, None])
    assert r.locked is None
    assert "V3" in r.reason


@pytest.mark.asyncio
async def test_a_broken_holder_endpoint_is_undetermined_not_unlocked():
    # base.blockscout.com returns HTTP 200 with the body "Internal server
    # error" — valid JSON, but a string. It must not read as "nobody holds
    # the LP", which is indistinguishable from a fully burned supply.
    r = await _run([_token(), "Internal server error"])
    assert r.locked is None


@pytest.mark.asyncio
async def test_an_empty_holder_list_is_undetermined_not_unlocked():
    # Blockscout v2 ignores ?limit and returns an empty items array. That is a
    # pagination quirk, not a fact about the token.
    r = await _run([_token(), {"items": []}])
    assert r.locked is None


@pytest.mark.asyncio
async def test_a_chain_without_an_explorer_is_undetermined():
    r = await check_lp_lock("hyperevm", PAIR)
    assert r.locked is None
    assert "hyperevm" in r.reason


@pytest.mark.asyncio
async def test_no_pair_address_is_undetermined():
    r = await check_lp_lock("base", "")
    assert r.locked is None


def test_burn_addresses_are_lowercase_for_comparison():
    # Holder hashes come back checksummed; we lowercase before matching. If a
    # constant were checksummed here the match would silently never fire.
    for a in BURN_ADDRESSES:
        assert a == a.lower()
    for a in KNOWN_LOCKERS:
        assert a == a.lower()
