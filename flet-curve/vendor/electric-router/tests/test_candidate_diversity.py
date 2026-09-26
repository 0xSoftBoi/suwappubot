"""A fixed candidate budget must buy distinguishable candidates (§6.2).

Yen's algorithm returns near-duplicates in `eps` order -- the same route with
one hop swapped -- so consuming the budget in that order buys nested sets that
cover the same few pools.  Measured on mainnet USDC -> crvUSD at $5M: the four
path candidates were unions of the 1, 2, 3 and 4 cheapest paths, the loop broke
at k=4 with 7 arcs, and the 9th path -- through 3pool, which the model prices
at 73% of the trade when it is offered -- never reached the ballot.
"""

from __future__ import annotations

import numpy as np

from erouter.core.candidates import TOP_K, _by_new_pools, _spread


def pools_of(*names: str) -> np.ndarray:
    return np.array(list(names), dtype=object)


def test_the_spread_reaches_the_wide_end_of_the_ladder():
    """A budget of four must not stop at four paths."""
    levels = _spread(TOP_K, 4)
    assert 1 in levels          # C* survives
    assert max(TOP_K) in levels  # and the widest union is reachable
    assert len(levels) == 4


def test_the_spread_degrades_to_the_whole_ladder_when_it_can_afford_it():
    assert _spread(TOP_K, len(TOP_K)) == set(TOP_K)
    assert _spread(TOP_K, 99) == set(TOP_K)


def test_the_spread_is_monotone_in_budget():
    """More budget must never reach less far."""
    for budget in range(2, len(TOP_K) + 1):
        levels = _spread(TOP_K, budget)
        assert len(levels) == min(budget, len(TOP_K))
        assert 1 in levels and max(TOP_K) in levels


def test_the_cheapest_path_stays_first():
    """`C_*` is what a caller unwilling to split gets; it must not move."""
    paths = [[0], [1, 2], [3, 4]]
    pools = pools_of("a", "b", "c", "d", "e")
    assert _by_new_pools(paths, pools)[0] == [0]


def test_a_path_bringing_new_pools_outranks_one_that_repeats_them():
    #  0: pool a          (cheapest, stays first)
    #  1: pools a, b      (re-uses a)
    #  2: pools c, d      (all new)
    paths = [[0], [1, 2], [3, 4]]
    pools = pools_of("a", "a", "b", "c", "d")
    order = _by_new_pools(paths, pools)
    assert order[0] == [0]
    assert order[1] == [3, 4]   # two new pools beats one
    assert order[2] == [1, 2]


def test_reordering_drops_nothing():
    rng = np.random.default_rng(3)
    paths = [[int(x) for x in rng.integers(0, 8, size=2)] for _ in range(6)]
    pools = pools_of(*[f"p{i}" for i in range(8)])
    order = _by_new_pools(paths, pools)
    assert sorted(map(tuple, order)) == sorted(map(tuple, paths))


def test_ties_break_toward_the_cheaper_path():
    """Equal coverage is a tie; `eps` order is the tiebreak, not arbitrary."""
    #  1 and 2 both add exactly one new pool.
    paths = [[0], [1], [2]]
    pools = pools_of("a", "b", "c")
    order = _by_new_pools(paths, pools)
    assert order == [[0], [1], [2]]


def test_two_paths_are_left_alone():
    """Nothing to diversify, and the guard keeps the cheap path first."""
    paths = [[0], [1]]
    pools = pools_of("a", "b")
    assert _by_new_pools(paths, pools) == paths
