"""One pool, several ports -- the representation and its arithmetic.

The point of an element is that the pool is touched *once*, so the coupling
between its ports is the advancing state rather than a cross-term nobody
modelled.  These tests are about that: an element must equal the legs it
stands for, executed in order, to the wei.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import pytest

from erouter.core.multiport import LP, MultiPort, MultiPortError, Port, element_from, evaluate
from erouter.core.stableswap import StableSwap, StableSwapLP
from erouter.core.types import ArcKind

UNIT = 10**18
POOL = StableSwap(
    balances=(1_000_000 * UNIT, 1_000_000 * UNIT, 1_000_000 * UNIT),
    rates=(UNIT, UNIT, UNIT),
    amp=2000, fee=4_000_000, offpeg_fee_multiplier=0,
    a_precision=1, fee_on_xp=False, admin_fee=5_000_000_000,
)
SUPPLY = 3_000_000 * UNIT
ADDRESS = "0x" + "3c" * 20


def lp():
    return StableSwapLP(pool=POOL, total_supply=SUPPLY)


def element(inputs, outputs, n=3):
    return MultiPort(pool=ADDRESS, n_coins=n, inputs=tuple(inputs),
                     outputs=tuple(outputs))


# --- the port bound ---------------------------------------------------

def test_the_injection_is_what_bounds_the_ports():
    """`#in + #out <= N` is not a separate rule -- it falls out.

    Each coin holds at most one port and every port names a coin in range,
    so there is nowhere for an `N+1`th coin-port to go.  Asking for one on a
    two-coin pool fails as an out-of-range coin, which is the same refusal
    arriving earlier.
    """
    with pytest.raises(MultiPortError, match="out of range"):
        element([Port(0, 10_000)],
                [Port(1, 5_000), Port(2, 5_000)], n=2)


def test_a_coin_may_not_sit_on_both_sides():
    """That is a wash, not an element."""
    with pytest.raises(MultiPortError, match="at most one port"):
        element([Port(0, 10_000)], [Port(0, 5_000), Port(1, 5_000)])


def test_the_lp_port_consumes_no_coin_slot():
    """`add_liquidity` of both coins of a 2-coin pool is a real operation."""
    made = element([Port(0, 5_000), Port(1, 5_000)], [Port(LP, 10_000)], n=2)
    assert made.ports == 3 > made.n_coins


def test_weights_must_be_a_split():
    with pytest.raises(MultiPortError, match="sum to"):
        element([Port(0, 10_000)], [Port(1, 5_000), Port(2, 2_000)])


# --- the arithmetic ---------------------------------------------------

def test_one_in_two_out_equals_the_two_swaps_in_order():
    """The second leg must see what the first one left."""
    made = element([Port(2, 10_000)], [Port(0, 2_500), Port(1, 7_500)])
    dx = 400_000 * UNIT
    outs, _, _ = evaluate(made, POOL, lp(), dx)

    first, after = POOL.exchange(2, 0, dx // 4)
    second, _ = after.exchange(2, 1, dx - dx // 4)
    assert outs == [first, second]


def test_the_ports_are_not_independent():
    """Priced against the block state instead, the answer is different.

    This is the whole reason the element exists: two arcs would each quote
    against the untouched pool and neither would be what executes.
    """
    made = element([Port(2, 10_000)], [Port(0, 5_000), Port(1, 5_000)])
    dx = 600_000 * UNIT
    outs, _, _ = evaluate(made, POOL, lp(), dx)

    naive = [POOL.exchange(2, 0, dx // 2)[0], POOL.exchange(2, 1, dx // 2)[0]]
    assert outs[0] == naive[0], "the first leg is unaffected"
    assert outs[1] != naive[1], (
        "the second leg saw the same pool as the first, so nothing advanced")
    assert outs[1] < naive[1], "the first leg should have made the second worse"


def test_a_coin_and_an_lp_port_together():
    """`XDAI -> 3Crv + USDC.e`, which is the case this was built for."""
    made = element([Port(2, 10_000)], [Port(LP, 5_000), Port(0, 5_000)])
    dx = 200_000 * UNIT
    outs, _, after_lp = evaluate(made, POOL, lp(), dx)

    minted, grown = lp().add_liquidity([0, 0, dx // 2])
    swapped, _ = grown.pool.exchange(2, 0, dx // 2)
    assert outs == [minted, swapped]
    assert after_lp.total_supply > SUPPLY


def test_many_in_one_out_is_a_deposit():
    made = element([Port(0, 2_500), Port(1, 7_500)], [Port(LP, 10_000)])
    dx = 400_000 * UNIT
    outs, _, _ = evaluate(made, POOL, lp(), dx)

    minted, _ = lp().add_liquidity([dx // 4, dx - dx // 4, 0])
    assert outs == [minted]


def test_many_in_many_out_is_refused_rather_than_guessed():
    """It needs a pairing rule between the sides, and there isn't one yet."""
    made = element([Port(0, 5_000), Port(1, 5_000)], [Port(2, 5_000), Port(LP, 5_000)])
    with pytest.raises(MultiPortError, match="pairing rule"):
        evaluate(made, POOL, lp(), 100 * UNIT)


# --- choosing the split -----------------------------------------------

def par(k, amount):
    """Both ports pay a dollar-ish token, so output is comparable."""
    return amount / UNIT


