"""`ElectricRouter` against pools that really move tokens, with no chain.

The mocks under `tests/vyper/` are shaped around the four things that make a
real router hard rather than around what is easy to fake: a token that returns
nothing, a token that refuses a second approval, a token that takes a cut of
every transfer, and a pool that answers an unknown selector with success and
does nothing at all.
"""

from __future__ import annotations

import boa
import pytest
from hypothesis import HealthCheck, assume, given, settings
from hypothesis import strategies as st

from erouter.core import routecall as rc
from erouter.core.types import ArcKind
from mockworld import CONTRACT, KEEP, UP, build, funded, load, send

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


def step(pool, kind, **kw):
    return rc.Step(pool=pool.address if hasattr(pool, "address") else pool,
                   kind=kind, **kw)


# --------------------------------------------------------------- one leg


def test_a_single_swap_pays_the_trader(world, trader):
    dx = 10**18
    out = send(world, trader, [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)], dx)
    assert out == dx * (UP * KEEP // 10**18) // 10**18
    assert world.b.balanceOf(trader) == out


def test_the_router_reads_the_coins_off_the_pool(world, trader):
    """Nothing in the calldata says which tokens: `i` and `j` do."""
    call = [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=2, n=3)]
    before = world.c.balanceOf(trader)
    out = send(world, trader, call, 10**18)
    assert out > 0 and world.c.balanceOf(trader) == before + out


def test_naming_the_tokens_gives_the_same_answer(world, trader):
    """The long calldata and the short one must not be two different routes."""
    derived = send(world, trader, [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)],
                   10**18)
    named = send(world, trader,
                 [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3,
                       in_ref=1, out_ref=2)],
                 10**18, tokens=[world.a.address, world.b.address])
    assert derived == named


def test_the_oldest_spelling_of_coins_is_still_found(world, trader):
    """`coins(uint256)` misses on a Vyper 0.1 pool; `coins(int128)` does not."""
    out = send(world, trader, [step(world.legacy, ArcKind.SWAP_STABLE, i=0, j=1, n=2)],
               10**18)
    assert out == 10**18 * KEEP // 10**18


def test_a_pool_that_swallows_the_wrong_selector_is_not_believed(world, trader):
    """The four-argument call succeeds, moves nothing, and must not count."""
    out = send(world, trader, [step(world.crypto, ArcKind.SWAP_CRYPTO, i=0, j=1, n=2)],
               10**18)
    assert out == 10**18 * (UP * KEEP // 10**18) // 10**18


# --------------------------------------------------------------- splits


def test_a_split_takes_half_and_then_the_rest(world, trader):
    """50% then 100%, and the second leg must see what the first left."""
    dx = 10**18
    out = send(world, trader, [
        step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3, frac=ONE // 2),
        step(world.crypto, ArcKind.SWAP_CRYPTO, i=0, j=1, n=2, frac=ONE),
    ], dx)
    one_way = dx // 2 * (UP * KEEP // 10**18) // 10**18
    assert out == 2 * one_way


def test_a_series_feeds_the_next_leg_what_really_arrived(world, trader):
    dx = 10**18
    before = world.c.balanceOf(trader)
    out = send(world, trader, [
        step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3),
        step(world.stable, ArcKind.SWAP_STABLE, i=1, j=2, n=3),
    ], dx)
    mid = dx * (UP * KEEP // 10**18) // 10**18
    assert out == mid * (10**30 * KEEP // 10**18) // 10**18
    assert world.c.balanceOf(trader) == before + out


def test_a_branch_that_splits_and_merges(world, trader):
    dx = 10**18
    before = world.c.balanceOf(trader)
    out = send(world, trader, [
        step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3, frac=ONE // 2),
        step(world.legacy, ArcKind.SWAP_STABLE, i=0, j=1, n=2, frac=ONE),
        step(world.stable, ArcKind.SWAP_STABLE, i=1, j=2, n=3, frac=ONE),
    ], dx)
    assert out > 0
    assert world.c.balanceOf(trader) == before + out
    assert world.b.balanceOf(world.router.address) == 0


@settings(max_examples=25, deadline=None,
          suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(share=st.integers(min_value=ONE // 1000, max_value=ONE - ONE // 1000),
       dx=st.integers(min_value=10**16, max_value=10**20))
def test_any_split_spends_the_input_exactly(world, trader, share, dx):
    """Whatever the split, nothing may be left behind at the source."""
    before = world.a.balanceOf(trader)
    assume(before >= dx)
    send(world, trader, [
        step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3, frac=share),
        step(world.crypto, ArcKind.SWAP_CRYPTO, i=0, j=1, n=2, frac=ONE),
    ], dx)
    assert world.a.balanceOf(world.router.address) == 0
    assert world.a.balanceOf(trader) == before - dx


# --------------------------------------------------------------- bounds


def test_a_leg_below_its_minimum_rate_reverts(world, trader):
    """The pool would have settled; the leg is what refuses."""
    honest = UP * KEEP // 10**18
    with boa.reverts("leg below its minimum rate"):
        send(world, trader, [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3,
                                  min_rate=honest + 1)], 10**18)


def test_a_minimum_rate_the_pool_meets_is_no_obstacle(world, trader):
    honest = UP * KEEP // 10**18
    assert send(world, trader, [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1,
                                     n=3, min_rate=honest)], 10**18) > 0


def test_the_bound_is_per_leg_not_per_route(world, trader):
    """A good second leg cannot pay for a robbed first one."""
    honest = UP * KEEP // 10**18
    with boa.reverts("leg below its minimum rate"):
        send(world, trader, [
            step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3, min_rate=honest + 1),
            step(world.stable, ArcKind.SWAP_STABLE, i=1, j=2, n=3),
        ], 10**18)


