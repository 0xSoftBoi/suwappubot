"""Dust pruning at realisation (§5.6).

The relaxation is free to put a rounding error on an arc -- nothing in the
objective penalises a branch for being small, and at the optimum a 1e-6 split
is as "optimal" as any other.  The quoter is not so relaxed: a leg whose input
rounds to zero gets a zero quote back, and a zero output on a nonzero input
aborts the whole route.

So an arc too small to change the answer can still destroy it.  Measured on
rETH->WETH, that cost 87 bp -- the best candidate put 7e-6 of one node into a
branch that fed five more legs carrying nothing, one of them quoted zero, and
the candidate was discarded as "reverted".
"""

from __future__ import annotations

import numpy as np

from erouter.core.realize import DUST_SHARE, prune_dust

# src -> mid -> dst, with a dust branch off `mid` feeding a tail through `side`.
#   0 src   1 mid   2 side   3 dst
TAU = np.array([0, 1, 1, 2], dtype=np.int64)
SIG = np.array([1, 3, 2, 3], dtype=np.int64)
SRC, DST = 0, 3


def test_a_dust_branch_and_the_tail_it_feeds_are_both_cut():
    """Cutting the branch without its tail would leave legs quoting on nothing."""
    psi = np.array([1.0, 1.0 - 1e-6, 1e-6, 1e-6])
    pruned, removed = prune_dust(TAU, SIG, psi, SRC, DST)
    assert removed == 2
    assert pruned[2] == 0.0, "the dust branch survived"
    assert pruned[3] == 0.0, "the orphaned tail survived"
    assert pruned[0] > 0 and pruned[1] > 0, "the real route was cut"


def test_a_genuine_split_is_left_alone():
    """The rule may only ever touch branches that cannot matter."""
    psi = np.array([1.0, 0.5, 0.5, 0.5])
    pruned, removed = prune_dust(TAU, SIG, psi, SRC, DST)
    assert removed == 0
    assert np.array_equal(pruned, psi)


def test_a_branch_just_above_the_threshold_survives():
    """The boundary is where it is claimed to be, not an order out."""
    keep = np.array([1.0, 1.0 - 2 * DUST_SHARE, 2 * DUST_SHARE, 2 * DUST_SHARE])
    assert prune_dust(TAU, SIG, keep, SRC, DST)[1] == 0

    cut = np.array([1.0, 1.0 - DUST_SHARE / 2, DUST_SHARE / 2, DUST_SHARE / 2])
    assert prune_dust(TAU, SIG, cut, SRC, DST)[1] == 2


def test_an_arc_on_no_src_to_dst_path_goes_too():
    """A stranded arc has no execution order and quotes on an empty slot."""
    # 2 -> 3 carries flow, but nothing reaches node 2.
    psi = np.array([1.0, 1.0, 0.0, 0.4])
    pruned, removed = prune_dust(TAU, SIG, psi, SRC, DST)
    assert removed == 1
    assert pruned[3] == 0.0


def test_pruning_never_decides_there_is_no_route():
    """If the criterion would empty the flow, the original stands.

    A route the quoter rejects is still adjudicated by the quoter; one that
    never reaches it cannot be.  Here `mid`'s large branch is a dead end, so
    trimming to src->dst paths plus the dust rule would remove everything.
    """
    tau = np.array([0, 1, 1], dtype=np.int64)
    sig = np.array([1, 2, 3], dtype=np.int64)  # 1->2 dead-ends, 1->3 reaches dst
    psi = np.array([1.0, 1.0, 1e-9])
    pruned, removed = prune_dust(tau, sig, psi, SRC, DST)
    assert removed == 0
    assert np.array_equal(pruned, psi)


def test_it_is_idempotent():
    psi = np.array([1.0, 1.0 - 1e-6, 1e-6, 1e-6])
    once, _ = prune_dust(TAU, SIG, psi, SRC, DST)
    twice, again = prune_dust(TAU, SIG, once, SRC, DST)
    assert again == 0
    assert np.array_equal(once, twice)


def test_the_survivors_still_deliver_essentially_everything():
    """What is dropped is handed to the siblings, not lost.

    The quoter splits a node by share of the balance in its slot and the last
    leg of a group sweeps the remainder, so the delivered total is unchanged;
    only the modelled flow shows the gap, and it is bounded by DUST_SHARE.
    """
    psi = np.array([1.0, 1.0 - 1e-6, 1e-6, 1e-6])
    pruned, _ = prune_dust(TAU, SIG, psi, SRC, DST)
    delivered = pruned[SIG == DST].sum()
    assert delivered >= psi[SIG == DST].sum() - DUST_SHARE


def test_an_empty_flow_is_handled():
    empty = np.zeros(4)
    pruned, removed = prune_dust(TAU, SIG, empty, SRC, DST)
    assert removed == 0
    assert not pruned.any()
