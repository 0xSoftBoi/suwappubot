"""Sandwich a deployed Curve pool, under the bound the router would set.

Everything else about the minimum rates is argued against a model.  This runs
the attack against the real contract -- its own dynamic fee, its own curve --
in the three transactions an attacker would actually send:

    1. attacker  exchange(i, j, front,     0)  -> got_front of coin j
    2. victim    exchange(i, j, victim,    0)  -> got_victim of coin j
    3. attacker  exchange(j, i, got_front, 0)  -> back of coin i

    profit = back - front, in the token the victim was selling.

The victim's leg settles iff `got_victim >= victim * min_rate // 1e18`, which is
`ElectricRouter.execute`'s own check.  The router is deliberately not in the
picture: its arithmetic is tested elsewhere, and one pool is the whole question.

Gas is free here on purpose.  Two extra transactions cost an attacker about a
dollar, which swamps the answer at small sizes and says nothing about whether
the bound works.
"""

from __future__ import annotations

import boa
import pytest

from erouter.chain.tricrypto_params import build_exact_tricrypto
from erouter.core.poolfee import floor_fee
from erouter.core.pools import parse_universe
from erouter.core.realize import RealizedLeg, RealizedRoute
from erouter.core.routecall import FEE_SHARE, ONE, min_rates
from erouter.core.types import ArcKind, Leg
from erouter.dev import config
from erouter.dev.executor import fork
from erouter.dev.universe import read_balances, resolve_dialects

pytestmark = pytest.mark.forked

#: TricryptoUSDC, USDC -> WETH.  A low-fee cryptoswap, which is the shape that
#: sits above `impact = 2 * fee` and is therefore worth attacking at all.
POOL = "0x7f86bf177dd4f3494b841a37e810a34dd56c829b"
COIN_IN, COIN_OUT = 0, 2

EXCHANGE_ABI = """[
 {"name":"exchange","outputs":[],
  "inputs":[{"type":"uint256","name":"i"},{"type":"uint256","name":"j"},
            {"type":"uint256","name":"dx"},{"type":"uint256","name":"min_dy"}],
  "stateMutability":"payable","type":"function"}]"""
ERC20_ABI = """[
 {"name":"balanceOf","outputs":[{"type":"uint256","name":""}],
  "inputs":[{"type":"address","name":"o"}],
  "stateMutability":"view","type":"function"},
 {"name":"approve","outputs":[],
  "inputs":[{"type":"address","name":"s"},{"type":"uint256","name":"v"}],
  "stateMutability":"nonpayable","type":"function"}]"""


@pytest.fixture(scope="module")
def venue(pools, quoter_client, chain, rpc):
    """The pool, its model, and a way to run three swaps against it."""
    specs = parse_universe(pools)
    resolve_dialects(specs, quoter_client, chain)
    read_balances(specs, quoter_client, None, chain.chain_id,
                  token_client=quoter_client)
    spec = next((p for p in specs if p.address.lower() == POOL), None)
    if spec is None:
        pytest.skip("TricryptoUSDC is not in the universe at this block")
    model = build_exact_tricrypto(specs, quoter_client).get(POOL)
    if model is None:
        pytest.skip("TricryptoUSDC has no exact model at this block")
    if not config.have_networks():
        pytest.skip("networks.py not configured")
    fork(config.rpc_url(chain.rpc_attr), rpc.block)
    return spec, model


@pytest.fixture(scope="module")
def sandwich(venue):
    spec, _ = venue
    pool = boa.loads_abi(EXCHANGE_ABI).at(POOL)
    token_in = boa.loads_abi(ERC20_ABI).at(spec.coins[COIN_IN].address)
    token_out = boa.loads_abi(ERC20_ABI).at(spec.coins[COIN_OUT].address)

    def run(front: int, victim: int) -> tuple[int, int]:
        """`(attacker profit in coin i, what the victim received)`."""
        with boa.env.anchor():
            who = boa.env.generate_address()
            boa.env.set_balance(who, 10**20)
            boa.deal(token_in, who, front + victim, adjust_supply=False)
            with boa.env.prank(who):
                token_in.approve(POOL, 2**256 - 1)
                token_out.approve(POOL, 2**256 - 1)

            def swap(a, b, dx):
                got = token_out if b == COIN_OUT else token_in
                before = got.balanceOf(who)
                with boa.env.prank(who):
                    pool.exchange(a, b, dx, 0)
                return got.balanceOf(who) - before

            got_front = swap(COIN_IN, COIN_OUT, front) if front else 0
            got_victim = swap(COIN_IN, COIN_OUT, victim)
            back = swap(COIN_OUT, COIN_IN, got_front) if got_front else 0
            return back - front, got_victim

    return run


def bound_for(amount_in: int, quoted_out: int, fee: float) -> int:
    """The shipped policy, on a pegged pair so only the fee rule speaks."""
    leg = RealizedLeg(
        leg=Leg(target="0x" + "cc" * 20, kind=ArcKind.SWAP_CRYPTO),
        kind=ArcKind.SWAP_CRYPTO, target="0x" + "cc" * 20,
        token_in="0x" + "01" * 20, token_out="0x" + "02" * 20,
        amount_in=amount_in, amount_out=quoted_out, verified_out=quoted_out,
        fee_floor=fee)
    return min_rates(RealizedRoute(legs=[leg], amount_in=amount_in,
                                   dst_slot=1))[0][0]