def test_min_out_is_checked_on_what_the_route_produced(world, trader):
    with boa.reverts("below min_out"):
        send(world, trader, [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)],
             10**18, min_out=10**18)


def test_a_leg_that_produces_nothing_reverts(world, trader):
    with boa.reverts("leg produced nothing"):
        send(world, trader, [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)], 1)


# --------------------------------------------------------------- approvals


def test_without_approvals_the_first_call_cannot_pay_the_pool(world, trader):
    with boa.reverts():
        send(world, trader, [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)],
             10**18, approvals=False)


def test_an_allowance_set_once_serves_every_later_call(world, trader):
    call = [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)]
    send(world, trader, call, 10**18, approvals=True)
    assert send(world, trader, call, 10**18, approvals=False) > 0


def test_a_token_that_refuses_a_second_approval_is_reset_first(world, trader):
    """USDT's rule: the allowance has to go through zero."""
    send(world, trader, [
        step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3),
        step(world.stable, ArcKind.SWAP_STABLE, i=1, j=2, n=3),
    ], 10**18, approvals=True)
    world.b.approve(world.stable.address, 0, sender=world.router.address)
    assert send(world, trader, [
        step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3),
        step(world.stable, ArcKind.SWAP_STABLE, i=1, j=2, n=3),
    ], 10**18, approvals=True) > 0


def test_a_token_that_returns_nothing_is_not_decoded(world, trader):
    """The silent token is the input here, so `transferFrom` has to survive it."""
    out = send(world, trader, [step(world.legacy, ArcKind.SWAP_STABLE, i=1, j=0, n=2)],
               10**18)
    assert out == 10**18 * KEEP // 10**18


# --------------------------------------------------------------- other kinds


def test_a_deposit_and_a_withdrawal_round_trip_through_the_lp_token(world, trader):
    """Neither leg names the LP token: the pool is its own, and says so."""
    before = world.c.balanceOf(trader)
    out = send(world, trader, [
        step(world.stable, ArcKind.DEPOSIT_FIXED, i=0, j=0, n=3),
        step(world.stable, ArcKind.WITHDRAW_STABLE, i=0, j=2, n=3),
    ], 10**18)
    assert out == 10**18
    assert world.c.balanceOf(trader) == before + out


def test_a_vault_deposit_mints_shares(world, trader):
    """The vault's asset is read off `asset()`; nothing in the calldata says it."""
    out = send(world, trader, [step(world.vault, ArcKind.ERC4626_DEPOSIT)], 10**18)
    assert out == 5 * 10**17
    assert world.vault.balanceOf(trader) == out


def test_a_round_trip_is_reported_as_producing_nothing(world, trader):
    """Out and back is worth zero, and the answer is the delta, not the balance."""
    before = world.a.balanceOf(trader)
    out = send(world, trader, [
        step(world.vault, ArcKind.ERC4626_DEPOSIT),
        step(world.vault, ArcKind.ERC4626_REDEEM),
    ], 10**18)
    assert out == 0
    assert world.a.balanceOf(trader) == before


def test_native_in(world, trader):
    """`coins()` is never asked: a wrapper's input is the sentinel by rule."""
    out = send(world, trader, [
        step(world.weth, ArcKind.WRAP_NATIVE),
    ], 10**17, value=10**17)
    assert out == 10**17 and world.weth.balanceOf(trader) == 10**17


def test_native_out(world, trader):
    world.weth.deposit(value=10**17, sender=trader)
    with boa.env.prank(trader):
        world.weth.approve(world.router.address, 2**256 - 1)
    before = boa.env.get_balance(trader)
    out = send(world, trader, [step(world.weth, ArcKind.UNWRAP_NATIVE)], 10**17)
    assert out == 10**17 and boa.env.get_balance(trader) == before + 10**17


def test_native_sent_to_a_route_that_does_not_want_it_is_refused(world, trader):
    with boa.reverts("route does not spend native"):
        send(world, trader, [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)],
             10**18, value=1)


# --------------------------------------------------------------- hygiene


def test_the_router_keeps_nothing(world, trader):
    send(world, trader, [
        step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3, frac=ONE // 3),
        step(world.crypto, ArcKind.SWAP_CRYPTO, i=0, j=1, n=2, frac=ONE),
        step(world.stable, ArcKind.SWAP_STABLE, i=1, j=2, n=3, frac=ONE),
    ], 10**18)
    assert world.is_empty()


