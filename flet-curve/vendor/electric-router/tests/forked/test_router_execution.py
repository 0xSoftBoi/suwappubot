"""Real routes, encoded for the router, run for real.

`test_route_execution.py` asks whether a route is executable at all, with every
bound switched off.  This asks the question a user cares about: does the call
they would sign -- packed fractions, a minimum rate on every leg, approvals set
along the way -- deliver what the quote promised, and does the router hand back
everything it touched.

The bounds are what makes this a different test rather than a second copy of
that one.  A minimum rate derived from the modelled amounts and applied to the
executed ones is a live check that the model and the chain agree leg by leg,
not just end to end.
"""

from __future__ import annotations

import math

import pytest

from erouter.chain.exact_probe import ExactQuoterClient
from erouter.chain.stable_params import build_exact_pools
from erouter.chain.tricrypto_params import build_exact_tricrypto
from erouter.chain.twocrypto_params import build_exact_twocrypto
from erouter.chain.wrappers import build_node_map
from erouter.core.pipeline import RoutingError, route
from erouter.core.pools import parse_universe, volatile_pools
from erouter.core.routecall import ALL, NONE, encode_route
from erouter.dev import config
from erouter.dev.executor import fork
from erouter.dev.router import deploy, send
from erouter.dev.universe import read_balances, resolve_dialects, resolve_lp_tokens

pytestmark = pytest.mark.forked

USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7"
CRVUSD = "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e"
DAI = "0x6b175474e89094c44da98b954eedeac495271d0f"
TBTC = "0x18084fba666a33d37592fa2633fd49a74dd93a88"

#: The router's own arithmetic is wei-exact; what is not is the model of a pool
#: entered twice.  Same tolerance as the executor test, for the same reason.
TOLERANCE_BP = 1.0

CASES = [
    ("USDC -> WETH", USDC, WETH, 250_000 * 10**6),
    ("USDC -> USDT", USDC, USDT, 1_000_000 * 10**6),
    ("DAI -> USDC", DAI, USDC, 500_000 * 10**18),
    ("crvUSD -> WETH", CRVUSD, WETH, 500_000 * 10**18),
    # $1.45, and the reason it is here is the intermediate: WBTC has 8
    # decimals, so this leg makes about 1,900 raw units and no fraction of a
    # fee can be expressed against it.  The bound falls back to one unit, and
    # this is what proves that bound is real rather than a way of shipping.
    ("tBTC -> USDT (dust)", TBTC, USDT, 18813936625701),
]


@pytest.fixture(scope="module")
def universe(pools, quoter_client, chain):
    specs = parse_universe(pools)
    resolve_dialects(specs, quoter_client, chain)
    read_balances(specs, quoter_client, None, chain.chain_id,
                  token_client=quoter_client)
    resolve_lp_tokens(specs, quoter_client, chain.chain_id,
                      token_client=quoter_client)
    nodes, _ = build_node_map(specs, chain, quoter_client)
    return specs, nodes


@pytest.fixture(scope="module")
def exact_client(universe, quoter_client):
    """The client the CLI routes with, because the fee at size needs a model.

    A dynamic fee is a property of the trade, and only a pool the wei-exact
    gate admitted can be asked what this trade will pay.  Without the models
    every minimum rate falls back to the marginal fee, which is the case the
    other assertions here would not notice.
    """
    specs, _ = universe
    return ExactQuoterClient(
        quoter_client,
        build_exact_pools(specs, quoter_client),
        build_exact_twocrypto(specs, quoter_client),
        build_exact_tricrypto(specs, quoter_client),
    )


@pytest.fixture(scope="module")
def routes(universe, exact_client):
    specs, nodes = universe
    out = {}
    for name, src, dst, amount in CASES:
        try:
            out[name] = route(specs, nodes, exact_client,
                              src_token=src, dst_token=dst, amount_in=amount)
        except RoutingError as exc:
            out[name] = exc
    return out


@pytest.fixture(scope="module")
def volatile(universe, chain):
    """A currency pair is bounded as a stable one however its pool computes."""
    return volatile_pools(universe[0], chain.stables + chain.forex)


