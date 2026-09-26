"""Many routes in a row, in an order nobody chose.

The per-route tests each check one shape.  What they cannot check is what a
sequence does: an allowance left in a strange state, a balance that survives one
call and is spent by the next, dust that accumulates a node at a time.  So this
runs routes in a random order against one market and asserts the two properties
that must hold no matter what ran before -- the router keeps nothing, and no
token is created or destroyed by routing it.
"""

from __future__ import annotations

import boa
from hypothesis import HealthCheck, settings
from hypothesis import strategies as st
from hypothesis.stateful import RuleBasedStateMachine, initialize, invariant, rule

from erouter.core import routecall as rc
from erouter.core.types import ArcKind
from mockworld import build, funded, send

ONE = rc.ONE
SHARE = st.integers(min_value=ONE // 100, max_value=ONE - ONE // 100)
AMOUNT = st.integers(min_value=10**16, max_value=10**19)


def step(pool, kind, **kw):
    return rc.Step(pool=pool.address, kind=kind, **kw)


class Routing(RuleBasedStateMachine):
    """One market, many routes, nothing reset in between."""

    @initialize()
    def setup(self):
        self.world = build()
        self.trader = funded(self.world)
        self.supply = {name: getattr(self.world, name).totalSupply()
                       for name in ("a", "b", "c")}
        self.donated = 0

    # ------------------------------------------------------------- rules

    @rule(share=SHARE, amount=AMOUNT)
    def split_a_into_b(self, share, amount):
        if self.world.a.balanceOf(self.trader) < amount:
            return
        send(self.world, self.trader, [
            step(self.world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3, frac=share),
            step(self.world.crypto, ArcKind.SWAP_CRYPTO, i=0, j=1, n=2, frac=ONE),
        ], amount)
        self.donated = 0

    @rule(amount=AMOUNT)
    def chain_a_to_c(self, amount):
        if self.world.a.balanceOf(self.trader) < amount:
            return
        send(self.world, self.trader, [
            step(self.world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3),
            step(self.world.stable, ArcKind.SWAP_STABLE, i=1, j=2, n=3),
        ], amount)
        self.donated = 0

    @rule(amount=AMOUNT)
    def legacy_c_to_a(self, amount):
        if self.world.c.balanceOf(self.trader) < amount:
            return
        send(self.world, self.trader,
             [step(self.world.legacy, ArcKind.SWAP_STABLE, i=1, j=0, n=2)], amount)

    @rule(amount=AMOUNT)
    def deposit_then_withdraw(self, amount):
        if self.world.a.balanceOf(self.trader) < amount:
            return
        send(self.world, self.trader, [
            step(self.world.stable, ArcKind.DEPOSIT_FIXED, i=0, j=0, n=3),
            step(self.world.stable, ArcKind.WITHDRAW_STABLE, i=0, j=2, n=3),
        ], amount)

    @rule(amount=AMOUNT)
    def wrap_native(self, amount):
        if boa.env.get_balance(self.trader) < amount + 10**18:
            return
        send(self.world, self.trader,
             [step(self.world.weth, ArcKind.WRAP_NATIVE)], amount, value=amount)

    @rule(amount=AMOUNT)
    def unwrap_native(self, amount):
        if self.world.weth.balanceOf(self.trader) < amount:
            return
        send(self.world, self.trader,
             [step(self.world.weth, ArcKind.UNWRAP_NATIVE)], amount)

    @rule(amount=st.integers(min_value=1, max_value=10**12))
    def someone_donates_to_the_router(self, amount):
        """Unowned tokens.  They must leave with the next route through them,
        and until then they must not be counted as anyone's output."""
        self.world.b.mint(self.world.router.address, amount)
        self.supply["b"] += amount
        self.donated += amount

    @rule(amount=AMOUNT)
    def a_donation_leaves_with_the_next_route(self, amount):
        if self.donated == 0 or self.world.a.balanceOf(self.trader) < amount:
            return
        before = self.world.b.balanceOf(self.trader)
        out = send(self.world, self.trader,
                   [step(self.world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)], amount)
        assert self.world.b.balanceOf(self.trader) == before + out + self.donated
        self.donated = 0

    # -------------------------------------------------------- invariants

    @invariant()
    def the_router_keeps_nothing_of_its_own(self):
        """Only what someone pushed in unasked, and only until a route touches it."""
        held = self.world.router.address
        assert self.world.b.balanceOf(held) == self.donated
        assert self.world.a.balanceOf(held) == 0
        assert self.world.c.balanceOf(held) == 0
        assert self.world.weth.balanceOf(held) == 0
        assert boa.env.get_balance(held) == 0

    @invariant()
    def routing_neither_mints_nor_burns(self):
        for name, supply in self.supply.items():
            assert getattr(self.world, name).totalSupply() == supply, (
                f"{name} supply moved from {supply}")


Routing.TestCase.settings = settings(
    max_examples=8,
    stateful_step_count=10,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)
TestRouting = Routing.TestCase
