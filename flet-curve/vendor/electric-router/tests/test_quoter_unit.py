"""RouteQuoter.vy against mock pools, in boa's local EVM.  No chain needed."""

from __future__ import annotations

import pytest

ONE = 10**18

# Leg kinds -- mirrored from the contract.
SWAP_STABLE, SWAP_CRYPTO = 0, 1
ERC4626_DEPOSIT, ERC4626_REDEEM = 7, 8
WRAP_NATIVE, UNWRAP_NATIVE = 9, 10

# Res.status
VALUE, WRONG_ABI, REVERTED = 0, 1, 2


def leg(target, kind, *, i=0, j=1, n=2, src=0, dst=1, bps=0):
    return (target, kind, i, j, n, src, dst, bps)


def probe(pool, kind, dx, *, i=0, j=1, n=2):
    return (pool, kind, i, j, n, dx)


# --------------------------------------------------------------- dispatch


def test_probe_classifies_value_wrong_abi_and_reverted(quoter, mock):
    """The three-state result is the whole reason this contract exists."""
    stable = mock("MockStablePool", ONE // 2)
    crypto = mock("MockCryptoPool", 2 * ONE)
    dead = mock("MockRevertPool")

    res = quoter.probe_batch([
        probe(stable.address, SWAP_STABLE, ONE),   # right dialect
        probe(stable.address, SWAP_CRYPTO, ONE),   # wrong dialect -> empty data
        probe(crypto.address, SWAP_CRYPTO, ONE),   # right dialect
        probe(crypto.address, SWAP_STABLE, ONE),   # wrong dialect -> empty data
        probe(dead.address, SWAP_STABLE, ONE),     # implemented, but reverts
    ])

    assert [r[0] for r in res] == [VALUE, WRONG_ABI, VALUE, WRONG_ABI, REVERTED]
    assert res[0][1] == ONE // 2
    assert res[2][1] == 2 * ONE
    # The trap: an unimplemented function returns empty, and decoding that as a
    # uint would give a perfectly plausible zero quote.
    assert res[1][1] == 0 and res[1][0] != VALUE


def test_reverted_and_wrong_abi_are_not_interchangeable(quoter, mock):
    """A pool that reverts is live-but-unusable; empty data is a dispatch bug."""
    stable = mock("MockStablePool", ONE)
    dead = mock("MockRevertPool")
    res = quoter.probe_batch([
        probe(stable.address, SWAP_CRYPTO, ONE),
        probe(dead.address, SWAP_CRYPTO, ONE),
    ])
    assert res[0][0] == WRONG_ABI  # succeeded, said nothing
    assert res[1][0] == REVERTED  # no default function, so the call reverts


def test_erc4626_and_wrap_kinds(quoter, mock):
    vault = mock("MockVault", 11 * ONE // 10)  # 1.1 assets per share
    res = quoter.probe_batch([
        probe(vault.address, ERC4626_DEPOSIT, ONE),
        probe(vault.address, ERC4626_REDEEM, ONE),
    ])
    assert res[0] == (VALUE, ONE * ONE // (11 * ONE // 10))
    assert res[1] == (VALUE, 11 * ONE // 10)


def test_wrap_is_one_to_one_without_a_call(quoter):
    """Wrapped natives need no external call, so the target can be anything."""
    zero = "0x" + "00" * 20
    res = quoter.probe_batch([
        probe(zero, WRAP_NATIVE, 12345),
        probe(zero, UNWRAP_NATIVE, 12345),
    ])
    assert [r[1] for r in res] == [12345, 12345]


# ------------------------------------------------------------------ routing


def test_series_chains_hop_outputs(quoter, mock):
    """Hop 2's input is hop 1's *output*, which a plain multicall cannot express."""
    first = mock("MockStablePool", ONE // 2)  # halves
    second = mock("MockCryptoPool", 3 * ONE)  # triples

    out = quoter.quote_route(
        [
            leg(first.address, SWAP_STABLE, src=0, dst=1),
            leg(second.address, SWAP_CRYPTO, src=1, dst=2),
        ],
        1000 * ONE,
        2,
    )
    assert out == 1500 * ONE  # 1000 -> 500 -> 1500


def test_parallel_split_by_bps_and_remainder_sweep(quoter, mock):
    a = mock("MockStablePool", ONE)
    b = mock("MockCryptoPool", ONE)

    out = quoter.quote_route(
        [
            leg(a.address, SWAP_STABLE, src=0, dst=1, bps=3000),
            leg(b.address, SWAP_CRYPTO, src=0, dst=1, bps=0),  # sweeps the rest
        ],
        1000 * ONE,
        1,
    )
    assert out == 1000 * ONE  # 300 + 700, nothing lost to dust


def test_bps_is_taken_against_the_group_snapshot(quoter, mock):
    """Three-way split must be 20/30/50 of the original, not of the remainder."""
    a = mock("MockStablePool", ONE)
    b = mock("MockCryptoPool", 2 * ONE)
    c = mock("MockCryptoPool", 3 * ONE)

    out = quoter.quote_route(
        [
            leg(a.address, SWAP_STABLE, src=0, dst=1, bps=2000),
            leg(b.address, SWAP_CRYPTO, src=0, dst=1, bps=3000),
            leg(c.address, SWAP_CRYPTO, src=0, dst=1, bps=0),
        ],
        1000 * ONE,
        1,
    )
    # 200*1 + 300*2 + 500*3 = 2300.  Draining-order-dependent maths would give
    # 200*1 + 240*2 + ... instead.
    assert out == 2300 * ONE


def test_mid_path_branch_and_merge(quoter, mock):
    """A hybrid DAG: split at src, one branch splits *again* mid-route, all merge.

    This is the topology the edge-flow formulation produces generically, and the
    reason the quoter walks a DAG with slot accumulators rather than a path list.
    """
    direct = mock("MockStablePool", ONE)          # slot0 -> slot3
    to_mid = mock("MockCryptoPool", 2 * ONE)      # slot0 -> slot1 (a mid node)
    mid_a = mock("MockStablePool", ONE // 2)      # slot1 -> slot3
    mid_b = mock("MockCryptoPool", 4 * ONE)       # slot1 -> slot3

    out = quoter.quote_route(
        [
            leg(direct.address, SWAP_STABLE, src=0, dst=3, bps=5000),
            leg(to_mid.address, SWAP_CRYPTO, src=0, dst=1, bps=0),
            leg(mid_a.address, SWAP_STABLE, src=1, dst=3, bps=2500),
            leg(mid_b.address, SWAP_CRYPTO, src=1, dst=3, bps=0),
        ],
        1000 * ONE,
        3,
    )
    # direct: 500*1 = 500
    # to_mid: 500*2 = 1000 at the mid node, split 25/75:
    #   mid_a: 250*0.5 = 125 ; mid_b: 750*4 = 3000
    assert out == (500 + 125 + 3000) * ONE


def test_dead_leg_kills_the_route(quoter, mock):
    good = mock("MockStablePool", ONE)
    dead = mock("MockRevertPool")

    assert quoter.quote_route(
        [
            leg(good.address, SWAP_STABLE, src=0, dst=1),
            leg(dead.address, SWAP_STABLE, src=1, dst=2),
        ],
        ONE,
        2,
    ) == 0


def test_wrong_dialect_kills_the_route_rather_than_quoting_zero(quoter, mock):
    """Without the empty-data check this would return a plausible 0 silently."""
    stable = mock("MockStablePool", ONE)
    assert quoter.quote_route([leg(stable.address, SWAP_CRYPTO)], ONE, 1) == 0


# ------------------------------------------------------- candidate batching


def test_quote_routes_evaluates_many_candidates_in_one_call(quoter, mock):
    a = mock("MockStablePool", ONE // 2)
    b = mock("MockCryptoPool", 3 * ONE)
    dead = mock("MockRevertPool")

    legs = [
        # candidate 0: a then b
        leg(a.address, SWAP_STABLE, src=0, dst=1),
        leg(b.address, SWAP_CRYPTO, src=1, dst=2),
        # candidate 1: b alone
        leg(b.address, SWAP_CRYPTO, src=0, dst=1),
        # candidate 2: reverts
        leg(dead.address, SWAP_STABLE, src=0, dst=1),
    ]
    outs = quoter.quote_routes(legs, [2, 3, 4], [ONE, ONE, ONE], [2, 1, 1])
    assert outs == [3 * ONE // 2, 3 * ONE, 0]


def test_quote_routes_rejects_ragged_inputs(quoter):
    import boa

    with pytest.raises(boa.BoaError, match="bounds/amounts length"):
        quoter.quote_routes([], [1, 2], [ONE], [0, 0])


# ------------------------------------------------------------- raw batching


def test_raw_batch_classifies_like_probe(quoter, mock):
    from erouter.core.codec import encode_call

    stable = mock("MockStablePool", ONE)
    dead = mock("MockRevertPool")
    right = encode_call("get_dy(int128,int128,uint256)", 0, 1, ONE)
    wrong = encode_call("get_dy(uint256,uint256,uint256)", 0, 1, ONE)

    res = quoter.raw_batch(
        [stable.address, stable.address, dead.address],
        [right, wrong, right],
    )
    assert [r[0] for r in res] == [VALUE, WRONG_ABI, REVERTED]
    assert res[0][1] == ONE


def test_raw_batch_reads_a_plain_getter(quoter, mock):
    """The `balances(uint256)` vs `balances(int128)` resolution path."""
    from erouter.core.codec import encode_call

    vault = mock("MockVault", 2 * ONE)
    res = quoter.raw_batch([vault.address], [encode_call("pps()")])
    assert res[0] == (VALUE, 2 * ONE)