@pytest.fixture(scope="module")
def calls(routes, volatile):
    receiver = "0x" + "11" * 20
    out = {}
    for name, result in routes.items():
        if isinstance(result, RoutingError):
            continue
        out[name] = encode_route(result.route, receiver=receiver,
                                 volatile=volatile)
    return out


@pytest.fixture(scope="module")
def forked(rpc, chain):
    """boa needs unrestricted access; the committed scoped endpoint 500s here."""
    if not config.have_networks():
        pytest.skip("networks.py not configured")
    fork(config.rpc_url(chain.rpc_attr), rpc.block)
    return deploy()


@pytest.fixture(scope="module")
def sent(calls, forked, chain, rpc, routes):
    return {name: send(call, router=forked, quoted_out=routes[name].verified_out,
                       wrapped=chain.wrapped, expect_block=rpc.block)
            for name, call in calls.items()}


def _live(name, routes, sent):
    if isinstance(routes[name], RoutingError):
        pytest.skip(f"no route for {name}: {routes[name]}")
    return sent[name]


@pytest.mark.parametrize("name", [c[0] for c in CASES])
def test_the_route_we_publish_survives_its_own_bounds(name, routes, sent):
    """Every leg carries a minimum rate.  Tripping one here is a real failure."""
    report = _live(name, routes, sent)
    assert report.ok, (
        f"{name} quoted {routes[name].verified_out:,} and the router refused "
        f"it: {report.error}")


@pytest.mark.parametrize("name", [c[0] for c in CASES])
def test_the_router_delivers_what_the_quote_promised(name, routes, sent):
    report = _live(name, routes, sent)
    if not report.ok:
        pytest.skip(f"{name} did not execute; the other test owns that failure")
    assert abs(report.drift_bp) < TOLERANCE_BP, (
        f"{name}: quoted {report.quoted_out:,}, routed {report.amount_out:,}, "
        f"{report.drift_bp:+.4f} bp apart")


def test_the_router_keeps_nothing_of_any_route(calls, sent, forked):
    """Its own balance must never be a hidden term in the next caller's answer."""
    import boa

    erc20 = boa.loads_abi(
        '[{"name":"balanceOf","outputs":[{"type":"uint256","name":""}],'
        '"inputs":[{"type":"address","name":"o"}],'
        '"stateMutability":"view","type":"function"}]')
    live = [n for n, r in sent.items() if r.ok]
    if not live:
        pytest.skip("nothing executed")
    for name in live:
        for token in {calls[name].token_in, calls[name].token_out,
                      *calls[name].tokens}:
            held = erc20.at(token).balanceOf(forked.address)
            assert held == 0, f"{name}: the router kept {held} of {token}"


@pytest.mark.parametrize("name", [c[0] for c in CASES])
def test_the_route_delivers_at_least_what_its_bounds_promised(name, routes, sent, calls):
    """`guaranteed_out` is the router's own arithmetic, run off chain.

    If the executed output ever fell below it, one of the two would be wrong
    about what the contract does -- and the calldata is built from this side.
    """
    report = _live(name, routes, sent)
    if not report.ok:
        pytest.skip(f"{name} did not execute; the other test owns that failure")
    call = calls[name]
    assert report.amount_out >= call.guaranteed_out, (
        f"{name}: routed {report.amount_out:,}, its own bounds promised "
        f"{call.guaranteed_out:,}")
    assert call.tolerance_bp > 0


@pytest.mark.parametrize("name", [c[0] for c in CASES])
def test_every_leg_is_bounded(name, routes, calls):
    """A zero minimum rate is protection that is not there, so it is reported."""
    if isinstance(routes[name], RoutingError):
        pytest.skip(f"no route for {name}")
    call = calls[name]
    assert call.unbounded == (), (
        f"{name}: legs {call.unbounded} could not be bounded; their pairs' "
        f"raw-unit rates fall below 1e-18")


