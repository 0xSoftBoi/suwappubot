"""Ordering, searching and number formatting -- the pool list's whole surface."""

from __future__ import annotations

from curve.format import apr_range, compact_usd, percent, short_address, token_amount
from curve.models import Pool
from curve.sort import DEFAULT_SORT, get_sort, search_pools, sort_pools


def make_pool(**kwargs) -> Pool:
    crv = kwargs.pop("crv", [0.0, 0.0])
    raw = {
        "address": kwargs.pop("address", "0x" + "1" * 40),
        "name": kwargs.pop("name", kwargs.get("symbol", "Test Pool")),
        "pool_type": kwargs.pop("registry", "main"),
        "crv_apr": crv[0],
        "crv_apr_boosted": crv[1],
        "extra_rewards_apr": kwargs.pop("rewards", []),
        "merkle_apr": kwargs.pop("merkle", 0.0),
        "tvl_usd": kwargs.pop("tvl", 0.0),
        "trading_volume_24h": kwargs.pop("volume", 0.0),
        "base_weekly_apr": kwargs.pop("base", 0.0),
        "coins": kwargs.pop("coins", [{"symbol": "USDC", "address": "0xa0b8", "decimals": 6}]),
    }
    pool = Pool.from_v2(raw)
    pool.name = kwargs.pop("symbol", pool.name)
    return pool


# -- sorting ---------------------------------------------------------------


def test_default_is_volume() -> None:
    assert DEFAULT_SORT == "volume"
    assert get_sort("volume").key == "volume"


def test_unknown_sort_key_falls_back_to_the_default() -> None:
    assert get_sort("nonsense").key == DEFAULT_SORT


def test_sorts_descending_by_each_column() -> None:
    a = make_pool(symbol="A", volume=100, tvl=1, crv=[0, 1], base=9)
    b = make_pool(symbol="B", volume=1, tvl=100, crv=[0, 9], base=1)
    pools = [a, b]
    assert [p.name for p in sort_pools(pools, "volume")] == ["A", "B"]
    assert [p.name for p in sort_pools(pools, "tvl")] == ["B", "A"]
    assert [p.name for p in sort_pools(pools, "incentives")] == ["B", "A"]
    assert [p.name for p in sort_pools(pools, "base")] == ["A", "B"]


def test_incentives_sort_counts_crv_and_reward_tokens() -> None:
    crv_only = make_pool(symbol="CRVONLY", crv=[0, 5])
    mixed = make_pool(symbol="MIXED", crv=[0, 2], rewards=[{"symbol": "OP", "apr": 4.0}])
    assert [p.name for p in sort_pools([crv_only, mixed], "incentives")] == [
        "MIXED",
        "CRVONLY",
    ]


def test_ties_break_deterministically() -> None:
    a = make_pool(address="0x" + "a" * 40, volume=0, tvl=5)
    b = make_pool(address="0x" + "b" * 40, volume=0, tvl=5)
    c = make_pool(address="0x" + "c" * 40, volume=0, tvl=9)
    once = [p.address for p in sort_pools([a, b, c], "volume")]
    twice = [p.address for p in sort_pools([c, b, a], "volume")]
    assert once == twice
    assert once[0] == c.address  # higher TVL wins the tie


def test_sorting_does_not_mutate_the_input() -> None:
    pools = [make_pool(symbol="A", volume=1), make_pool(symbol="B", volume=2)]
    original = list(pools)
    sort_pools(pools, "volume")
    assert pools == original


# -- searching -------------------------------------------------------------


def test_search_matches_name_symbol_and_coin() -> None:
    pool = make_pool(
        name="Curve.fi DAI/USDC/USDT",
        coins=[{"symbol": "DAI", "address": "0x6B17", "decimals": 18}],
    )
    for query in ("dai/usdc", "CURVE.FI", "dai", "0x6b17"):
        assert search_pools([pool], query) == [pool]


def test_search_matches_a_pasted_pool_address_partially() -> None:
    pool = make_pool(address="0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7")
    assert search_pools([pool], "0xbebc4478") == [pool]
    assert search_pools([pool], pool.address) == [pool]


def test_empty_query_returns_everything() -> None:
    pools = [make_pool(), make_pool()]
    assert search_pools(pools, "   ") == pools


def test_search_that_matches_nothing_returns_empty() -> None:
    assert search_pools([make_pool(name="3Crv")], "zzz") == []


# -- formatting ------------------------------------------------------------


def test_compact_usd_suffixes() -> None:
    assert compact_usd(1_340_000_000) == "$1.34b"
    assert compact_usd(159_976_570) == "$159.98m"
    assert compact_usd(206_900) == "$206.90k"
    assert compact_usd(47.49) == "$47.49"
    assert compact_usd(0) == "$0"


def test_compact_usd_handles_negatives_and_trillions() -> None:
    assert compact_usd(-2_500_000) == "$-2.50m"
    assert compact_usd(3.2e12) == "$3.20t"


def test_percent_marks_tiny_but_nonzero_values() -> None:
    assert percent(0) == "0%"
    assert percent(1.27) == "1.27%"
    assert percent(1.5674e-05) == "< 0.01%"


def test_apr_range_collapses_when_ends_match() -> None:
    assert apr_range(2.93, 7.32) == "2.93% to 7.32%"
    assert apr_range(5.0, 5.0) == "5.00%"
    assert apr_range(0, 0) == "-"


def test_user_visible_strings_stay_within_ascii() -> None:
    samples = [
        apr_range(2.93, 7.32),
        apr_range(5.0, 5.0),
        percent(1.5674e-05),
        compact_usd(1_340_000_000),
        token_amount(25_628_962.988),
    ]
    for text in samples:
        assert text.isascii(), f"non-ASCII in {text!r}"


def test_token_amount_trims_and_groups() -> None:
    assert token_amount(0) == "0"
    assert token_amount(1.5) == "1.5"
    assert token_amount(1.23456789) == "1.2346"
    assert token_amount(25_628_962.988) == "25,628,962.99"


def test_a_holding_too_small_for_four_places_keeps_its_figures() -> None:
    """Eight-decimal coins make this ordinary: a few dollars of tBTC is
    0.0000342 of one, and at four places that is a zero -- which says the
    wallet holds nothing, a different thing from holding a little."""
    assert token_amount(0.0000342) == "0.0000342"
    assert token_amount(0.00000001) == "0.00000001"
    assert token_amount(1.5e-12) == "0.0000000000015"


def test_the_significant_figures_are_the_significant_ones() -> None:
    assert token_amount(0.000123456) == "0.000123"
    assert token_amount(0.000123456, figures=5) == "0.00012346"


def test_places_still_win_where_they_show_more() -> None:
    """Whichever is more, not whichever is fewer: three figures of 0.12345
    would be 0.123, and four places has the better claim."""
    assert token_amount(0.12345) == "0.1235"
    assert token_amount(1.23456789) == "1.2346"


def test_an_exact_quantity_is_not_padded_out_to_look_precise() -> None:
    assert token_amount(0.0001) == "0.0001"
    assert token_amount(0.1) == "0.1"
    assert token_amount(2.0) == "2"


def test_a_negative_smallness_is_still_shown() -> None:
    assert token_amount(-0.0000342) == "-0.0000342"


def test_short_address() -> None:
    assert short_address("0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7") == "0xbEbc…F1C7"
    assert short_address("0x1234") == "0x1234"
