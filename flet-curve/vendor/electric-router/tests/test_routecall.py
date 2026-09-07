"""The packing, the fractions and the bounds -- all of it without a chain.

Every number here is one the router will act on without being able to check it,
so the checks belong on this side.
"""

from __future__ import annotations

import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from erouter.core import routecall as rc
from erouter.core.codec import selector
from erouter.core.realize import RealizedLeg, RealizedRoute
from erouter.core.types import ArcKind, Leg

ONE = rc.ONE
#: Toy amounts still have to be real amounts: a bound is a fraction of a rate,
#: and a rate over a few hundred units is mostly rounding.
UNIT = 10**18
POOL_A = "0x" + "a1" * 20
POOL_B = "0x" + "b2" * 20
TOKEN = {k: "0x" + f"{k:02x}" * 20 for k in range(6)}


def leg(src, dst, amount_in, amount_out, *, kind=ArcKind.SWAP_STABLE, target=POOL_A,
        i=0, j=1, n=2, gamma=math.nan, token_in=None, token_out=None):
    return RealizedLeg(
        leg=Leg(target=target, kind=kind, i=i, j=j, n=n, src_slot=src, dst_slot=dst),
        kind=kind,
        target=target,
        token_in=token_in or TOKEN[src],
        token_out=token_out or TOKEN[dst],
        amount_in=amount_in,
        amount_out=amount_out,
        gamma_live=gamma,
    )


def route(legs, *, amount_in, dst_slot):
    return RealizedRoute(legs=legs, amount_in=amount_in, dst_slot=dst_slot,
                         src_token=TOKEN[0], dst_token=TOKEN[dst_slot],
                         slots={TOKEN[k]: k for k in TOKEN})


# --------------------------------------------------------------- packing


@given(
    frac=st.integers(min_value=1, max_value=ONE),
    min_rate=st.integers(min_value=0, max_value=rc.MAX_RATE),
    i=st.integers(min_value=0, max_value=15),
    j=st.integers(min_value=0, max_value=15),
    n=st.integers(min_value=0, max_value=15),
    kind=st.sampled_from(list(ArcKind)),
    in_ref=st.integers(min_value=0, max_value=rc.MAX_TOKENS),
    out_ref=st.integers(min_value=0, max_value=rc.MAX_TOKENS),
)
def test_a_packed_leg_survives_the_round_trip(frac, min_rate, i, j, n, kind,
                                              in_ref, out_ref):
    step = rc.Step(pool=POOL_A, kind=kind, i=i, j=j, n=n, frac=frac,
                   min_rate=min_rate, in_ref=in_ref, out_ref=out_ref)
    word = step.pack()
    assert word < 1 << 256
    assert rc.unpack(word, POOL_A) == step


MAXIMA = {"i": 15, "j": 15, "n": 15, "frac": ONE, "min_rate": rc.MAX_RATE,
          "in_ref": rc.MAX_TOKENS, "out_ref": rc.MAX_TOKENS}


@pytest.mark.parametrize("field", sorted(MAXIMA))
def test_one_field_at_its_maximum_leaves_the_others_alone(field):
    """The bit layout has no overlap, checked one field at a time."""
    base = {"pool": POOL_A, "kind": ArcKind.SWAP_STABLE, "i": 0, "j": 0, "n": 0,
            "frac": 1, "min_rate": 0, "in_ref": 0, "out_ref": 0}
    back = rc.unpack(rc.Step(**{**base, field: MAXIMA[field]}).pack())
    for name, blank in base.items():
        if name == "pool":
            continue
        want = MAXIMA[field] if name == field else blank
        assert getattr(back, name) == want, f"{field} at max disturbed {name}"


def test_a_word_with_reserved_bits_is_refused():
    with pytest.raises(rc.EncodingError, match="reserved"):
        rc.unpack(1 << rc.RESERVED_SHIFT)


@pytest.mark.parametrize("bad", [
    {"frac": 0}, {"frac": ONE + 1}, {"min_rate": rc.MAX_RATE + 1},
    {"i": 16}, {"in_ref": rc.MAX_TOKENS + 1},
])
def test_out_of_range_fields_are_refused(bad):
    step = rc.Step(pool=POOL_A, kind=ArcKind.SWAP_STABLE, **bad)
    with pytest.raises(rc.EncodingError):
        step.pack()


# --------------------------------------------------------------- fractions


