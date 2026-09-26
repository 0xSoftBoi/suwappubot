"""`PoolFeed`: paging, exhaustion, and the reset race."""

from __future__ import annotations

import asyncio

from curve.api import PoolFeed
from curve.http import ApiError
from curve.models import Pool


def make_pool(index: int) -> Pool:
    return Pool.from_v2(
        {
            "address": "0x" + f"{index:040x}",
            "name": f"Pool {index}",
            "pool_type": "main",
            "tvl_usd": float(index),
        }
    )


class FakeApi:
    """Serves pages out of a fixed list, recording every query."""

    def __init__(self, total: int = 7, *, delay: float = 0.0, page_size: int = 50) -> None:
        self.all = [make_pool(i) for i in range(total)]
        self.delay = delay
        self.page_size = page_size
        self.queries: list[dict] = []
        self.fail_with: Exception | None = None

    async def list_pools(
        self, chain_id, *, chain="", page=1, page_size=50,
        sort_by="volume", direction="desc", search="", min_tvl=None,
    ):
        self.queries.append(
            {"page": page, "sort_by": sort_by, "search": search, "chain_id": chain_id}
        )
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail_with is not None:
            raise self.fail_with
        pool_set = self.all
        if search:
            pool_set = [p for p in pool_set if search.lower() in p.name.lower()]
        start = (page - 1) * self.page_size
        return pool_set[start : start + self.page_size], len(pool_set)


def feed(api: FakeApi, **kwargs) -> PoolFeed:
    return PoolFeed(api, "ethereum", 1, **kwargs)


# -- paging ----------------------------------------------------------------


async def test_pages_accumulate_until_exhausted() -> None:
    api = FakeApi(total=7, page_size=3)
    f = feed(api)
    assert not f.exhausted  # unknown before the first page

    first = await f.load_more()
    assert len(first) == 3
    assert f.total == 7 and f.loaded == 3 and not f.exhausted

    await f.load_more()
    assert f.loaded == 6 and not f.exhausted
    await f.load_more()
    assert f.loaded == 7
    assert f.exhausted
    assert [q["page"] for q in api.queries] == [1, 2, 3]


async def test_load_more_is_a_no_op_once_exhausted() -> None:
    api = FakeApi(total=2)
    f = feed(api)
    await f.load_more()
    assert f.exhausted
    assert await f.load_more() == []
    assert len(api.queries) == 1  # no pointless second request


async def test_concurrent_calls_do_not_double_fetch_a_page() -> None:
    api = FakeApi(total=100, delay=0.01)
    f = feed(api)
    results = await asyncio.gather(f.load_more(), f.load_more(), f.load_more())
    assert sum(len(r) for r in results) == 50  # exactly one page landed
    assert len(api.queries) == 1


async def test_an_empty_page_ends_the_feed_even_if_the_count_disagrees() -> None:
    api = FakeApi(total=0)
    api.all = []
    f = feed(api)
    assert await f.load_more() == []
    assert f.exhausted


# -- reset -----------------------------------------------------------------


async def test_reset_changes_the_query_and_drops_what_was_loaded() -> None:
    api = FakeApi(total=5)
    f = feed(api)
    await f.load_more()
    assert f.loaded == 5

    f.reset(sort_by="tvl")
    assert f.loaded == 0
    assert f.total is None
    await f.load_more()
    assert api.queries[-1]["sort_by"] == "tvl"
    assert api.queries[-1]["page"] == 1  # starts over, not page 2


async def test_search_is_sent_to_the_server() -> None:
    api = FakeApi(total=5)
    f = feed(api)
    f.reset(search="Pool 3")
    await f.load_more()
    assert api.queries[-1]["search"] == "Pool 3"
    assert f.loaded == 1


async def test_a_page_in_flight_when_the_query_changes_is_discarded() -> None:
    api = FakeApi(total=10, delay=0.05)
    f = feed(api)
    task = asyncio.ensure_future(f.load_more())
    await asyncio.sleep(0)  # let it get as far as the request
    f.reset(sort_by="tvl")
    assert await task == []
    assert f.loaded == 0  # the stale page was dropped, not appended


# -- errors ----------------------------------------------------------------


async def test_an_api_error_is_recorded_rather_than_raised() -> None:
    api = FakeApi(total=5)
    api.fail_with = ApiError("upstream is down")
    f = feed(api)
    assert await f.load_more() == []
    assert "upstream is down" in f.error
    assert f.loaded == 0


async def test_the_feed_recovers_after_a_failed_page() -> None:
    api = FakeApi(total=5)
    api.fail_with = ApiError("blip")
    f = feed(api)
    await f.load_more()
    api.fail_with = None
    assert len(await f.load_more()) == 5
    assert f.exhausted
