"""Are the routes we hand out actually executable?

Everything else here asks the chain a question.  `quote_routes` walks a candidate
with chained `staticcall` and the number that comes back is the verdict -- exact
for a route that touches each pool once, and structurally blind for the three
cases that matter most:

* a pool entered twice, where leg two quotes against state leg one already moved
  -- the reason `decision 3` exists and the reason good routes come back labelled
  `certificate: RESTRICTED`;
* multi-port elements, the same thing under another name;
* anything that reverts only when value really moves -- a paused transfer, a
  deposit cap, a transfer hook.  `get_dy` prices all of them happily.

So these run the winner for real: `boa.fork` at the same pinned block, the input
funded, and genuine calls through `contracts/RouteExecutor.vy`.  The claim is not
that execution is a better quote, but that the route runs at all and the figure
we published was honest.
"""

from __future__ import annotations

import pytest

from erouter.chain.wrappers import build_node_map
from erouter.core.pipeline import RoutingError, route
from erouter.core.pools import parse_universe
from erouter.dev import config
from erouter.dev.executor import Execution, deploy, execute, fork, slot_tokens
from erouter.dev.universe import read_balances, resolve_dialects, resolve_lp_tokens

pytestmark = pytest.mark.forked

USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7"
CRVUSD = "0xf939e0a03fb07f59a73314e73794be0e57ac1b4e"
DAI = "0x6b175474e89094c44da98b954eedeac495271d0f"

# A leg's own arithmetic is wei-exact; what is not is the *model* of a pool
# entered twice.  One bp is far below the 94 bp the reentry supply bug cost and
# far above float noise in the walk.
TOLERANCE_BP = 1.0

CASES = [
    ("USDC -> WETH", USDC, WETH, 250_000 * 10**6),
    ("USDC -> USDT", USDC, USDT, 1_000_000 * 10**6),
    ("DAI -> USDC", DAI, USDC, 500_000 * 10**18),
    ("crvUSD -> WETH", CRVUSD, WETH, 500_000 * 10**18),
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
def routes(universe, quoter_client):
    """Quote every case once; the fork is only opened afterwards."""
    specs, nodes = universe
    out = {}
    for name, src, dst, amount in CASES:
        try:
            out[name] = route(specs, nodes, quoter_client,
                              src_token=src, dst_token=dst, amount_in=amount)
        except RoutingError as exc:
            out[name] = exc
    return out


@pytest.fixture(scope="module")
def forked(rpc, chain):
    """boa needs unrestricted access; the committed scoped endpoint 500s here."""
    if not config.have_networks():
        pytest.skip("networks.py not configured")
    fork(config.rpc_url(chain.rpc_attr), rpc.block)
    return deploy()


@pytest.fixture(scope="module")
def executed(routes, forked, chain, rpc):
    out = {}
    for name, result in routes.items():
        if isinstance(result, RoutingError):
            continue
        out[name] = execute(result.route, executor=forked,
                            quoted_out=result.verified_out,
                            wrapped=chain.wrapped, expect_block=rpc.block)
    return out


@pytest.mark.parametrize("name", [c[0] for c in CASES])
def test_the_route_we_publish_can_be_executed(name, routes, executed):
    result = routes[name]
    if isinstance(result, RoutingError):
        pytest.skip(f"no route for {name}: {result}")
    report = executed[name]
    assert report.ok, (
        f"{name} quoted {result.verified_out:,} and then would not run: "
        f"{report.error}")


@pytest.mark.parametrize("name", [c[0] for c in CASES])
def test_execution_agrees_with_the_quote(name, routes, executed):
    """The quote is what a user is shown, so a gap here is a gap in the promise."""
    result = routes[name]
    if isinstance(result, RoutingError):
        pytest.skip(f"no route for {name}: {result}")
    report = executed[name]
    if not report.ok:
        pytest.skip(f"{name} did not execute; the other test owns that failure")
    assert abs(report.drift_bp) < TOLERANCE_BP, (
        f"{name}: quoted {report.quoted_out:,}, executed {report.executed_out:,}, "
        f"{report.drift_bp:+.4f} bp apart over {report.legs} legs")


def test_the_executor_sweeps_itself_clean(routes, executed, forked):
    """Nothing may be left behind, or the next execution inherits it.

    The contract sweeps every slot back to the caller, so its own balance is
    not a hidden term in anyone's answer.  Checked on the destination token,
    which is the one every route ends on.
    """
    import boa

    live = [n for n, r in executed.items() if r.ok]
    if not live:
        pytest.skip("nothing executed")
    for name in live:
        report = executed[name]
        dst = report.slots[routes[name].route.dst_slot]
        held = boa.loads_abi(
            '[{"name":"balanceOf","outputs":[{"type":"uint256","name":""}],'
            '"inputs":[{"type":"address","name":"o"}],'
            '"stateMutability":"view","type":"function"}]'
        ).at(dst).balanceOf(forked.address)
        assert held == 0, f"{name}: executor kept {held} of {dst}"


def test_the_slot_map_covers_every_leg(routes):
    """Execution needs a token per slot; quoting never did, so nothing checked."""
    for name, result in routes.items():
        if isinstance(result, RoutingError):
            continue
        tokens = slot_tokens(result.route)
        for leg in result.route.wire_legs:
            assert leg.src_slot < len(tokens), f"{name}: src slot off the map"
            assert leg.dst_slot < len(tokens), f"{name}: dst slot off the map"


def test_a_mismatched_block_is_refused_rather_than_compared(routes, forked, rpc):
    """Forking at the wrong block still produces plausible numbers.

    That is the whole danger: nothing reverts, the drift just silently measures
    a market that moved.  So the block is asserted, not assumed.
    """
    live = next((r for r in routes.values() if not isinstance(r, RoutingError)), None)
    if live is None:
        pytest.skip("no route to execute")
    report = execute(live.route, executor=forked, quoted_out=live.verified_out,
                     expect_block=rpc.block + 1)
    assert not report.ok and "pinned to" in report.error, report.error


def test_the_fork_holds_the_clock_still(rpc):
    """A vault that accrues per second must not tick between quote and execution."""
    import boa

    assert int(boa.env.evm.patch.block_number) == rpc.block, (
        "the fork drifted off the quote's block")


def test_a_route_with_no_legs_reports_the_input(chain):
    """An alias pair is its own route: nothing to call, nothing to verify."""
    from erouter.core.realize import RealizedRoute

    empty = RealizedRoute(slots={"0x" + "aa" * 20: 0}, dst_slot=0, amount_in=123)
    report = execute(empty)
    assert isinstance(report, Execution)
    assert report.ok and report.executed_out == 123