def test_a_donation_is_handed_over_rather_than_kept(world, trader):
    """Whatever the router is holding leaves with the next route, not later."""
    world.b.mint(world.router.address, 12345)
    before = world.b.balanceOf(trader)
    out = send(world, trader, [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)],
               10**18)
    assert world.b.balanceOf(world.router.address) == 0
    # The donation reaches the trader and is *not* counted as this route's work.
    assert world.b.balanceOf(trader) == before + out + 12345


def test_the_proceeds_can_go_somewhere_else(world, trader):
    other = boa.env.generate_address()
    out = send(world, trader, [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)],
               10**18, receiver=other)
    assert world.b.balanceOf(other) == out and world.b.balanceOf(trader) == 0


def test_a_fee_on_transfer_token_is_measured_not_believed(world, router, trader):
    """The pool's own `dy` is a lie here; the balance delta is not."""
    taxed = load("MockToken", 18, False, 100)       # 1% on every transfer
    plain = world.a
    pool = load("MockStableExec", [plain.address, taxed.address, taxed.address],
                 [0, 10**18, 0, 10**18, 0, 0, 0, 0, 0], [10**18] * 3)
    taxed.mint(pool.address, 10**24)
    out = send(world, trader, [step(pool, ArcKind.SWAP_STABLE, i=0, j=1, n=3)], 10**18)
    assert out == 10**18 * 99 // 100


def test_a_reserved_bit_is_refused(world, trader):
    call = [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)]
    word = call[0].pack() | 1 << rc.RESERVED_SHIFT
    with boa.reverts("reserved bits set"), boa.env.prank(trader):
        world.router.execute(10**18, [call[0].pool], [word], True, [], trader, 0)


def test_a_zero_fraction_is_refused(world, trader):
    call = [step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3)]
    word = call[0].pack() & ~((1 << rc.FRAC_BITS) - 1)
    with boa.reverts("frac out of range"), boa.env.prank(trader):
        world.router.execute(10**18, [call[0].pool], [word], True, [], trader, 0)


def test_a_pool_with_no_lp_getter_says_so(world, trader):
    """The fourteen mainnet pools that keep their LP elsewhere land here."""
    with boa.reverts("lp token unknown -- name it in tokens"):
        send(world, trader, [step(world.legacy, ArcKind.WITHDRAW_STABLE, i=0, j=1, n=2)],
             10**18)


@pytest.mark.parametrize("n", [0, 1, 9, 15])
def test_a_deposit_with_an_impossible_coin_count_is_refused(world, trader, n):
    """`N` is part of `add_liquidity`'s signature, so there is a selector for
    2..8 and nothing outside it.  The table has holes; this is the guard."""
    with boa.reverts("coin count outside 2..8"):
        send(world, trader,
             [step(world.stable, ArcKind.DEPOSIT_FIXED, i=0, j=0, n=n)], 10**18)


def test_the_selector_table_agrees_with_the_signature_it_stands_for():
    """A table is only better than a branch if it is indexed right."""
    from erouter.core.codec import selector

    router = boa.loads(CONTRACT.read_text(), name="ElectricRouter")
    for n in range(2, 9):
        want = selector(f"add_liquidity(uint256[{n}],uint256)")
        assert router.eval(f"ADD_LIQUIDITY[{n}]") == want, f"N={n}"


# ------------------------------------------------- pools that hold raw ETH


@pytest.fixture
def native_pool(world):
    """ETH/A, priced one for one, paid in `msg.value` like Curve's stETH pools."""
    pool = load("MockNativePool", world.a.address, [0, 10**18, 10**18, 0])
    world.a.mint(pool.address, 10**24)
    boa.env.set_balance(pool.address, 10**21)
    return pool


def test_a_pool_holding_raw_ether_is_paid_in_value(world, trader, native_pool):
    """`get_dy` prices this identically to any other swap, so nothing upstream
    can see that the pool wants `msg.value` rather than a transfer.  Found by
    executing mainnet WETH -> USDC, which routes through stETH-ng."""
    out = send(world, trader,
               [step(native_pool, ArcKind.SWAP_STABLE, i=0, j=1, n=2)],
               10**18, value=10**18)
    assert out == 10**18
    assert world.a.balanceOf(trader) > 0


def test_a_pool_holding_raw_ether_pays_out_in_value(world, trader, native_pool):
    before = boa.env.get_balance(trader)
    out = send(world, trader,
               [step(native_pool, ArcKind.SWAP_STABLE, i=1, j=0, n=2)], 10**18)
    assert out == 10**18
    assert boa.env.get_balance(trader) == before + 10**18


def test_ether_is_carried_through_a_route_rather_than_only_ending_it(
        world, trader, native_pool):
    """The failing mainnet routes unwrapped mid-route and swapped the ether on,
    which is the case a route that merely *ends* in ether never reaches."""
    world.weth.deposit(value=10**18, sender=trader)
    out = send(world, trader, [
        step(world.weth, ArcKind.UNWRAP_NATIVE),
        step(native_pool, ArcKind.SWAP_STABLE, i=0, j=1, n=2),
        step(world.stable, ArcKind.SWAP_STABLE, i=0, j=1, n=3),
    ], 10**18)
    assert out > 0
    assert world.is_empty()
