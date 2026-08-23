"""Finding an address's deposits, and remembering them between visits."""

from __future__ import annotations

import json

import pytest

from curve import portfolio
from curve.multicall import MULTICALL3
from curve.portfolio import LP_UNIT, Holding, Target, calls_for, holdings_from

UNIT = LP_UNIT


def address(tag: str) -> str:
    """A real-shaped address, because the encoder checks."""
    return "0x" + (tag.encode().hex() * 40)[:40]


def target(name: str, *, gauge: str = "", tvl: float = 0.0, supply: float = 0.0) -> Target:
    return Target(
        address=address("p" + name),
        name=name,
        chain="ethereum",
        lp_token=address("l" + name),
        gauge=gauge,
        tvl=tvl,
        supply=supply,
        coins=(("0x" + "aa" * 20, "A"), ("0x" + "bb" * 20, "B")),
    )


# -- which contracts get asked ---------------------------------------------


def test_a_gauge_is_asked_about_too() -> None:
    plan = calls_for([target("one", gauge=address("g1")), target("two")])
    assert plan == [address("lone"), address("g1"), address("ltwo")]


def test_pools_without_a_gauge_only_cost_one_call() -> None:
    plan = calls_for([target(str(n)) for n in range(5)])
    assert len(plan) == 5


def test_the_lp_token_is_asked_not_the_pool() -> None:
    assert calls_for([target("x")])[0] == address("lx")


def test_a_pool_with_no_lp_token_falls_back_to_itself() -> None:
    bare = Target(address=address("bare"), name="p", chain="ethereum", lp_token="")
    assert calls_for([bare]) == [address("bare")]


# -- putting the answers back together -------------------------------------


def test_answers_line_up_with_the_pools_that_asked() -> None:
    targets = [target("a", gauge=address("ga")), target("b"), target("c", gauge=address("gc"))]
    answers = [5 * UNIT, 3 * UNIT, 0, 0, 7 * UNIT]

    holdings = {h.name: h for h in holdings_from(targets, answers)}

    assert holdings["a"].wallet == 5 * UNIT
    assert holdings["a"].staked == 3 * UNIT
    assert "b" not in holdings                    # nothing in it
    assert holdings["c"].wallet == 0
    assert holdings["c"].staked == 7 * UNIT       # staked only


def test_a_staked_only_position_is_still_a_position() -> None:
    found = holdings_from([target("t", gauge=address("g"))], [0, 42])
    assert len(found) == 1
    assert found[0].staked == 42


def test_pools_with_nothing_in_them_are_left_out() -> None:
    assert holdings_from([target("a"), target("b")], [0, 0]) == []


def test_a_call_that_failed_reads_as_zero_not_as_a_crash() -> None:
    assert holdings_from([target("a"), target("b")], [None, 5]) == holdings_from(
        [target("a"), target("b")], [0, 5]
    )


def test_a_short_answer_does_not_shift_every_row() -> None:
    found = holdings_from([target("a"), target("b"), target("c")], [7])
    assert [h.name for h in found] == ["a"]


# -- what a position is worth ----------------------------------------------


def test_value_is_the_pools_own_accounting() -> None:
    holding = Holding(
        address="0x", name="p", chain="ethereum",
        wallet=2 * UNIT, staked=3 * UNIT, tvl=1_000.0, supply=100.0,
    )
    assert holding.lp_price == 10.0
    assert holding.value == 50.0            # 5 LP at $10
    assert holding.share == pytest.approx(0.05)


def test_an_empty_pool_is_worth_nothing_rather_than_raising() -> None:
    holding = Holding(address="0x", name="p", chain="ethereum", wallet=UNIT, tvl=5.0)
    assert holding.value == 0.0
    assert holding.share == 0.0