@pytest.mark.parametrize("name", [c[0] for c in CASES])
def test_reading_the_coins_and_naming_them_are_the_same_route(
        name, routes, sent, calls, forked, chain, rpc):
    """The short calldata and the long one must not be two different trades."""
    report = _live(name, routes, sent)
    if not report.ok:
        pytest.skip(f"{name} did not execute; the other test owns that failure")
    explicit = encode_route(routes[name].route, receiver=calls[name].receiver,
                            naming=ALL)
    again = send(explicit, router=forked, wrapped=chain.wrapped,
                 expect_block=rpc.block)
    assert again.ok, f"{name} named every token and would not run: {again.error}"
    assert again.amount_out == report.amount_out


@pytest.mark.parametrize("name", [c[0] for c in CASES])
def test_shorter_calldata_costs_more_gas(name, routes, sent, calls, forked,
                                         chain, rpc):
    """The trade the router is asked to make, from both ends of the trade-off."""
    report = _live(name, routes, sent)
    if not report.ok:
        pytest.skip(f"{name} did not execute; the other test owns that failure")
    shortest = encode_route(routes[name].route, receiver=calls[name].receiver,
                            naming=NONE)
    longest = encode_route(routes[name].route, receiver=calls[name].receiver,
                           naming=ALL)
    short = send(shortest, router=forked, wrapped=chain.wrapped, expect_block=rpc.block)
    long = send(longest, router=forked, wrapped=chain.wrapped, expect_block=rpc.block)
    if not (short.ok and long.ok):
        pytest.skip(f"{name}: one naming did not run ({short.error or long.error})")
    assert short.calldata_bytes <= long.calldata_bytes
    assert short.gas >= long.gas, (
        f"{name}: reading the coins ({short.gas:,}) should not be cheaper than "
        f"being told them ({long.gas:,})")


def test_a_bound_that_cannot_be_met_stops_the_route(routes, calls, forked, chain, rpc):
    """The bounds are load-bearing, not decoration -- so one is made to fail."""
    from dataclasses import replace

    from erouter.core.routecall import unpack

    name = next((n for n in calls if not isinstance(routes[n], RoutingError)), None)
    if name is None:
        pytest.skip("no route to bound")
    call = calls[name]
    first = unpack(call.params[0], call.pools[0])
    impossible = replace(first, min_rate=min(first.min_rate * 2 + 1, (1 << 128) - 1))
    tampered = replace(call, params=(impossible.pack(), *call.params[1:]))
    report = send(tampered, router=forked, wrapped=chain.wrapped, expect_block=rpc.block)
    assert not report.ok and "minimum rate" in report.error, report.error


@pytest.mark.parametrize("name", [c[0] for c in CASES])
def test_the_bounds_are_set_against_the_fee_this_trade_pays(name, routes):
    """A dynamic fee is a property of the trade, not of the pool.

    Measured on mainnet TricryptoUSDC: `mid_fee` 3 bp, `out_fee` 30 bp, and the
    fee it charges runs from 10.5 bp on dust to 29.6 bp at a fifth of reserve.
    Bounding against the marginal figure would set a leg's minimum rate from a
    fee nobody is about to pay.
    """
    if isinstance(routes[name], RoutingError):
        pytest.skip(f"no route for {name}")
    legs = [leg for leg in routes[name].route.legs if not leg.is_conversion]
    priced = [leg for leg in legs if math.isfinite(leg.fee_frac)]
    assert priced, f"{name}: not one leg could be priced at its own size"
    for leg in priced:
        assert 0.0 <= leg.fee_frac < 0.1, (
            f"{name}: {leg.target} charges {leg.fee_frac * 1e4:.2f} bp, which "
            f"is not a fee")


def test_a_dynamic_fee_pool_is_not_priced_at_its_marginal_fee(routes):
    """Somewhere across these routes, the two figures must actually differ."""
    gaps = []
    for result in routes.values():
        if isinstance(result, RoutingError):
            continue
        for leg in result.route.legs:
            if math.isfinite(leg.fee_frac) and math.isfinite(leg.gamma_live):
                gaps.append(abs(leg.fee_frac - (1 - leg.gamma_live)))
    if not gaps:
        pytest.skip("no leg carried both figures")
    assert max(gaps) > 1e-5, (
        "every leg's fee at size equalled its marginal fee -- either the models "
        "are not being asked, or no dynamic-fee pool is on any of these routes")