def test_a_split_is_expressed_as_a_share_of_what_is_left():
    """50/50 is 50% then 100%, which is the whole reason for the encoding."""
    legs = [leg(0, 1, 500 * UNIT, 500 * UNIT), leg(0, 2, 500 * UNIT, 500 * UNIT), leg(1, 3, 500 * UNIT, 500 * UNIT),
            leg(2, 3, 500 * UNIT, 500 * UNIT)]
    assert rc.fractions(route(legs, amount_in=1000 * UNIT, dst_slot=3)) == [
        ONE // 2, ONE, ONE, ONE]


def test_a_three_way_split_compounds():
    legs = [leg(0, 1, 250 * UNIT, 250 * UNIT), leg(0, 2, 250 * UNIT, 250 * UNIT), leg(0, 3, 500 * UNIT, 500 * UNIT)]
    fracs = rc.fractions(route(legs, amount_in=1000 * UNIT, dst_slot=3))
    assert fracs == [ONE // 4, ONE // 3, ONE]


def test_the_last_leg_out_of_a_node_always_takes_everything():
    """Anything less strands dust one node at a time."""
    legs = [leg(0, 1, 333 * UNIT, 333 * UNIT), leg(0, 1, 333 * UNIT, 333 * UNIT), leg(0, 1, 334 * UNIT, 334 * UNIT),
            leg(1, 2, 1000 * UNIT, 999 * UNIT)]
    assert rc.fractions(route(legs, amount_in=1000 * UNIT, dst_slot=2))[2] == ONE


@given(shares=st.lists(st.integers(min_value=1, max_value=10**6), min_size=1,
                       max_size=6))
def test_the_fractions_drain_the_node_exactly(shares):
    """Applied in order, the fractions must spend the balance to the wei."""
    total = sum(shares)
    legs = [leg(0, 1, share, share) for share in shares]
    fracs = rc.fractions(route(legs, amount_in=total, dst_slot=1))
    left = total
    for frac in fracs:
        left -= left * frac // ONE
    assert left == 0


# --------------------------------------------------------------- min rates


def test_the_bound_comes_off_the_fee_the_pool_is_charging():
    """20% of a measured 4 bp fee, and nothing else."""
    fee = 4e-4
    legs = [leg(0, 1, 10**18, 10**18, gamma=1 - fee)]
    rates, unbounded = rc.min_rates(route(legs, amount_in=10**18, dst_slot=1))
    assert unbounded == []
    assert rates[0] == pytest.approx(ONE * (1 - 0.2 * fee), rel=1e-9)


def test_a_thin_fee_gets_a_thin_bound_whatever_the_pair():
    """No floor above the dust one: 1 bp of fee buys 0.2 bp of tolerance."""
    legs = [leg(0, 1, 10**18, 10**18, gamma=1 - 1e-4)]
    rates, _ = rc.min_rates(route(legs, amount_in=10**18, dst_slot=1))
    assert rates[0] == pytest.approx(ONE * (1 - 0.2 * 1e-4), rel=1e-9)


def test_a_fat_fee_buys_room_in_proportion():
    """A 100 bp pool grants 20 bp, and costs 200 bp to sandwich."""
    legs = [leg(0, 1, 10**18, 10**18, gamma=1 - 0.01)]
    rates, _ = rc.min_rates(route(legs, amount_in=10**18, dst_slot=1))
    assert rates[0] == pytest.approx(ONE * (1 - 0.2 * 0.01), rel=1e-9)


def test_a_volatile_pair_gets_a_floor_and_a_pegged_one_does_not():
    """5 bp is the allowance for a price that moves on its own between the
    quote and the block, so it is granted where prices do that and nowhere
    else."""
    legs = [leg(0, 1, 10**18, 10**18, gamma=1 - 1e-4)]
    tight, _ = rc.min_rates(route(legs, amount_in=10**18, dst_slot=1))
    loose, _ = rc.min_rates(route(legs, amount_in=10**18, dst_slot=1),
                            volatile=[POOL_A])
    assert tight[0] == pytest.approx(ONE * (1 - 0.2 * 1e-4), rel=1e-9)
    assert loose[0] == pytest.approx(ONE * (1 - rc.VOLATILE_FLOOR_BP / 1e4), rel=1e-9)


def test_a_fee_past_the_floor_ignores_it():
    """Above 25 bp the fee rule already grants more than 5 bp."""
    legs = [leg(0, 1, 10**18, 10**18, gamma=1 - 0.01)]
    both = [rc.min_rates(route(legs, amount_in=10**18, dst_slot=1), volatile=v)[0][0]
            for v in ((), [POOL_A])]
    assert both[0] == both[1]


def test_the_bound_is_set_from_the_least_the_pool_can_charge():
    """Not from what the leg pays: the attacker trades small, and is charged
    small, while the leg it wraps pays the dynamic fee at its own size."""
    legs = [leg(0, 1, 10**18, 10**18, gamma=1 - 4e-4)]
    legs[0].fee_frac = 13e-4        # what this trade pays
    legs[0].fee_floor = 3e-4        # what the pool can drop to
    rates, _ = rc.min_rates(route(legs, amount_in=10**18, dst_slot=1))
    assert rates[0] == pytest.approx(ONE * (1 - 0.2 * 3e-4), rel=1e-9)
    assert rc.leg_fee(legs[0]) == pytest.approx(13e-4)
    assert rc.bounding_fee(legs[0]) == pytest.approx(3e-4)


def test_an_unmeasured_fee_still_leaves_room_for_rounding():
    """A wrap charges nothing and can still arrive a wei short."""
    legs = [leg(0, 1, 10**18, 10**18, kind=ArcKind.WSTETH_WRAP)]
    rates, _ = rc.min_rates(route(legs, amount_in=10**18, dst_slot=1))
    assert 0 < rates[0] < ONE


def test_a_rate_too_large_to_bound_is_refused_not_truncated():
    legs = [leg(0, 1, 1 * UNIT, 10 * UNIT**60)]
    with pytest.raises(rc.EncodingError, match="bits can bound"):
        rc.min_rates(route(legs, amount_in=1 * UNIT, dst_slot=1))


def test_a_rate_below_one_wei_per_unit_is_reported_as_unbounded():
    """Silently shipping a zero bound would read as protection that is not there."""
    legs = [leg(0, 1, 10**30, 10**11)]
    rates, unbounded = rc.min_rates(route(legs, amount_in=10**30, dst_slot=1))
    assert rates[0] == 0 and unbounded == [0]


# --------------------------------------------------------------- encoding


def test_a_swap_route_names_no_tokens_at_all():
    """The short form: pools and one word each, coins read on chain."""
    legs = [leg(0, 1, 1000 * UNIT, 990 * UNIT, gamma=1 - 3e-4),
            leg(1, 2, 990 * UNIT, 980 * UNIT, target=POOL_B, gamma=1 - 3e-4)]
    call = rc.encode_route(route(legs, amount_in=1000 * UNIT, dst_slot=2), receiver=TOKEN[5])
    assert call.tokens == ()
    assert call.pools == (POOL_A, POOL_B)
    assert [s.frac for s in call.steps()] == [ONE, ONE]


def test_a_withdrawal_names_the_lp_token_it_spends():
    """`coins(i)` cannot answer for an LP token, so the caller has to."""
    legs = [leg(0, 1, 1000 * UNIT, 990 * UNIT, kind=ArcKind.WITHDRAW_STABLE, j=1,
                token_in="0x" + "cc" * 20)]
    call = rc.encode_route(route(legs, amount_in=1000 * UNIT, dst_slot=1), receiver=TOKEN[5])
    assert call.tokens == ("0x" + "cc" * 20,)
    assert call.steps()[0].in_ref == 1 and call.steps()[0].out_ref == 0


def test_naming_none_asks_the_chain_for_everything():
    legs = [leg(0, 1, 1000 * UNIT, 990 * UNIT, kind=ArcKind.WITHDRAW_STABLE, j=1,
                token_in="0x" + "cc" * 20)]
    call = rc.encode_route(route(legs, amount_in=1000 * UNIT, dst_slot=1),
                           receiver=TOKEN[5], naming=rc.NONE)
    assert call.tokens == ()


def test_naming_all_names_every_token_once():
    legs = [leg(0, 1, 1000 * UNIT, 990 * UNIT), leg(1, 2, 990 * UNIT, 980 * UNIT, target=POOL_B)]
    call = rc.encode_route(route(legs, amount_in=1000 * UNIT, dst_slot=2),
                           receiver=TOKEN[5], naming=rc.ALL)
    assert call.tokens == (TOKEN[0], TOKEN[1], TOKEN[2])
    assert [(s.in_ref, s.out_ref) for s in call.steps()] == [(1, 2), (2, 3)]


def test_an_adapter_that_is_not_a_wrapper_is_named_even_when_asked_not_to():
    """A 1:1 token adapter wears WRAP_NATIVE and spends no native at all."""
    adapter = "0x" + "ad" * 20
    legs = [leg(0, 1, 1000 * UNIT, 1000 * UNIT, kind=ArcKind.WRAP_NATIVE, target=adapter)]
    call = rc.encode_route(route(legs, amount_in=1000 * UNIT, dst_slot=1),
                           receiver=TOKEN[5], naming=rc.NONE)
    assert call.tokens == (TOKEN[0], TOKEN[1])


def test_a_real_wrapper_names_nothing():
    wrapper = TOKEN[1]
    legs = [leg(0, 1, 1000 * UNIT, 1000 * UNIT, kind=ArcKind.WRAP_NATIVE, target=wrapper,
                token_in=rc.NATIVE)]
    call = rc.encode_route(route(legs, amount_in=1000 * UNIT, dst_slot=1),
                           receiver=TOKEN[5], naming=rc.NONE)
    assert call.tokens == ()


def test_a_route_that_does_not_end_on_its_destination_is_refused():
    legs = [leg(0, 1, 1000 * UNIT, 990 * UNIT), leg(0, 2, 0 * UNIT, 0 * UNIT)]
    with pytest.raises(rc.EncodingError, match="destination"):
        rc.encode_route(route(legs, amount_in=1000 * UNIT, dst_slot=1), receiver=TOKEN[5])


def test_an_alias_pair_has_nothing_to_send():
    with pytest.raises(rc.EncodingError, match="no legs"):
        rc.encode_route(route([], amount_in=1000 * UNIT, dst_slot=0), receiver=TOKEN[5])


# --------------------------------------------------------------- calldata


def test_the_calldata_shrinks_to_the_shortest_form_that_still_means_it():
    legs = [leg(0, 1, 1000 * UNIT, 990 * UNIT)]
    sender = TOKEN[5]
    call = rc.encode_route(route(legs, amount_in=1000 * UNIT, dst_slot=1), receiver=sender)
    short = call.calldata(sender=sender)
    assert short[:4] == selector(rc.SIGNATURES[0])
    assert len(short) < len(call.calldata())


def test_naming_a_token_lengthens_the_selector_as_well_as_the_body():
    legs = [leg(0, 1, 1000 * UNIT, 990 * UNIT)]
    sender = TOKEN[5]
    call = rc.encode_route(route(legs, amount_in=1000 * UNIT, dst_slot=1),
                           receiver=sender, naming=rc.ALL)
    assert call.calldata(sender=sender)[:4] == selector(rc.SIGNATURES[1])


def test_a_min_out_forces_the_full_signature():
    legs = [leg(0, 1, 1000 * UNIT, 990 * UNIT)]
    call = rc.encode_route(route(legs, amount_in=1000 * UNIT, dst_slot=1),
                           receiver=TOKEN[5], min_out=1)
    assert call.calldata(sender=TOKEN[5])[:4] == selector(rc.SIGNATURES[3])


# --------------------------------------------------------------- what is promised


def test_the_bounds_promise_something_and_it_is_computed():
    """The number a caller should read before signing, not after."""
    # Wei-scale amounts, because `guaranteed_out` is integer arithmetic and a
    # thousand-wei leg loses more to truncation than to the bound.
    one, out = 10**21, 980 * 10**18
    legs = [leg(0, 1, one, 990 * 10**18, gamma=1 - 0.01),
            leg(1, 2, 990 * 10**18, out, target=POOL_B, gamma=1 - 0.01)]
    r = route(legs, amount_in=one, dst_slot=2)
    call = rc.encode_route(r, receiver=TOKEN[5], quoted_out=out)
    assert 0 < call.guaranteed_out < out
    # Two legs on 100 bp pools, each granted a fifth: about 40 bp in total.
    assert call.tolerance_bp == pytest.approx(40.0, abs=0.5)


def test_the_promise_matches_running_the_bounds_by_hand():
    legs = [leg(0, 1, 600 * UNIT, 594 * UNIT, gamma=1 - 1e-3), leg(0, 2, 400 * UNIT, 396 * UNIT, gamma=1 - 1e-3),
            leg(1, 3, 594 * UNIT, 590 * UNIT, gamma=1 - 1e-3), leg(2, 3, 396 * UNIT, 393 * UNIT, gamma=1 - 1e-3)]
    r = route(legs, amount_in=1000 * UNIT, dst_slot=3)
    fracs = rc.fractions(r)
    rates, _ = rc.min_rates(r)
    balances = {0: 1000 * UNIT}
    for k, realized in enumerate(legs):
        src, dst = realized.leg.src_slot, realized.leg.dst_slot
        dx = balances.get(src, 0) * fracs[k] // ONE
        balances[src] -= dx
        balances[dst] = balances.get(dst, 0) + dx * rates[k] // ONE
    assert rc.guaranteed_out(r, fracs, rates) == balances[3]


def test_a_deeper_route_promises_less():
    """The tolerance compounds along the path; the number has to show that."""
    one = [leg(0, 1, 1000 * UNIT, 990 * UNIT, gamma=1 - 0.01)]
    two = [leg(0, 1, 1000 * UNIT, 990 * UNIT, gamma=1 - 0.01),
           leg(1, 2, 990 * UNIT, 980 * UNIT, target=POOL_B, gamma=1 - 0.01)]
    calls = []
    for legs, dst in ((one, 1), (two, 2)):
        r = route(legs, amount_in=1000 * UNIT, dst_slot=dst)
        calls.append(rc.encode_route(r, receiver=TOKEN[5],
                                     quoted_out=legs[-1].amount_out))
    assert calls[1].tolerance_bp > calls[0].tolerance_bp


# ------------------------------------------ a bound the token cannot express


def _floor(legs, **kw):
    r = route(legs, amount_in=legs[0].amount_in, dst_slot=1)
    rates, unbounded = rc.min_rates(r, **kw)
    return rc.leg_in(legs[0]) * rates[0] // ONE, unbounded


def test_a_tolerance_finer_than_one_unit_becomes_one_unit():
    """0.8 bp of 1,881 raw units is 0.15 of one, and a rate cannot say that.
    What ships is the tightest rate that still leaves a whole unit -- the
    finest the token has, and enough for the route's own rounding."""
    legs = [leg(0, 1, 18813936625701, 1881, gamma=1 - 4e-4)]
    floor, unbounded = _floor(legs)
    assert floor == 1880, "one unit under the quote, not at it"
    assert unbounded == []


@pytest.mark.parametrize(("have", "want"), [
    (18813936625701, 1881),        # tBTC -> WBTC at $1.45; lands on the quote
    (5055147152544766989, 61),     # one rate step is five units; lands under it
])
def test_the_bound_is_the_largest_rate_that_still_admits_the_quote(have, want):
    """One step higher and the leg could not settle at all.

    Landing *on* the quote is not always reachable: where one step of the rate
    is worth several units of output there is no rate in between, and the
    largest admissible one is the whole of what can be asked for.
    """
    rate = rc.min_rates(route([leg(0, 1, have, want, gamma=1 - 4e-4)],
                              amount_in=have, dst_slot=1))[0][0]
    assert have * rate // ONE <= want - 1
    assert have * (rate + 1) // ONE > want - 1


def test_a_five_unit_leg_keeps_a_unit_back():
    """A five-unit leg quantises so hard that 0.2 bp rounds clean away."""
    legs = [leg(0, 1, 10**18, 5, gamma=1 - 1e-4)]
    floor, unbounded = _floor(legs)
    assert floor == 4 and unbounded == []


def test_no_leg_is_ever_bound_at_its_own_quote():
    """The property the dust route reverted for: a leg with no room at all
    trips on the route's own rounding, with nothing having moved."""
    for have, want in ((18813936625701, 1881), (10**18, 5), (10**18, 3),
                       (10**21, 10**21), (5055147152544766989, 61)):
        floor, _ = _floor([leg(0, 1, have, want, gamma=1 - 4e-4)])
        assert floor < want, f"{have} -> {want} bound at the quote"


def test_a_rate_that_underflows_to_zero_is_still_unbounded():
    """One unit of output against 10 whole units of input: the rate rounds to
    nothing and the check the contract runs is vacuous."""
    legs = [leg(0, 1, 10 * 10**18, 1, gamma=1 - 1e-4)]
    floor, unbounded = _floor(legs)
    assert floor == 0 and unbounded == [0]


def test_a_leg_with_room_to_quantise_keeps_the_fee_rule():
    """Nothing above changes what a leg large enough to say 0.2 bp is granted."""
    legs = [leg(0, 1, 10**18, 10**18, gamma=1 - 1e-4)]
    floor, unbounded = _floor(legs)
    assert unbounded == []
    assert floor == pytest.approx(10**18 * (1 - 0.2e-4), rel=1e-9)


def test_a_coarse_rate_is_reported_at_what_it_really_grants():
    """The other end of the same problem, and the one no check ever saw.

    `min_rate` is `out * 1e18 // in`, so a cheap 18-decimal token into a
    6-decimal one leaves the *rate* with a handful of significant figures: here
    it is 19, one step of which is 5%.  The floor lands 423 bp under the quote
    while the fee rule asked for 0.2, and there is no rate in between -- so the
    only defence is that `tolerance_bp` says 423 and not 0.2.
    """
    legs = [leg(0, 1, 446734325923758040418927, 8862689, gamma=1 - 1e-4)]
    floor, unbounded = _floor(legs)
    assert unbounded == [], "there is a floor, and it is not zero"
    assert 420 < (1 - floor / 8862689) * 1e4 < 430
    r = route(legs, amount_in=446734325923758040418927, dst_slot=1)
    call = rc.encode_route(r, receiver=TOKEN[5], quoted_out=8862689)
    assert 420 < call.tolerance_bp < 430, "the report is the whole protection"


def test_the_granularity_never_loosens_a_leg_that_could_say_more():
    """A volatile pair is granted 5 bp; the unit rule must not cut that to
    one unit of a 4,000-unit output, which would be 2.5 bp."""
    coarse = [leg(0, 1, 10**18, 4_000, gamma=1 - 1e-4)]
    floor, _ = _floor(coarse, volatile=[POOL_A])
    assert floor == 3998, "5 bp of 4,000 units is two of them"


def test_the_walk_reports_what_each_leg_will_really_enforce():
    """`walk_bounds` is the contract's own check, run off chain: `dx` times the
    leg's rate, floored.  On a leg carrying its modelled amount that lands at
    roughly the leg's output, which is what makes it a sanity check rather
    than an alarm."""
    legs = [leg(0, 1, 10**18, 9 * 10**17, gamma=1 - 1e-4)]
    r = route(legs, amount_in=10**18, dst_slot=1)
    fracs, (rates, _) = rc.fractions(r), rc.min_rates(r)
    promised, floors = rc.walk_bounds(r, fracs, rates)
    assert promised == floors[0]
    assert 0.99 < floors[0] / (9 * 10**17) <= 1.0


def test_a_route_with_a_leg_too_small_to_bound_is_refused():
    """A leg worth too little to bound is worth too little to execute, and
    nothing upstream sees it: prune_dust drops branches by their share of a
    node outflow, before anything knows what a leg makes in token units."""
    legs = [leg(0, 1, 10 * 10**18, 1, gamma=1 - 1e-4)]
    r = route(legs, amount_in=10 * 10**18, dst_slot=1)
    with pytest.raises(rc.EncodingError, match="too little"):
        rc.encode_route(r, receiver=TOKEN[5], quoted_out=1)


def test_it_can_still_be_shipped_by_asking_for_it():
    legs = [leg(0, 1, 10 * 10**18, 1, gamma=1 - 1e-4)]
    r = route(legs, amount_in=10 * 10**18, dst_slot=1)
    call = rc.encode_route(r, receiver=TOKEN[5], quoted_out=1,
                           allow_unbounded=True)
    assert call.unbounded == (0,)


def test_a_small_trade_through_a_coarse_intermediate_encodes():
    """The tBTC -> WBTC -> USDT shape at $1.45: the intermediate is 1,881 raw
    units, which no fee-fraction can express and which used to be refused.

    One unit of 1,881 is 5.3 bp, and that is what the caller is told: the
    reported tolerance is the coarse leg's unit compounded with the second
    leg's own fee rule, not the 0.8 bp the fee rule asked for.
    """
    legs = [leg(0, 1, 18813936625701, 1881, gamma=1 - 4e-4),
            leg(1, 2, 1881, 1449003, target=POOL_B, gamma=1 - 4e-4)]
    r = route(legs, amount_in=18813936625701, dst_slot=2)
    call = rc.encode_route(r, receiver=TOKEN[5], quoted_out=1449003)
    assert call.unbounded == ()
    assert 5.9 < call.tolerance_bp < 6.3
