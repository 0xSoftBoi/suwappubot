"""How many requests it takes to learn what a portfolio earns."""

from __future__ import annotations

import pytest

from curve import api as api_module
from curve.http import ApiError

CHAIN = 1


def pool(address: str, crv: float = 1.5) -> dict:
    return {
        "address": address,
        "name": f"pool {address[-2:]}",
        "crv_apr": crv,
        "crv_apr_boosted": crv * 2.5,
        "extra_rewards_apr": [],
        "gauges": [{"address": "0x" + "9" * 40, "is_killed": False}],
    }


class Server:
    """Counts what it is asked for, and answers as v2 does."""

    def __init__(self, pools: list[dict], page_size: int = 50) -> None:
        self.pools = pools
        self.page_size = page_size
        self.list_pages: list[int] = []
        self.details: list[str] = []

    async def get_json(self, url: str, timeout: float = 30.0) -> dict:
        path = url.split("/v2")[1]
        if path.startswith(("/pools/?", "/pools/&")):
            page = int(_param(url, "page") or 1)
            self.list_pages.append(page)
            start = (page - 1) * self.page_size
            return {
                "count": len(self.pools),
                "pools": self.pools[start : start + self.page_size],
            }
        address = path.rsplit("/", 1)[-1].split("?")[0]
        self.details.append(address.lower())
        found = next(
            (p for p in self.pools if p["address"].lower() == address.lower()), None
        )
        if found is None:
            raise ApiError(f"no such pool {address}")
        return found


def _param(url: str, name: str) -> str | None:
    for part in url.split("?", 1)[-1].split("&"):
        key, _, value = part.partition("=")
        if key == name:
            return value
    return None


@pytest.fixture
def served(monkeypatch):
    def build(count: int, page_size: int = 50):
        pools = [pool("0x" + f"{i:040x}") for i in range(count)]
        server = Server(pools, page_size)
        monkeypatch.setattr(api_module, "get_json", server.get_json)
        monkeypatch.setattr(api_module, "MAX_PAGE_SIZE", page_size)
        return server, api_module.CurveApi(), pools

    return build


async def test_a_scanned_chain_costs_nothing_to_rate(served) -> None:
    server, api, pools = served(120)
    await api._all_gauges(CHAIN)
    asked = len(server.list_pages)

    rates = await api.pool_rates(CHAIN, [p["address"] for p in pools])

    assert len(rates) == 120
    assert server.list_pages == list(range(1, asked + 1)), "no second listing"
    assert server.details == [], "and not one per-pool request"
    assert rates[pools[0]["address"].lower()]["crv_apr"] == 1.5


async def test_a_handful_of_pools_is_asked_for_one_at_a_time(served) -> None:
    server, api, pools = served(600)
    await api._all_gauges(CHAIN)
    api.invalidate()          # rates expired; the page count is still known
    server.list_pages.clear()

    await api.pool_rates(CHAIN, [p["address"] for p in pools[:3]])

    assert server.list_pages == []
    assert len(server.details) == 3


async def test_more_pools_than_pages_takes_the_list(served) -> None:
    server, api, pools = served(100)
    await api._all_gauges(CHAIN)
    api.invalidate()
    server.list_pages.clear()

    rates = await api.pool_rates(CHAIN, [p["address"] for p in pools[:20]])

    assert sorted(server.list_pages) == [1, 2]
    assert server.details == []
    assert len(rates) == 20


async def test_an_unlisted_chain_asks_per_pool_for_a_few(served) -> None:
    server, api, pools = served(600)

    await api.pool_rates(CHAIN, [p["address"] for p in pools[:3]])

    assert server.list_pages == []
    assert len(server.details) == 3


async def test_an_unlisted_chain_buys_the_page_count_when_it_matters(served) -> None:
    server, api, pools = served(600)

    rates = await api.pool_rates(CHAIN, [p["address"] for p in pools[:300]])

    assert sorted(server.list_pages) == list(range(1, 13))
    assert server.details == []
    assert len(rates) == 300


async def test_the_probe_page_is_not_fetched_twice(served) -> None:
    server, api, pools = served(600)

    await api.pool_rates(CHAIN, [p["address"] for p in pools[:300]])

    assert server.list_pages.count(1) == 1


async def test_buying_the_count_can_settle_it_the_other_way(served) -> None:
    server, api, pools = served(10_000)
    wanted = [p["address"] for p in pools[:25]] + [p["address"] for p in pools[-25:]]

    rates = await api.pool_rates(CHAIN, wanted)

    assert server.list_pages == [1], "one page, to learn the count"
    assert len(server.details) == 25
    assert len(rates) == 50


async def test_a_pool_nothing_answers_for_is_left_out(served) -> None:
    _server, api, pools = served(10)

    rates = await api.pool_rates(
        CHAIN, [pools[0]["address"], "0x" + "ff" * 20]
    )

    assert list(rates) == [pools[0]["address"].lower()]


async def test_rates_are_not_asked_for_twice(served) -> None:
    server, api, pools = served(10)
    await api.pool_rates(CHAIN, [pools[0]["address"]])
    await api.pool_rates(CHAIN, [pools[0]["address"]])

    assert len(server.details) == 1


# -- what a pool is worth ---------------------------------------------------


def test_a_pool_is_valued_by_what_it_holds() -> None:
    from curve.api import pool_composition

    assert pool_composition(
        {"balances_usd": [1_000.0, 2_500.5], "tvl_usd": 3_500.5}
    ) == pytest.approx(3_500.5)


def test_the_two_ethx_pools_stop_being_worth_thirty_dollars() -> None:
    from curve.api import pool_composition

    ethx_wsteth = {
        "tvl_usd": 30.03324352900331,
        "balances_usd": [6.877406287619365e-11, 7.752986382331606e-11],
    }
    ethx_weth = {
        "tvl_usd": 25.11359659328098,
        "balances_usd": [2.700916017478441e-11, 4.022215192807452e-11],
    }
    assert pool_composition(ethx_wsteth) < 1e-9
    assert pool_composition(ethx_weth) < 1e-9


def test_a_payload_with_no_reserves_still_gets_a_number() -> None:
    from curve.api import pool_composition

    assert pool_composition({"tvl_usd": 1_234.5}) == 1_234.5
    assert pool_composition({"tvl_usd": 1_234.5, "balances_usd": []}) == 1_234.5
    assert pool_composition({}) == 0.0


def test_a_reserve_that_is_null_counts_as_nothing() -> None:
    from curve.api import pool_composition

    assert pool_composition({"balances_usd": [10.0, None]}) == 10.0
