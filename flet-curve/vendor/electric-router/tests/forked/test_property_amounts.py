"""Property-based fuzzing over trade size, against the brute-force baselines.

The fixed case list in `test_no_worse_than_naive.py` checks sizes a person
thought of.  The interesting failures are the ones nobody thought of: the wstETH
regression that motivated the two-step floor only appeared above a size
threshold, and was invisible one decade lower.  So the size is drawn instead.

This is affordable because every ladder node is a *fraction of a pool's
reserves*, so the derivative measurement does not depend on the amount being
routed -- one warm snapshot serves every draw, pair and size.  Only candidate
verification is amount-dependent, one round trip per new example.

Amounts are drawn log-uniformly: the failures live at the ends, and a uniform
draw over 8 decades would put essentially every example in the top one.
"""

from __future__ import annotations

import math

import pytest
from hypothesis import HealthCheck, Phase, assume, given, settings
from hypothesis import strategies as st
from naive import naive_direct, naive_two_step
from test_no_worse_than_naive import TIE_SLACK, T

from erouter.chain.wrappers import build_node_map
from erouter.core.pipeline import RoutingError, route
from erouter.core.pools import parse_universe
from erouter.dev.universe import read_balances, resolve_dialects

pytestmark = pytest.mark.forked

# Every route is a fresh solve plus (on a new size) one round trip, so the
# example count is deliberately modest -- these are seconds each, not
# microseconds.  Shrinking replays from cache, so a failure narrows quickly.
FUZZ = settings(
    max_examples=20,
    deadline=None,
    # Draw the *same* sizes every run.  Without this hypothesis re-randomises,
    # every example is a cache miss on candidate verification, and a re-run
    # costs exactly as much as the first (measured: 4m27s against 4m30s).
    # Derandomised plus a pinned `EROUTER_BLOCK`, the suite replays from disk.
    # Pass `--hypothesis-seed=random` to go exploring instead.
    derandomize=True,
    # No shrink phase.  Each example is a full solve plus (on a new size) a
    # round trip, so shrinking a float exponent costs minutes -- measured at
    # 8m49s for one failure, most of it shrinking -- and buys nothing here: the
    # reported size reproduces, and "the same bug 3% lower" is not new
    # information.  The size range is the interesting axis, not its infimum.
    phases=[Phase.explicit, Phase.reuse, Phase.generate, Phase.target],
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
)


@st.composite
def log_amount(draw, lo: float, hi: float, decimals: int) -> int:
    """A size in wei, log-uniform over `[lo, hi]` human units."""
    exponent = draw(st.floats(min_value=math.log10(lo), max_value=math.log10(hi)))
    return int(10.0**exponent * 10**decimals)


class Universe:
    """The pool set, with a short `__repr__`.

    Hypothesis reprs every argument of a failing example, and the raw universe
    renders as 314 kB of addresses -- which it warns about, and which buries the
    one value that matters.  The size is the only interesting argument.
    """

    def __init__(self, specs, nodes):
        self.specs, self.nodes = specs, nodes

    def __repr__(self) -> str:
        return f"<universe {len(self.specs)} pools>"


@pytest.fixture(scope="module")
def universe(pools, quoter_client, chain):
    specs = parse_universe(pools)
    resolve_dialects(specs, quoter_client, chain)
    read_balances(specs, quoter_client)
    nodes, _ = build_node_map(specs, chain, quoter_client)
    return Universe(specs, nodes)


def _route(universe, client, src: str, dst: str, wei: int):
    return route(universe.specs, universe.nodes, client, src_token=T[src][0],
                 dst_token=T[dst][0], amount_in=wei)


# ---------------------------------------------------------------- properties


@given(wei=log_amount(1e2, 5e6, 6))
@FUZZ
def test_stable_pair_never_worse_than_naive(universe, quoter_client, wei):
    """USDC->USDT at any size from $100 to $5M."""
    specs, nodes = universe.specs, universe.nodes
    src, dst = T["USDC"][0], T["USDT"][0]

    best = max(
        naive_direct(specs, nodes, quoter_client, src, dst, wei).amount_out,
        naive_two_step(specs, nodes, quoter_client, src, dst, wei).amount_out,
    )
    assume(best > 0)

    got = _route(universe, quoter_client, "USDC", "USDT", wei).verified_out or 0
    assert got >= best * (1 - TIE_SLACK), (
        f"{wei / 1e6:,.2f} USDC->USDT: router {got} < naive {best} "
        f"({(got / best - 1) * 1e4:+.2f} bp)"
    )


@given(wei=log_amount(1e3, 2e6, 6))
@FUZZ
def test_cross_asset_never_worse_than_naive(universe, quoter_client, wei):
    """USDC->WETH: two different asset classes, so the route is multi-hop."""
    specs, nodes = universe.specs, universe.nodes
    src, dst = T["USDC"][0], T["WETH"][0]

    best = max(
        naive_direct(specs, nodes, quoter_client, src, dst, wei).amount_out,
        naive_two_step(specs, nodes, quoter_client, src, dst, wei).amount_out,
    )
    assume(best > 0)

    got = _route(universe, quoter_client, "USDC", "WETH", wei).verified_out or 0
    assert got >= best * (1 - TIE_SLACK), (
        f"{wei / 1e6:,.2f} USDC->WETH: router {got} < naive {best} "
        f"({(got / best - 1) * 1e4:+.2f} bp)"
    )


@given(wei=log_amount(1e2, 1e6, 6))
@FUZZ
def test_output_is_monotone_in_input(universe, quoter_client, wei):
    """Doubling the input must not reduce the output.

    Not a statement about AMMs -- where it is trivially true -- but about the
    *router*, which re-solves from scratch at every size and could in principle
    pick a worse family of candidates for the larger trade.
    """
    small = _route(universe, quoter_client, "USDC", "USDT", wei).verified_out or 0
    large = _route(universe, quoter_client, "USDC", "USDT", 2 * wei).verified_out or 0
    assume(small > 0)
    assert large > small, (
        f"{wei / 1e6:,.2f} USDC -> {small}, but {2 * wei / 1e6:,.2f} USDC -> {large}"
    )


@given(wei=log_amount(1e2, 5e6, 6))
@FUZZ
def test_route_is_deterministic(universe, quoter_client, wei):
    """The same size at the same block must give the same answer, twice.

    §15 wants byte-identical output at a pinned block; anything order-dependent
    in candidate generation shows up here first.
    """
    first = _route(universe, quoter_client, "USDC", "USDT", wei)
    second = _route(universe, quoter_client, "USDC", "USDT", wei)
    assert first.verified_out == second.verified_out
    assert [leg.as_tuple() for leg in first.route.wire_legs] == [
        leg.as_tuple() for leg in second.route.wire_legs
    ]


@given(wei=log_amount(1e0, 1e7, 6))
@FUZZ
def test_never_raises_on_a_liquid_pair(universe, quoter_client, wei):
    """From $1 to $10M, a deep pair must always produce something positive."""
    try:
        result = _route(universe, quoter_client, "USDC", "USDT", wei)
    except RoutingError as exc:
        pytest.fail(f"{wei / 1e6:,.6f} USDC->USDT raised: {exc}")
    assert (result.verified_out or 0) > 0