def ceiling(sandwich, victim: int, floor_out: int, reserve: int) -> int:
    """The largest front-run the victim's bound still settles.

    Profit grows with the front-run, so the ceiling is where the best attack
    sits and there is nowhere else to look.
    """
    lo, hi = 0, reserve // 2
    for _ in range(34):
        mid = (lo + hi) // 2
        if mid == lo:
            break
        try:
            settled = sandwich(mid, victim)[1] >= floor_out
        except Exception:
            settled = False
        lo, hi = (mid, hi) if settled else (lo, mid)
    return lo


#: Leg sizes, as a share of the pool's USDC.  A route splits to keep legs near
#: the low end; the large ones are here to show the trend continues.
SHARES = [0.0001, 0.001, 0.01, 0.05, 0.15]


@pytest.fixture(scope="module")
def attacks(venue, sandwich):
    """The best attack at each size, measured once -- each is ~40 fork swaps."""
    spec, model = venue
    fee = floor_fee(model)
    out = {}
    for share in SHARES:
        victim = int(spec.balances[COIN_IN] * share)
        quote = sandwich(0, victim)[1]
        rate = bound_for(victim, quote, fee)
        floor_out = victim * rate // ONE
        top = ceiling(sandwich, victim, floor_out, spec.balances[COIN_IN])
        profit, got = sandwich(top, victim) if top else (0, quote)
        out[share] = {
            "victim": victim, "quote": quote, "floor_out": floor_out,
            "granted": 1 - rate / (quote * ONE // victim),
            "front": top, "profit": profit, "got": got,
        }
    return out


@pytest.mark.parametrize("share", SHARES)
def test_the_victim_never_settles_below_its_bound(share, attacks, sandwich):
    """The guarantee, against a deployed pool rather than a model of one."""
    at = attacks[share]
    assert at["got"] >= at["floor_out"], (
        f"the best attack settled {at['got']:,} against a bound of "
        f"{at['floor_out']:,}")
    for front in (at["front"] * 3 // 4, at["front"] // 2, at["front"] // 4):
        if front <= 0:
            continue
        assert sandwich(front, at["victim"])[1] >= at["floor_out"]


@pytest.mark.parametrize("share", SHARES)
def test_the_victim_loses_no_more_than_it_allowed(share, attacks):
    """Exactly the promise: settle at `(1 - t)` of the quote, or not at all."""
    at = attacks[share]
    shortfall = (at["quote"] - at["got"]) / at["quote"]
    assert shortfall <= at["granted"] + 1e-9, (
        f"lost {shortfall * 1e4:.4f} bp against a {at['granted'] * 1e4:.4f} bp "
        f"bound")


@pytest.mark.parametrize("share", SHARES)
def test_what_the_attacker_takes_stays_of_the_order_of_the_bound(share, attacks):
    """Gas free, so this is the bound doing the work and nothing else.

    Not asserted equal: the attacker's profit is in USDC and the victim's loss
    is in WETH, converted at a rate the attack itself moved, so the two are the
    same quantity in different money.  Measured across four orders of magnitude
    of leg, the take ran from below the bound up to 1.38 times it.
    """
    at = attacks[share]
    take = at["profit"] / at["victim"]
    assert take <= 2 * at["granted"], (
        f"took {take * 1e4:.2f} bp of the trade against a "
        f"{at['granted'] * 1e4:.2f} bp bound")


def test_the_front_run_is_capped_by_the_bound_and_not_by_the_trade(attacks):
    """Why the bound works at all: the room it grants is a price move, and a
    price move is a function of the attacker's size alone.

    So the capital an attacker may commit is roughly fixed however large the
    trade is -- measured, about 50 USDC across four orders of magnitude of
    victim -- while what they can take scales with the victim.  That is the
    shape of the protection, and the reason gas decides it at small sizes.
    """
    tops = [attacks[share]["front"] for share in (0.001, 0.01, 0.05)]
    assert all(top > 0 for top in tops)
    assert max(tops) / min(tops) < 3, (
        f"front-run ceilings {tops} should barely move with the trade size")


def test_a_small_leg_is_not_worth_attacking_even_for_free(attacks):
    """At the sizes a split route actually produces, the attack loses outright.

    Without paying for a single unit of gas: the front-run the bound permits is
    too small for the displacement to cover its own two fees.
    """
    assert attacks[0.0001]["profit"] <= 0, (
        f"a 0.01% leg paid the attacker {attacks[0.0001]['profit']:,}")


def test_the_bound_is_a_fifth_of_the_pools_least_fee(venue, attacks):
    """And the least fee is `mid_fee`, not what this trade pays."""
    _, model = venue
    granted = attacks[0.01]["granted"]
    assert granted == pytest.approx(FEE_SHARE * floor_fee(model), rel=1e-2)
    assert floor_fee(model) == pytest.approx(model.mid_fee / 1e10)
