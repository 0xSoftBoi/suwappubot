"""The per-pool figures that ride along with the chain's headline two.

`chain_totals` fetches 2.4 MB to reach `total_tvl` and `trading_volume_24h`
-- the endpoint answers with the chain's whole pool list attached. These
are about the other thousand rows not going in the bin.
"""

from __future__ import annotations

import pytest

from curve import api as api_module
from curve.api import CurveApi, _figures_key
from curve.models import Pool

CHAIN_ID = 1
POOL = "0x" + "aa" * 20
OTHER = "0x" + "bb" * 20


def chain_payload(tvl: float = 1e9, volume: float = 2e8) -> dict:
    return {
        "total": {"total_tvl": tvl, "trading_volume_24h": volume},
        "data": [
            {
                "address": POOL.upper(),          # the API mixes its case
                "tvl_usd": 500.0,
                "trading_volume_24h": 40.0,
                "base_weekly_apr": 1.25,
                "coins": [{"symbol": "USDC"}],    # everything else is dropped
            },
            {
                "address": OTHER,
                "tvl_usd": 10.0,
                "trading_volume_24h": 1.0,
                "base_weekly_apr": 0.5,
            },
        ],
    }


class Server:
    """Answers the two calls this needs, and counts the expensive one."""

    def __init__(self, payload: dict | None = None) -> None:
        self.payload = chain_payload() if payload is None else payload
        self.chain_fetches = 0

    async def get_json(self, url: str, timeout: float = 30.0) -> dict:
        if "/v2/pools/chains/" in url:
            return {"data": [{"name": "ethereum", "chain_id": CHAIN_ID}]}
        if "/v1/chains/ethereum" in url:
            self.chain_fetches += 1
            return self.payload
        raise AssertionError(f"nothing here asks for {url}")


@pytest.fixture
def api(monkeypatch) -> CurveApi:
    server = Server()
    monkeypatch.setattr(api_module, "get_json", server.get_json)
    built = CurveApi()
    built.server = server                      # type: ignore[attr-defined]
    monkeypatch.setattr(built, "is_lite", _never_lite)
    monkeypatch.setattr(built, "lite_chains", _no_lite_chains)
    return built


async def _never_lite(_chain_id: int) -> bool:
    return False


async def _no_lite_chains() -> dict:
    return {}


# -- one fetch, two answers ------------------------------------------------


async def test_the_figures_come_off_the_fetch_the_totals_already_paid_for(api) -> None:
    totals = await api.chain_totals(CHAIN_ID)
    figures = await api.pool_figures(CHAIN_ID)

    assert totals == {"tvl": 1e9, "volume": 2e8}
    assert api.server.chain_fetches == 1, "the second answer cost nothing"
    assert figures[POOL.lower()] == {
        "tvl_usd": 500.0,
        "trading_volume_24h": 40.0,
        "base_weekly_apr": 125.0,          # a fraction here, a percent there
    }


async def test_asking_for_the_figures_first_works_the_same_way(api) -> None:
    figures = await api.pool_figures(CHAIN_ID)

    assert set(figures) == {POOL.lower(), OTHER.lower()}
    assert api.server.chain_fetches == 1


async def test_the_rest_of_a_row_is_not_kept(api) -> None:
    """A row has forty fields and there are a thousand of them. Keeping
    them whole would hold the 2.4 MB in memory for the sake of a refresh.
    """
    figures = await api.pool_figures(CHAIN_ID)

    assert set(figures[POOL.lower()]) == set(api_module.FIGURE_FIELDS)


async def test_addresses_are_lowered_so_they_match_whatever_asks(api) -> None:
    figures = await api.pool_figures(CHAIN_ID)

    assert POOL.lower() in figures and POOL.upper() not in figures


async def test_a_chain_that_answers_with_nothing_is_an_empty_map(monkeypatch) -> None:
    server = Server({"total": {}, "data": []})
    monkeypatch.setattr(api_module, "get_json", server.get_json)
    built = CurveApi()
    monkeypatch.setattr(built, "is_lite", _never_lite)
    monkeypatch.setattr(built, "lite_chains", _no_lite_chains)

    assert await built.pool_figures(CHAIN_ID) == {}


