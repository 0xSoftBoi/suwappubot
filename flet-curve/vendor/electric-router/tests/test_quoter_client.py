"""QuoterClient end-to-end through the real contract, with no chain.

The unit tests in test_quoter_unit.py drive the contract through boa's own ABI
layer.  These drive it through *our* codec instead, so the calldata we will send
to a real node is the thing being tested.
"""

from __future__ import annotations

import pytest

from erouter.core.transport import Call, Status
from erouter.core.types import ArcKind, Leg, Probe
from erouter.dev.boa_host import BoaHost, runtime_bytecode

ONE = 10**18


@pytest.fixture(scope="module")
def host():
    return BoaHost()


@pytest.fixture(scope="module")
def client(host):
    return host.client()


def test_arckind_matches_the_contract(quoter):
    """Python enum and Vyper constants are one wire format; they cannot drift."""
    for kind in ArcKind:
        assert getattr(quoter, kind.name)() == int(kind), kind.name


def test_status_codes_match_the_contract(quoter):
    assert quoter.STATUS_VALUE() == 0
    assert quoter.STATUS_WRONG_ABI() == 1
    assert quoter.STATUS_REVERTED() == 2


def test_client_limits_match_the_contract(quoter):
    from erouter.core import quoter as qmod

    assert quoter.MAX_PROBES() == qmod.MAX_PROBES
    assert quoter.MAX_LEGS() == qmod.MAX_LEGS
    assert quoter.MAX_ALL_LEGS() == qmod.MAX_ALL_LEGS
    assert quoter.MAX_ROUTES() == qmod.MAX_ROUTES
    assert quoter.MAX_SLOTS() == qmod.MAX_SLOTS


def test_degenerate_legs_are_rejected_at_construction():
    """A swap with i == j reverts on every real pool and would look like a
    plain "unroutable" 0.  Same philosophy as rejecting empty returndata."""
    with pytest.raises(ValueError, match="i != j"):
        Leg("0x" + "11" * 20, ArcKind.SWAP_STABLE, i=1, j=1)
    with pytest.raises(ValueError, match="i != j"):
        Probe("0x" + "11" * 20, ArcKind.SWAP_CRYPTO, 0, 0, 2, ONE)
    with pytest.raises(ValueError, match="between slots"):
        Leg("0x" + "11" * 20, ArcKind.SWAP_STABLE, src_slot=2, dst_slot=2)
    with pytest.raises(ValueError, match="bps"):
        Leg("0x" + "11" * 20, ArcKind.SWAP_STABLE, bps=10_001)
    # ERC4626 and wrap legs legitimately ignore i/j, so they must stay legal.
    Leg("0x" + "11" * 20, ArcKind.ERC4626_DEPOSIT, i=0, j=0)
    Leg("0x" + "11" * 20, ArcKind.WRAP_NATIVE, i=0, j=0)


def test_probe_through_our_codec(client, mock):
    stable = mock("MockStablePool", ONE // 2)
    crypto = mock("MockCryptoPool", 2 * ONE)
    dead = mock("MockRevertPool")

    got = client.probe([
        Probe(stable.address, ArcKind.SWAP_STABLE, 0, 1, 2, ONE),
        Probe(stable.address, ArcKind.SWAP_CRYPTO, 0, 1, 2, ONE),
        Probe(crypto.address, ArcKind.SWAP_CRYPTO, 0, 1, 2, ONE),
        Probe(dead.address, ArcKind.SWAP_STABLE, 0, 1, 2, ONE),
    ])
    assert [q.status for q in got] == [
        Status.VALUE,
        Status.WRONG_ABI,
        Status.VALUE,
        Status.REVERTED,
    ]
    assert got[0].value == ONE // 2
    assert got[2].value == 2 * ONE


def test_probe_chunking_preserves_order(client, mock):
    """More probes than fit in one call must still come back in order."""
    pools = [mock("MockStablePool", (k + 1) * ONE) for k in range(5)]
    probes = [
        Probe(pools[k % 5].address, ArcKind.SWAP_STABLE, 0, 1, 2, ONE) for k in range(40)
    ]
    client.max_probes = 7  # force chunking
    try:
        got = client.probe(probes)
    finally:
        client.max_probes = 600
    assert len(got) == 40
    assert [q.value for q in got] == [((k % 5) + 1) * ONE for k in range(40)]


def test_quote_routes_through_our_codec(client, mock):
    a = mock("MockStablePool", ONE // 2)
    b = mock("MockCryptoPool", 3 * ONE)
    dead = mock("MockRevertPool")

    routes = [
        [
            Leg(a.address, ArcKind.SWAP_STABLE, src_slot=0, dst_slot=1),
            Leg(b.address, ArcKind.SWAP_CRYPTO, src_slot=1, dst_slot=2),
        ],
        [Leg(b.address, ArcKind.SWAP_CRYPTO, src_slot=0, dst_slot=1)],
        [Leg(dead.address, ArcKind.SWAP_STABLE, src_slot=0, dst_slot=1)],
    ]
    got = client.quote_routes(routes, [ONE] * 3, [2, 1, 1])
    assert got == [3 * ONE // 2, 3 * ONE, 0]


def test_quote_routes_chunking_preserves_order(client, mock):
    a = mock("MockStablePool", ONE)
    routes = [[Leg(a.address, ArcKind.SWAP_STABLE, src_slot=0, dst_slot=1)]] * 20
    client.max_routes = 3
    try:
        got = client.quote_routes(routes, [k * ONE for k in range(1, 21)], [1] * 20)
    finally:
        client.max_routes = 32
    assert got == [k * ONE for k in range(1, 21)]


def test_quote_routes_rejects_mismatched_lengths(client):
    with pytest.raises(ValueError):
        client.quote_routes([[]], [ONE, ONE], [1])


def test_raw_reads(client, mock):
    from erouter.core.codec import encode_call

    vault = mock("MockVault", 2 * ONE)
    stable = mock("MockStablePool", ONE)
    got = client.raw([
        Call(vault.address, encode_call("pps()")),
        Call(stable.address, encode_call("get_dy(uint256,uint256,uint256)", 0, 1, ONE)),
    ])
    assert got[0].status is Status.VALUE and got[0].uint() == 2 * ONE
    assert got[1].status is Status.WRONG_ABI


def test_state_override_path_agrees_with_deployment(host, mock):
    """The override backend and the deployed backend must give identical answers.

    This is what lets the CLI trust the fast path: same bytecode, same result,
    whether it was deployed or injected.
    """
    from erouter.core.quoter import QuoterClient

    scratch = "0x" + "ab" * 20
    injected = QuoterClient(
        host, scratch, overrides={scratch: {"code": "0x" + runtime_bytecode().hex()}}
    )
    deployed = host.client()

    stable = mock("MockStablePool", ONE // 3)
    probes = [Probe(stable.address, ArcKind.SWAP_STABLE, 0, 1, 2, 7 * ONE)]
    assert injected.probe(probes) == deployed.probe(probes)

    route = [[Leg(stable.address, ArcKind.SWAP_STABLE, src_slot=0, dst_slot=1)]]
    assert injected.quote_routes(route, [ONE], [1]) == deployed.quote_routes(
        route, [ONE], [1]
    )
