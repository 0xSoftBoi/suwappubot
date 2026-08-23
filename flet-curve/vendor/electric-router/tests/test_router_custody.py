"""Whose coins can the router move?

Only the caller's, and only into the route.  The router holds infinite
allowances to every pool it has ever traded through and users hold allowances to
it, so the two questions worth asking are whether a caller can reach someone
else's balance and whether a pool can reach anything the leg did not offer it.
"""

from __future__ import annotations

import re

import boa
import pytest

from erouter.core import routecall as rc
from erouter.core.types import ArcKind
from mockworld import CONTRACT, build, funded, load, send

ONE = rc.ONE


@pytest.fixture(scope="module")
def router():
    return boa.loads(CONTRACT.read_text(), name="ElectricRouter")


@pytest.fixture
def world(router):
    return build(router)


@pytest.fixture
def trader(world):
    return funded(world)


@pytest.fixture
def victim(world):
    """Someone who has approved the router and is holding tokens."""
    who = boa.env.generate_address()
    world.a.mint(who, 10**22)
    with boa.env.prank(who):
        world.a.approve(world.router.address, 2**256 - 1)
    return who


def step(pool, kind, **kw):
    return rc.Step(pool=pool.address if hasattr(pool, "address") else pool,
                   kind=kind, **kw)


# --------------------------------------------------------------- the source


def test_the_only_pull_the_router_makes_names_msg_sender():
    """A source check as well as a behavioural one: the behavioural tests can
    only probe the paths they think of, and this one covers every future edit.
    """
    source = " ".join(CONTRACT.read_text().split())
    calls = re.findall(r"transferFrom\(\s*([^)]*?)\)", source)
    assert calls, "no transferFrom found -- has the router stopped pulling?"
    assert len(calls) == 1, f"the router pulls in {len(calls)} places: {calls}"
    owner = calls[0].split(",")[0].strip()
    assert owner == "msg.sender", f"transferFrom pulls from {owner!r}"


# --------------------------------------------------------------- callers


def test_a_caller_cannot_spend_someone_else_s_approval(world, trader, victim):
    """The victim has approved the router; the trader must not reach it."""
    before = world.a.balanceOf(victim)
    stranger = boa.env.generate_address()
    with boa.reverts(), boa.env.prank(stranger):
        world.router.execute(
            10**18, [world.stable.address],
            [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3).pack()],
            True, [], stranger, 0)
    assert world.a.balanceOf(victim) == before


def test_naming_the_victim_as_receiver_does_not_reach_their_balance(world, victim):
    """The receiver is who gets paid, never who pays."""
    stranger = boa.env.generate_address()
    before = world.a.balanceOf(victim)
    with boa.reverts(), boa.env.prank(stranger):
        world.router.execute(
            10**18, [world.stable.address],
            [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3).pack()],
            True, [], victim, 0)
    assert world.a.balanceOf(victim) == before


def test_the_router_will_not_pay_itself(world, trader):
    with boa.reverts("bad receiver"), boa.env.prank(trader):
        world.router.execute(
            10**18, [world.stable.address],
            [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3).pack()],
            True, [], world.router.address, 0)


def test_a_route_leaves_nothing_for_the_next_caller_to_take(world, trader):
    """Allowances outlive a call; balances must not."""
    send(world, trader, [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)],
         10**18)
    assert world.is_empty()


# --------------------------------------------------------------- pools


@pytest.fixture
def hostile(world, router):
    pool = load("MockHostilePool", [world.a.address, world.b.address],
                router.address)
    world.b.mint(pool.address, 10**18)
    return pool


def _inner_call(world, who):
    """A perfectly ordinary route, for a pool to try to run from inside one."""
    return rc.RouteCall(
        amount_in=10**18, pools=(world.stable.address,),
        params=(step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3).pack(),),
        receiver=who,
    ).calldata()


def test_a_pool_cannot_call_back_into_the_router(world, trader, hostile):
    """A route holds real balances between legs, and `balanceOf` decides the
    next leg's size -- so a reentrant call would be spending the route's money.
    """
    hostile.arm(1, _inner_call(world, trader), boa.env.generate_address())
    send(world, trader, [step(hostile, ArcKind.SWAP_STABLE, i=0, j=1, n=2)], 10**18)
    assert not hostile.reentered(), "the router answered a pool mid-route"


def test_the_same_call_is_fine_when_it_is_not_reentrant(world, trader):
    """So the refusal above is the lock, and not a mistake in the calldata."""
    with boa.env.prank(trader):
        boa.env.raw_call(world.router.address, data=_inner_call(world, trader))
    assert world.b.balanceOf(trader) > 0


def test_a_pool_can_only_take_what_the_leg_gave_it(world, trader, victim, hostile):
    """The router's allowance to a pool is infinite, so what bounds a hostile
    pool is that the router is holding only this route's money and the victim's
    approval is to the router rather than to the pool.
    """
    before = world.a.balanceOf(victim)
    hostile.arm(2, b"", victim)                              # MODE_SPEND_ALLOWANCE
    with boa.reverts():
        send(world, trader, [step(hostile, ArcKind.SWAP_STABLE, i=0, j=1, n=2)],
             10**18)
    assert world.a.balanceOf(victim) == before
    assert world.a.balanceOf(hostile.address) == 0


def test_an_infinite_allowance_is_worth_nothing_once_the_route_is_over(
        world, trader, hostile):
    """The allowance survives; there is never anything behind it."""
    hostile.arm(0, b"", boa.env.generate_address())
    send(world, trader, [step(hostile, ArcKind.SWAP_STABLE, i=0, j=1, n=2)], 10**18)
    assert world.a.allowance(world.router.address, hostile.address) == 2**256 - 1
    hostile.arm(2, b"", boa.env.generate_address())
    with boa.reverts():                                      # nothing left to take
        hostile.exchange(0, 1, 1, 0, sender=trader)
    assert world.is_empty()


def test_a_token_that_reports_failure_by_returning_false_is_believed(world, trader):
    """The other half of the USDT problem, and the one a bare `raw_call` misses.

    Answering with nothing and answering `False` mean opposite things.  A
    router that decodes neither treats a failed pull as a successful one.
    """
    liar = load("MockLyingToken", True)
    liar.mint(trader, 10**20)
    with boa.env.prank(trader):
        liar.approve(world.router.address, 2**256 - 1)
    pool = load("MockHostilePool", [liar.address, world.b.address],
                world.router.address)
    world.b.mint(pool.address, 10**18)
    with boa.reverts("transferFrom failed"):
        send(world, trader, [step(pool, ArcKind.SWAP_STABLE, i=0, j=1, n=2)], 10**18)


def test_the_same_token_telling_the_truth_goes_through(world, trader):
    """So the refusal above is the reply, not the token."""
    honest = load("MockLyingToken", False)
    honest.mint(trader, 10**20)
    with boa.env.prank(trader):
        honest.approve(world.router.address, 2**256 - 1)
    pool = load("MockHostilePool", [honest.address, world.b.address],
                world.router.address)
    world.b.mint(pool.address, 10**18)
    pool.arm(0, b"", boa.env.generate_address())
    assert send(world, trader,
                [step(pool, ArcKind.SWAP_STABLE, i=0, j=1, n=2)], 10**18) > 0
