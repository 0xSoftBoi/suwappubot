"""The small end of the ladder, where the output token is coarse.

A probe whose answer is a few units of the output token measures rounding, not
a curve.  `plan_deltas` therefore floors the ladder by what the *far* side can
express, not only by what the near side can.
"""

from erouter.core.probe import GRID, MIN_OUT_QUANTA, plan_deltas


def test_a_coarse_output_moves_the_small_end_out():
    # Mainnet GUSD/3Crv: 648,237 3Crv (18 decimals) against 393,473 GUSD (2).
    reserve_in = 648_237 * 10**18
    reserve_out = 393_473 * 10**2

    deltas = plan_deltas(reserve_in, 18, GRID, reserve_out)

    smallest = deltas[0] / 10**18
    answer_units = deltas[0] * reserve_out // reserve_in
    assert answer_units >= MIN_OUT_QUANTA, answer_units
    # And the ladder is still a ladder, spanning decades to the top of the grid.
    assert len(deltas) >= 2
    assert deltas[-1] == int(reserve_in * GRID[-1])
    assert smallest > 1.0, "the 1e-6 node cannot be measured in GUSD"


def test_an_18_decimal_pair_keeps_the_whole_grid():
    reserve_in = reserve_out = 1_000_000 * 10**18

    with_out = plan_deltas(reserve_in, 18, GRID, reserve_out)
    without = plan_deltas(reserve_in, 18, GRID)

    assert with_out == without


def test_no_far_reserve_is_not_a_floor_of_zero():
    """An unknown far side must not silently drop the floor."""
    reserve_in = 1_000_000 * 10**18
    assert plan_deltas(reserve_in, 18, GRID, 0) == plan_deltas(reserve_in, 18, GRID)