def test_the_biggest_position_comes_first() -> None:
    small = Holding(address=address("s"), name="small", chain="e", wallet=UNIT,
                    tvl=10.0, supply=10.0)
    big = Holding(address=address("b"), name="big", chain="e", wallet=UNIT,
                  tvl=1000.0, supply=10.0)
    targets = [
        Target(address=address("s"), name="small", chain="e", lp_token=address("s"),
               tvl=10.0, supply=10.0),
        Target(address=address("b"), name="big", chain="e", lp_token=address("b"),
               tvl=1000.0, supply=10.0),
    ]
    order = [h.name for h in holdings_from(targets, [small.wallet, big.wallet])]
    assert order == ["big", "small"]


# -- the scan --------------------------------------------------------------


class BatchProvider:
    """A chain with Multicall3, answering from a dict of balances."""

    def __init__(self, balances: dict[str, int], supplies: dict[str, int] | None = None):
        self.balances = balances
        self.supplies = supplies or {}
        self.batches: list[int] = []

    async def call(self, to: str, data: str) -> str:
        from tests.test_parameters import aggregate3_response

        assert to == MULTICALL3
        body = data[10:]
        count = int(body[64:128], 16)
        self.batches.append(count)
        targets = []
        for index in range(count):
            at = 128 + int(body[128 + index * 64 : 192 + index * 64], 16) * 2
            targets.append("0x" + body[at + 24 : at + 64].lstrip("0"))
        supply_call = "18160ddd" in data
        source = self.supplies if supply_call else self.balances
        return aggregate3_response(
            [source.get(name) for name in (t.lower() for t in targets)]
        )


async def test_a_scan_reads_wallets_and_gauges_and_prices_them() -> None:
    targets = [
        Target(address="0x" + "a" * 40, name="A", chain="e",
               lp_token="0x" + "1" * 40, gauge="0x" + "2" * 40, tvl=1_000.0),
        Target(address="0x" + "b" * 40, name="B", chain="e", lp_token="0x" + "3" * 40),
    ]
    provider = BatchProvider(
        balances={"0x" + "1" * 40: 4 * UNIT, "0x" + "2" * 40: 6 * UNIT},
        supplies={"0x" + "1" * 40: 100 * UNIT},
    )

    holdings = await portfolio.scan(provider, targets, "0x" + "9" * 40)

    assert len(holdings) == 1
    assert holdings[0].wallet == 4 * UNIT and holdings[0].staked == 6 * UNIT
    assert holdings[0].supply == 100.0
    assert holdings[0].value == 100.0        # 10 of 100 LP in a $1,000 pool


async def test_progress_is_reported_in_calls() -> None:
    targets = [target(str(n)) for n in range(250)]
    seen: list[tuple[int, int]] = []

    await portfolio.scan(
        BatchProvider({}), targets, "0x" + "9" * 40,
        on_progress=lambda done, total: seen.append((done, total)),
        chunk=100,
    )

    assert [total for _done, total in seen] == [250, 250, 250]
    assert sorted(done for done, _t in seen) == [100, 200, 250]


async def test_nothing_to_scan_is_not_a_request() -> None:
    provider = BatchProvider({})
    assert await portfolio.scan(provider, [], "0x9") == []
    assert provider.batches == []


# -- remembering it --------------------------------------------------------


def holding(name: str = "p", **kw) -> Holding:
    base = {
        "address": "0x" + "a" * 40, "name": name, "chain": "ethereum",
        "wallet": 3 * UNIT, "staked": 0, "tvl": 100.0, "supply": 10.0,
        "coins": (("0x" + "aa" * 20, "A"),), "lp_token": "0x" + "1" * 40, "gauge": "0x" + "2" * 40,
    }
    base.update(kw)
    return Holding(**base)


def test_a_remembered_scan_survives_a_round_trip() -> None:
    saved = json.dumps(portfolio.to_json([holding()], "0xUSER", "ethereum"))
    back = portfolio.from_json(json.loads(saved), "0xuser", "ethereum")
    assert back == [holding()]


def test_balances_survive_being_json() -> None:
    big = 123_456_789_012_345_678_901_234_567_890
    saved = json.dumps(portfolio.to_json([holding(wallet=big)], "0xu", "ethereum"))
    assert portfolio.from_json(json.loads(saved), "0xu", "ethereum")[0].wallet == big


