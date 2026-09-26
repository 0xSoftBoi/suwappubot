"""A quote must not depend on what was quoted before it.

`Prepared` is reused across the sizes typed into one interactive session, which
is what makes the second quote fast: probes, calibration and the reference-price
fit are functions of (universe, block), not of the amount.  Anything *else* that
survives from one quote to the next makes the answer a function of history, and
that is invisible from the outside -- both answers are real routes, verified on
chain, and the only symptom is that whichever ran second looks like a regression.

It has happened twice.  §8's refit used to re-anchor `B` from a ladder carrying
the previous quote's probe sizes (26 bp on USDC->CRV $100k).  Then the previous
quote's active set was carried forward as a warm start, which changed which
candidates the truncated re-solves could reach at all: crvUSD -> sDOLA returned
1,415,273.115793 alone and 1,419,036.382808 after a $100k quote in the same
session, 26.5 bp apart.

Both were found by hand.  This states the property instead:

    for any sequence of quotes ending in X, the answer to X is the answer X
    gets alone.

The quoter here is synthetic and deliberately *not* a model of Curve's
arithmetic -- the property under test is invariance, so all it has to be is a
pure function of (legs, amount).
"""

from __future__ import annotations

import pytest

pytest.importorskip("hypothesis")

from hypothesis import HealthCheck, settings
from hypothesis import strategies as st
from hypothesis.stateful import (
    RuleBasedStateMachine,
    initialize,
    invariant,
    rule,
)

from erouter.core.nodes import NodeMap
from erouter.core.pipeline import RoutingError, prepare, route
from erouter.core.pools import Coin, PoolSpec
from erouter.core.quoter import Quote
from erouter.core.transport import Status
from erouter.core.types import Dialect

DECIMALS = 18
UNIT = 10**DECIMALS
#: Big enough that the candidate families truncate.
#
# That is the whole reason the leak existed: with a handful of arcs every
# re-solve runs to completion and the starting basis cannot matter, so a small
# universe makes this test pass on buggy code.  Checked against the commit
# before the fix -- twelve arcs pass, this fails.  `max_candidates`,
# `CANDIDATE_PIVOTS` and the leg limit all have to be reachable.
N_TOKENS = 18
TOKENS = [("0x" + f"{k:02x}" * 20, f"T{k}") for k in range(N_TOKENS)]


def _universe_spec():
    """A fixed pseudo-random web: a chain that guarantees a path, plus chords."""
    import random

    rng = random.Random(7)
    specs = []
    for k in range(N_TOKENS - 1):                 # the spine, so src reaches dst
        specs.append((k, k + 1, rng.uniform(3e5, 6e6), rng.uniform(3e5, 6e6),
                      rng.choice([0.0003, 0.0004, 0.001, 0.002])))
    for _ in range(48):                           # and the alternatives
        i = rng.randrange(N_TOKENS)
        j = rng.randrange(N_TOKENS)
        if i == j:
            continue
        specs.append((i, j, rng.uniform(1e5, 8e6), rng.uniform(1e5, 8e6),
                      rng.choice([0.0003, 0.0004, 0.001, 0.002, 0.004])))
    return specs


POOLS = _universe_spec()


class Curve:
    """`x*y=k` with a fee, in whole tokens, evaluated in floats then floored."""

    def __init__(self, out_reserve: float, in_reserve: float, fee: float):
        self.out, self.inp, self.keep = out_reserve, in_reserve, 1.0 - fee

    def f(self, delta_wei: int) -> int:
        d = self.keep * (delta_wei / UNIT)
        if d <= 0:
            return 0
        return int(self.out * d / (self.inp + d) * UNIT)


def build_universe():
    pools, curves = [], {}
    for k, (i, j, out, inp, fee) in enumerate(POOLS):
        address = "0x" + f"{0xA0 + k:02x}" * 20
        coins = tuple(
            Coin(TOKENS[t][0], TOKENS[t][1], DECIMALS, slot)
            for slot, t in enumerate((i, j))
        )
        spec = PoolSpec(address=address, name=f"pool{k}", pool_type="main",
                        coins=coins, tvl_usd=float(out + inp))
        spec.dialect = Dialect.STABLE
        spec.balances = (int(out * UNIT), int(inp * UNIT))
        pools.append(spec)
        curves[(address.lower(), 0, 1)] = Curve(out, inp, fee)
        curves[(address.lower(), 1, 0)] = Curve(inp, out, fee)

    nodes = NodeMap()
    for spec in pools:
        for coin in spec.coins:
            nodes.add_token(coin.address, coin.symbol, coin.decimals)
    return pools, nodes, curves


class Transport:
    block = 1_000_000
    chain_id = 1


