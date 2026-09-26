"""End-to-end UI tests driven by Flet's own integration-testing framework."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.flet_ui

SETTLE_ATTEMPTS = 60

#: "50 of 385 pools" while paging, "14 pools" once everything matching is in.
COUNT_PATTERN = r"\d+ of \d+ pools|\d+ pools"
#: The list opens on exactly one page, because v2 caps a page at 50 rows.
FIRST_PAGE_PATTERN = r"^50 of \d+ pools$"


async def wait_for(tester, finder_call, attempts: int = SETTLE_ATTEMPTS):
    """Pump until a finder matches something, then return it."""
    found = None
    for _ in range(attempts):
        await tester.pump_and_settle()
        found = await finder_call()
        if found.count:
            return found
    return found


async def wait_until_gone(tester, finder_call, attempts: int = SETTLE_ATTEMPTS):
    """Pump until a finder stops matching. Returns the final finder."""
    found = None
    for _ in range(attempts):
        await tester.pump_and_settle()
        found = await finder_call()
        if found.count == 0:
            return found
    return found


async def wait_for_pools(tester):
    return await wait_for(tester, lambda: tester.find_by_text_containing(COUNT_PATTERN))


async def test_app_starts_and_lists_pools(flet_app) -> None:
    tester = flet_app.tester
    await tester.pump_and_settle()

    assert (await tester.find_by_key("brand")).count == 1

    assert (await wait_for_pools(tester)).count >= 1, "the pool count never appeared"
    assert (await tester.find_by_key("pool-row-0")).count == 1


async def test_the_list_opens_on_one_page_of_fifty(flet_app) -> None:
    tester = flet_app.tester
    first = await wait_for(
        tester, lambda: tester.find_by_text_containing(FIRST_PAGE_PATTERN)
    )
    assert first.count == 1
    assert (await tester.find_by_key("pool-row-0")).count == 1
    assert (await tester.find_by_key("pool-row-49")).count == 0


async def test_the_list_offers_a_way_to_sort(flet_app) -> None:
    tester = flet_app.tester
    await wait_for_pools(tester)
    headings = (await tester.find_by_text("Volume")).count
    dropdown = (await tester.find_by_key("pool-sort")).count
    assert headings or dropdown, "no way to change the sort"


async def test_searching_asks_the_server_and_narrows_the_list(flet_app) -> None:
    tester = flet_app.tester
    assert (
        await wait_for(tester, lambda: tester.find_by_text_containing(FIRST_PAGE_PATTERN))
    ).count == 1

    search = await tester.find_by_key("pool-search")
    assert search.count == 1
    await tester.enter_text(search, "steth")

    remaining = await wait_until_gone(
        tester, lambda: tester.find_by_text_containing(FIRST_PAGE_PATTERN)
    )
    assert remaining.count == 0, "the search never reached the server"

    assert (await wait_for_pools(tester)).count >= 1
    assert (await tester.find_by_key("pool-row-0")).count == 1


async def test_sorting_by_tvl_reloads_the_list(flet_app) -> None:
    tester = flet_app.tester
    await wait_for_pools(tester)

    heading = await tester.find_by_text("TVL")
    assert heading.count >= 1
    await tester.tap(heading.first)

    assert (await wait_for_pools(tester)).count >= 1
    assert (await tester.find_by_key("pool-row-0")).count == 1


async def test_opening_a_pool_shows_the_action_panel(flet_app) -> None:
    tester = flet_app.tester
    await wait_for_pools(tester)

    row = await tester.find_by_key("pool-row-0")
    assert row.count == 1
    await tester.tap(row)
    await tester.pump_and_settle()

    for label in ("Deposit", "Withdraw", "Swap", "Stake"):
        found = await wait_for(tester, lambda label=label: tester.find_by_text(label))
        assert found.count >= 1, f"{label} tab missing from the detail page"

    assert (
        await wait_for(tester, lambda: tester.find_by_text_containing("LP token"))
    ).count >= 1
    assert (await tester.find_by_key("candle-size")).count == 1

    await wait_until_gone(tester, lambda: tester.find_by_text("Loading…"))

    await wait_until_gone(tester, lambda: tester.find_by_text("Loading…"))


async def test_the_chart_receives_candles(flet_app) -> None:
    tester = flet_app.tester
    await wait_for_pools(tester)
    await tester.tap(await tester.find_by_key("pool-row-0"))

    await wait_for(tester, lambda: tester.find_by_text_containing("LP token"))
    caption = await wait_for(
        tester, lambda: tester.find_by_text_containing(r"[+-]\d+\.\d\d%")
    )
    assert caption.count >= 1, "the chart never reported a series"