def test_another_account_remembers_nothing() -> None:
    saved = portfolio.to_json([holding()], "0xUSER", "ethereum")
    assert portfolio.from_json(saved, "0xother", "ethereum") == []


def test_another_chain_remembers_nothing() -> None:
    saved = portfolio.to_json([holding()], "0xu", "ethereum")
    assert portfolio.from_json(saved, "0xu", "xdai") == []


@pytest.mark.parametrize("junk", [None, "", 7, {"holdings": "no"}, {"holdings": [{}]}])
def test_junk_in_storage_is_nothing_remembered(junk) -> None:
    assert portfolio.from_json(junk, "0xu", "ethereum") == []


def test_a_remembered_holding_can_be_re_read_on_its_own() -> None:
    targets = portfolio.targets_for([holding()])
    assert calls_for(targets) == ["0x" + "1" * 40, "0x" + "2" * 40]


async def test_a_page_of_pools_that_will_not_load_is_asked_for_again() -> None:
    """And if it still will not load, the call fails rather than returning
    what did arrive: `portfolio_targets` reads this list, so a dropped page
    is a pool nobody asks about, and a deposit in it is reported as no
    deposit at all."""
    from curve.api import CurveApi
    from curve.http import ApiError

    api = CurveApi()
    api._pages[1] = 3
    served: dict[int, int] = {}

    async def flaky(chain_id: int, page: int):
        served[page] = served.get(page, 0) + 1
        if page == 2 and served[page] == 1:
            raise ApiError("502 from the API")
        return [{"address": f"0x{page:040x}", "gauges": []}]

    api._list_page = flaky  # type: ignore[method-assign]

    pools = await api._list_pools(1)

    assert served[2] == 2, "the page that failed was asked for a second time"
    assert len(pools) == 3, "and every page is in the answer"


async def test_a_page_that_never_loads_is_reported_not_dropped() -> None:
    from curve.api import CurveApi
    from curve.http import ApiError

    api = CurveApi()
    api._pages[1] = 2

    async def broken(chain_id: int, page: int):
        if page == 2:
            raise ApiError("502 from the API")
        return [{"address": "0x" + "11" * 20, "gauges": []}]

    api._list_page = broken  # type: ignore[method-assign]

    with pytest.raises(ApiError, match="page 2"):
        await api._list_pools(1)


async def test_every_chains_tvl_arrives_in_one_request(monkeypatch) -> None:
    """The per-chain totals endpoint answers with the chain's whole pool
    list attached -- 2.3 MB for Ethereum -- so asking it twenty-six times
    to order a menu is not a trade worth making."""
    from curve import api as api_module
    from curve.api import CurveApi

    asked: list[str] = []

    async def one_call(url, timeout=None):
        asked.append(url)
        return {"data": [
            {"name": "ethereum", "pool_tvl": 1.4e9, "lending_tvl": 7.1e7},
            {"name": "xdai", "pool_tvl": 2.9e6, "lending_tvl": 0.0},
        ]}

    monkeypatch.setattr(api_module, "get_json", one_call)
    api = CurveApi()
    api._store("lite:chains", {})

    tvls = await api.chain_tvls()

    assert len(asked) == 1, "one request for every chain, not one per chain"
    assert tvls == {"ethereum": 1.4e9, "xdai": 2.9e6}
    assert "pool_tvl" not in str(tvls), "the lending TVL beside it is not this"


async def test_the_lite_chains_bring_their_own_totals(monkeypatch) -> None:
    """They are not in the prices list at all, and their deployments file
    already carries a TVL."""
    from curve import api as api_module
    from curve.api import CurveApi
    from curve.lite import LiteChain

    async def prices(url, timeout=None):
        return {"data": [{"name": "ethereum", "pool_tvl": 1.4e9}]}

    monkeypatch.setattr(api_module, "get_json", prices)
    api = CurveApi()
    api._store("lite:chains", {"etherlink": LiteChain(name="etherlink", chain_id=42793, label="Etherlink", tvl=9.2e6)})

    tvls = await api.chain_tvls()

    assert tvls["etherlink"] == 9.2e6
    assert tvls["ethereum"] == 1.4e9