async def test_a_lite_chain_has_no_such_list_and_does_not_go_looking(
    monkeypatch,
) -> None:
    """Its totals come from the deployments list, which carries one TVL
    and no pools. Asking twice must not send it back to the network.
    """
    from curve.lite import LiteChain

    async def is_lite(_chain_id: int) -> bool:
        return True

    async def lite_chains() -> dict:
        return {
            "sonic": LiteChain(
                name="sonic", chain_id=CHAIN_ID, label="Sonic", tvl=7.0
            )
        }

    built = CurveApi()
    monkeypatch.setattr(built, "is_lite", is_lite)
    monkeypatch.setattr(built, "lite_chains", lite_chains)
    monkeypatch.setattr(
        api_module, "get_json", _refuse, raising=True
    )

    assert await built.pool_figures(CHAIN_ID) == {}
    assert built._cached(_figures_key(CHAIN_ID)) == {}


async def _refuse(*_a, **_kw):
    raise AssertionError("a Lite chain has nothing to fetch here")


def test_base_apr_is_brought_into_the_units_the_rest_of_the_app_uses() -> None:
    """The two payloads agree on TVL and volume to the cent and disagree on
    base APR by exactly 100x -- v1 gives the fraction, v2 the percentage.
    Taken raw, every Base APY in the list shrank by two decimal places on
    the first refresh: crvUSD/USDC went from 0.73% to "< 0.01%".

    Read off both APIs for the same pools in the same minute.
    """
    from curve.api import _pool_figures

    measured = [
        # v1's base_weekly_apr, then v2's for the same pool in the same
        # minute. Scaled, they agree digit for digit -- including the tiny
        # one, which is what rules out a rounding story.
        ("0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7",
         5.88338044948955e-10, 5.88338044948955e-08),
        ("0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E",
         0.007309821255934601, 0.7309821255934601),
        ("0xDC24316b9AE028F1497c275EB9192a3Ea0f67022",
         0.012104870057041639, 1.210487005704164),
    ]
    payload = {
        "data": [
            {"address": address, "base_weekly_apr": raw}
            for address, raw, _v2 in measured
        ]
    }

    figures = _pool_figures(payload)

    for address, _raw, as_v2_says in measured:
        assert figures[address.lower()]["base_weekly_apr"] == pytest.approx(as_v2_says)


# -- what a pool does with them --------------------------------------------


def make_pool() -> Pool:
    return Pool.from_v2(
        {
            "address": POOL,
            "name": "a pool",
            "pool_type": "main",
            "tvl_usd": 100.0,
            "trading_volume_24h": 10.0,
            "base_weekly_apr": 1.0,
        }
    )


def test_a_pool_takes_the_three_that_move() -> None:
    pool = make_pool()

    moved = pool.take_figures(
        {"tvl_usd": 200.0, "trading_volume_24h": 20.0, "base_weekly_apr": 2.0}
    )

    assert moved
    assert (pool.tvl, pool.volume_24h, pool.base_apr) == (200.0, 20.0, 2.0)


def test_the_same_figures_again_are_not_a_change() -> None:
    """What the list uses to decide whether redrawing is worth it."""
    pool = make_pool()
    same = {"tvl_usd": 100.0, "trading_volume_24h": 10.0, "base_weekly_apr": 1.0}

    assert pool.take_figures(same) is False


def test_incentives_are_left_alone() -> None:
    """A chain payload does not carry them -- they are a v2 field. Taking
    figures must not quietly zero the CRV range beside them.
    """
    pool = Pool.from_v2(
        {
            "address": POOL,
            "name": "a pool",
            "pool_type": "main",
            "crv_apr": 3.0,
            "crv_apr_boosted": 7.5,
        }
    )

    pool.take_figures({"tvl_usd": 1.0, "trading_volume_24h": 2.0})

    assert pool.crv_apr == (3.0, 7.5)