def test_the_best_split_beats_the_halves():
    """Which is the whole reason to optimise rather than bracket."""
    from erouter.core.multiport import best_split

    made = element([Port(2, 10_000)], [Port(0, 5_000), Port(1, 5_000)])
    dx = 900_000 * UNIT
    tuned, best = best_split(made, POOL, lp(), dx, par)

    half, _, _ = evaluate(made, POOL, lp(), dx)
    assert best >= sum(par(k, v) for k, v in enumerate(half))
    assert 1 <= tuned.outputs[0].bps <= 9_999
    assert tuned.outputs[0].bps + tuned.outputs[1].bps == 10_000


def test_the_best_split_beats_the_pin_ladder():
    """§6.3's ladder is a bracket; this is the thing it brackets."""
    from erouter.core.multiport import best_split

    made = element([Port(2, 10_000)], [Port(0, 5_000), Port(1, 5_000)])
    dx = 900_000 * UNIT
    _, best = best_split(made, POOL, lp(), dx, par)

    ladder = []
    for step in (0.125, 0.25, 0.5, 1.0, 2.0):
        bps = int(5_000 * step)
        if not 1 <= bps <= 9_999:
            continue
        outs, _, _ = evaluate(
            element([Port(2, 10_000)], [Port(0, bps), Port(1, 10_000 - bps)]),
            POOL, lp(), dx)
        ladder.append(sum(par(k, v) for k, v in enumerate(outs)))
    assert best >= max(ladder)


def test_a_lopsided_pool_moves_the_split_off_centre():
    """A symmetric answer on an asymmetric pool would mean it is not looking."""
    from erouter.core.multiport import best_split

    lopsided = replace(POOL, balances=(200_000 * UNIT, 1_800_000 * UNIT,
                                       1_000_000 * UNIT))
    made = element([Port(2, 10_000)], [Port(0, 5_000), Port(1, 5_000)])
    tuned, _ = best_split(made, lopsided,
                          StableSwapLP(pool=lopsided, total_supply=SUPPLY),
                          600_000 * UNIT, par)
    assert abs(tuned.outputs[0].bps - 5_000) > 100, (
        f"split stayed at {tuned.outputs[0].bps} bps on a 1:9 pool")


def test_three_ports_are_refused():
    from erouter.core.multiport import best_split

    made = element([Port(2, 10_000)], [Port(0, 5_000), Port(1, 5_000)])
    made = MultiPort(pool=ADDRESS, n_coins=3, inputs=made.inputs,
                     outputs=(Port(0, 3_000), Port(1, 3_000), Port(LP, 4_000)))
    with pytest.raises(MultiPortError, match="one-in two-out"):
        best_split(made, POOL, lp(), 100 * UNIT, par)


# ------------------------------------ the rule that replaced the re-entry one
#
# A pool may appear more than once in a route only when its legs form one
# element.  That is what `check_one_arc_per_pool` and `conflicting_pools` both
# ask now, in place of the old exemption -- "every leg but the last is
# ADVANCEABLE" -- which admitted two arcs priced as independent resistors.



@dataclass
class _Leg:
    leg: object
    kind: ArcKind
    target: str


def _shape(n_coins, *triples):
    return element_from("0x" + "aa" * 20, n_coins, triples)


def test_a_two_coin_pool_cannot_be_re_entered():
    """The case that started this: with N=2 there is one in and one out."""
    with pytest.raises(MultiPortError, match="at most one port"):
        _shape(2, (ArcKind.SWAP_STABLE, 0, 1), (ArcKind.SWAP_STABLE, 1, 0))


def test_one_in_many_out_is_the_shape_that_is_admitted():
    element = _shape(3, (ArcKind.SWAP_STABLE, 0, 1), (ArcKind.SWAP_STABLE, 0, 2))
    assert len(element.inputs) == 1 and len(element.outputs) == 2
    # Three ports on a three-coin pool: `#in + #out <= N` exactly satisfied.
    assert element.ports == 3


def test_the_lp_port_is_free_so_swap_plus_deposit_fits_a_two_coin_pool():
    """The gnosis split: swap through the pool, then deposit into it."""
    element = _shape(2, (ArcKind.SWAP_STABLE, 1, 0), (ArcKind.DEPOSIT_FIXED, 1, 0))
    assert element.ports == 3, "three ports"
    coin_ports = [p.coin for p in element.inputs + element.outputs if p.coin != LP]
    assert len(coin_ports) == 2, "but only two of them are coins, so N=2 holds"


def test_a_coin_on_both_sides_is_a_wash():
    with pytest.raises(MultiPortError, match="at most one port"):
        _shape(3, (ArcKind.SWAP_STABLE, 0, 1), (ArcKind.SWAP_STABLE, 1, 2))


def test_duplicate_ports_are_a_parallel_pair_not_an_element():
    """Two arcs sharing both ports dedupe to 1-in-1-out and must not pass."""
    with pytest.raises(MultiPortError, match="parallel pair"):
        _shape(2, (ArcKind.SWAP_STABLE, 0, 1), (ArcKind.SWAP_STABLE, 0, 1))


def test_many_in_many_out_is_refused_rather_than_paired_by_guess():
    with pytest.raises(MultiPortError, match="pairing rule"):
        _shape(4, (ArcKind.SWAP_STABLE, 0, 1), (ArcKind.SWAP_STABLE, 2, 3))


def test_a_multi_output_withdrawal_is_refused():
    """`evaluate` cannot advance a burn, so two would share one supply."""
    with pytest.raises(MultiPortError, match="cannot be advanced"):
        _shape(2, (ArcKind.WITHDRAW_STABLE, 0, 0), (ArcKind.WITHDRAW_STABLE, 0, 1))