class FakeQuoter:
    """Deterministic, stateless, and counts what it was asked.

    Statelessness is the point: if two runs of the same quote differ, it is not
    because this answered differently.
    """

    local = True
    transport = Transport()

    def __init__(self, curves):
        self.curves = curves
        self.calls = 0

    def probe(self, probes):
        out = []
        for p in probes:
            self.calls += 1
            curve = self.curves.get((p.pool.lower(), p.i, p.j))
            value = curve.f(p.dx) if curve else 0
            out.append(Quote(Status.VALUE if value > 0 else Status.REVERTED, value))
        return out

    def quote_routes(self, routes, amounts, dst_slots):
        return [self._walk(legs, amount, dst)
                for legs, amount, dst in zip(routes, amounts, dst_slots, strict=True)]

    def _walk(self, legs, amount_in: int, dst_slot: int) -> int:
        slots: dict[int, int] = {0: amount_in}
        base: dict[int, int] = {}
        for leg in legs:
            src = getattr(leg, "src_slot", 0)
            have = slots.get(src, 0)
            if have <= 0:
                return 0
            if src not in base:
                base[src] = have
            share = getattr(leg, "bps", 0)
            take = have if not share else min(have, base[src] * share // 10_000)
            curve = self.curves.get((leg.target.lower(), leg.i, leg.j))
            if curve is None or take <= 0:
                return 0
            slots[src] = have - take
            slots[getattr(leg, "dst_slot", 1)] = (
                slots.get(getattr(leg, "dst_slot", 1), 0) + curve.f(take))
        return slots.get(dst_slot, 0)


POOLS_, NODES_, CURVES_ = build_universe()
SRC, DST = TOKENS[0][0], TOKENS[N_TOKENS - 1][0]
#: Sizes spanning four decades -- the dust floor, the caps and the refit's
#: realised delta all scale with the trade, so a session that stays inside one
#: decade would not exercise the machinery that carries state.
SIZES = [1, 100, 10_000, 250_000, 1_000_000]


def quote(amount: int, prepared=None):
    """The whole answer, not just its total.

    Comparing outputs alone is too weak: two different routes can tie to the
    wei, and a leaked active set shows up first as a different *shape*.  The
    legs are what executes, so they are what has to be reproducible.
    """
    client = FakeQuoter(CURVES_)
    try:
        result = route(POOLS_, NODES_, client, src_token=SRC, dst_token=DST,
                       amount_in=amount * UNIT, prepared=prepared,
                       verify_on_chain=True, measure_impact=False)
    except RoutingError as exc:
        return f"error: {exc}"
    legs = tuple(
        (rl.leg.target.lower(), rl.leg.i, rl.leg.j,
         rl.leg.src_slot, rl.leg.dst_slot, rl.leg.bps)
        for rl in result.route.legs
    )
    return (result.verified_out, legs)


ALONE = {size: quote(size) for size in SIZES}


def test_the_universe_routes_at_all():
    """If nothing routes, the invariant below is vacuous."""
    routed = [v for v in ALONE.values() if isinstance(v, tuple) and v[0]]
    assert routed, ALONE
    assert any(len(legs) > 1 for _, legs in routed), "no split to get wrong"


class Session(RuleBasedStateMachine):
    """One interactive session: many sizes through one `Prepared`."""

    def __init__(self):
        super().__init__()
        self.prepared = None
        self.history: list[int] = []

    @initialize()
    def open_session(self):
        self.prepared = prepare(POOLS_, NODES_, FakeQuoter(CURVES_),
                                src_token=SRC, dst_token=DST)

    @rule(size=st.sampled_from(SIZES))
    def ask(self, size):
        got = quote(size, prepared=self.prepared)
        self.history.append(size)
        assert got == ALONE[size], (
            f"{size} returned {got} after {self.history[:-1]}, "
            f"but {ALONE[size]} on its own"
        )

    @invariant()
    def preparation_survives(self):
        if self.prepared is not None:
            # `getattr` so this invariant cannot mask the one that matters when
            # the test is pointed at an older tree that has no `block` field.
            assert getattr(self.prepared, "block", Transport.block) == Transport.block


TestSession = Session.TestCase
TestSession.settings = settings(
    max_examples=25, stateful_step_count=5, deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)


@pytest.mark.parametrize("first", SIZES)
def test_every_size_is_unaffected_by_one_predecessor(first):
    """The two-step case, spelled out so a failure names the pair directly."""
    prepared = prepare(POOLS_, NODES_, FakeQuoter(CURVES_),
                       src_token=SRC, dst_token=DST)
    quote(first, prepared=prepared)
    for size in SIZES:
        assert quote(size, prepared=prepared) == ALONE[size], (
            f"{size} changed after {first}")


def _state(prepared) -> dict:
    """Everything on a `Prepared` that could steer a later quote.

    The property above can only catch a leak that changes the answer *on this
    universe*, and a convex solve that runs to completion is start-independent by
    construction -- which is why the mainnet leak survived a small synthetic
    test.  This asks the structural question instead: after a quote, is the
    preparation the same object it was before?
    """
    from dataclasses import fields

    out: dict = {}
    for field_ in fields(prepared):
        if field_.name in {"quotes", "counters", "warnings"}:
            continue  # counters and messages accumulate by design
        value = getattr(prepared, field_.name)
        if field_.name == "arcs":
            value = tuple(
                (a.id, a.a, a.B, a.cap, a.clamped, a.convex_flag,
                 a.flag_reason, a.calib_delta, a.G, a.eps)
                for a in value
            )
        elif field_.name == "ladders":
            value = tuple(
                (lad.arc.id, tuple(lad.deltas), tuple(lad.quotes)) for lad in value
            )
        elif hasattr(value, "tolist"):
            value = tuple(value.tolist())
        out[field_.name] = value
    return out


@pytest.mark.parametrize("size", SIZES)
def test_a_quote_leaves_the_preparation_alone(size):
    prepared = prepare(POOLS_, NODES_, FakeQuoter(CURVES_),
                       src_token=SRC, dst_token=DST)
    before = _state(prepared)
    quote(size, prepared=prepared)
    after = _state(prepared)
    changed = [k for k in before if before[k] != after[k]]
    assert not changed, f"quoting {size} mutated {changed} on the preparation"


def test_the_preparation_is_reused_rather_than_rebuilt():
    """The guard above must not be satisfied by quietly re-preparing."""
    prepared = prepare(POOLS_, NODES_, FakeQuoter(CURVES_),
                       src_token=SRC, dst_token=DST)
    client = FakeQuoter(CURVES_)
    route(POOLS_, NODES_, client, src_token=SRC, dst_token=DST,
          amount_in=10_000 * UNIT, prepared=prepared, measure_impact=False)
    assert prepared.quotes == 1
