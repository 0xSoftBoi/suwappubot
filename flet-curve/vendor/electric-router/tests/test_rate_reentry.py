"""Crossing a rate conversion twice is not re-entering a pool.

A wrap, a lending mint or a vault deposit is priced by a *rate*.  Inside one
static call the second crossing reads exactly what the first did, so the chain
prices it correctly and there is nothing to advance locally.  Measured on
scrvUSD at block 25,800,460: two deposits of 50% and the remainder return
1,807,773.444328, to the wei what a single sweeping leg returns.

Counting them as re-entry was expensive.  `_stateful_leg` refuses a reused
target that is not a stableswap, and `quote_routes` then writes a deliberate
zero rather than asking the chain -- so a route with two `crvUSD -> scrvUSD`
legs was killed outright.  On crvUSD -> sDOLA at $2M that took out five
candidates at once and cost up to 13.6 bp against what the same router found a
few hundred blocks away.
"""

from __future__ import annotations

import pytest

from erouter.chain.exact_probe import RATE_KINDS, ExactQuoterClient
from erouter.core.types import ArcKind, Leg

VAULT = "0x" + "77" * 20
POOL = "0x" + "a1" * 20
OTHER = "0x" + "b2" * 20


def leg(target, kind, src=0, dst=1, bps=0):
    return Leg(target=target, kind=kind, i=0, j=1, n=2,
               src_slot=src, dst_slot=dst, bps=bps)


def test_two_vault_deposits_are_not_a_reused_pool():
    legs = [leg(VAULT, ArcKind.ERC4626_DEPOSIT, bps=3745),
            leg(VAULT, ArcKind.ERC4626_DEPOSIT, bps=0)]
    assert ExactQuoterClient._reused(legs) == set()


def test_two_swaps_of_one_pool_still_are():
    """The guard exists for pools and must keep working for them."""
    legs = [leg(POOL, ArcKind.SWAP_STABLE, bps=5000),
            leg(POOL, ArcKind.SWAP_STABLE, bps=0)]
    assert ExactQuoterClient._reused(legs) == {POOL.lower()}


def test_a_conversion_does_not_mask_a_reused_pool_beside_it():
    legs = [leg(VAULT, ArcKind.ERC4626_DEPOSIT),
            leg(POOL, ArcKind.SWAP_STABLE),
            leg(VAULT, ArcKind.ERC4626_REDEEM),
            leg(POOL, ArcKind.SWAP_CRYPTO),
            leg(OTHER, ArcKind.SWAP_STABLE)]
    assert ExactQuoterClient._reused(legs) == {POOL.lower()}


@pytest.mark.parametrize("kind", sorted(RATE_KINDS))
def test_every_rate_kind_may_be_crossed_twice(kind):
    """Whatever is in the set, being in it has to mean this."""
    assert ExactQuoterClient._reused([leg(VAULT, kind), leg(VAULT, kind)]) == set()


def test_rate_kinds_are_exactly_the_ones_that_are_not_a_market_quote():
    """It coincides with `risk.RISKLESS`, and drifting apart would be a bug.

    They answer different questions -- one asks whether a leg can fail on its
    minimum-out, the other whether a second crossing reads stale state -- but
    both follow from the same property: the output is a rate, not a pool.
    """
    from erouter.core.risk import RISKLESS

    assert RATE_KINDS == RISKLESS


def test_a_pool_swap_is_not_a_rate_kind():
    for kind in (ArcKind.SWAP_STABLE, ArcKind.SWAP_CRYPTO,
                 ArcKind.DEPOSIT_FIXED, ArcKind.WITHDRAW_STABLE):
        assert kind not in RATE_KINDS
