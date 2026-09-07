"""Probe grid and calibration against live pools.

The `gamma_live` test is the highest-value one in the suite: it compares a
quantity derived purely from two quotes against a completely independent
on-chain source, so it fails if *anything* in the chain of ABI dispatch,
decimals, probe sizing or calibration is wrong.
"""

from __future__ import annotations

import pytest

from erouter.core.calibrate import calibrate
from erouter.core.codec import decode_uint, encode_call
from erouter.core.prices import gamma_live
from erouter.core.probe import collect, plan_deltas, plan_grid
from erouter.core.types import Probe
from erouter.dev.universe import arc_refs, read_balances, resolve_dialects

pytestmark = pytest.mark.forked

THREEPOOL = "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7"
FEE_DENOMINATOR = 10**10


@pytest.fixture(scope="module")
def prepared(pools, quoter_client, chain):
    """The universe with dialects resolved and balances read."""
    from erouter.core.pools import parse_universe

    specs = parse_universe(pools)
    resolve_dialects(specs, quoter_client, chain)
    read_balances(specs, quoter_client)
    return specs


@pytest.fixture(scope="module")
def threepool(prepared):
    for pool in prepared:
        if pool.address.lower() == THREEPOOL.lower():
            return pool
    pytest.skip("3pool left the universe")


def _fit(client, pool, i, j, *, theta=0.01):
    """Calibrate one direction at a realistic size, from the pool's own reserves.

    The tangent probe is sized off the *reserve*, not off `d_bar`.  It matters:
    `a` is a ratio of integers, so a tangent probe worth 0.13 DAI yields only ~5
    significant digits of a 6-decimal output, while 1e-6 of the reserve (~27 DAI
    here) gives ~8.
    """
    reserve = pool.balances[i]
    d = int(reserve * theta)
    deltas = [max(1, int(reserve * 1e-6)), d // 4, d // 2, d]
    quotes = client.probe(
        [Probe(pool.address, pool.swap_kind, i, j, pool.n_coins, x) for x in deltas]
    )
    dec_in = 10**pool.coins[i].decimals
    dec_out = 10**pool.coins[j].decimals
    xs = [x / dec_in for x, q in zip(deltas, quotes, strict=True) if q.ok]
    ys = [q.value / dec_out for q in quotes if q.ok]
    return calibrate(xs, ys)


def test_gamma_live_equals_the_declared_fee(rpc, quoter_client, threepool):
    """§2.6: `sqrt(a_f * a_r)` reads the pool's current fee off two probes.

    No fee parameters, no `k` computation, no ABI knowledge of the fee law -- and
    it is checked against a completely independent on-chain source, so it fails
    if anything in ABI dispatch, decimals, probe sizing or calibration is wrong.

    Tolerance: `a` is a ratio of integers, so its precision is bounded by the
    *output* token's decimals -- ~1e-7 in `a`, i.e. 0.001 bp, orders of magnitude
    below any real fee.
    """
    fee = decode_uint(rpc.call(THREEPOOL, encode_call("fee()")))
    expected = 1.0 - fee / FEE_DENOMINATOR

    forward = _fit(quoter_client, threepool, 0, 1, theta=0.005)
    reverse = _fit(quoter_client, threepool, 1, 0, theta=0.005)

    measured = float(gamma_live(forward.a, reverse.a))
    assert measured == pytest.approx(expected, abs=1e-6)
    assert forward.a * reverse.a < 1.0  # round-tripping always loses


def test_round_tripping_always_loses(prepared, quoter_client):
    """`a_f * a_r = Gamma^2 < 1` is frame-independent.

    `>= 1` means a broken quote or stale state, and the pool must be dropped
    rather than routed through -- it would look like free money.
    """
    checked = 0
    for pool in prepared:
        if pool.swap_kind is None or not pool.balances or pool.n_coins < 2:
            continue
        if pool.balances[0] <= 0 or pool.balances[1] <= 0:
            continue
        dx0 = max(1, pool.balances[0] // 10_000)
        dx1 = max(1, pool.balances[1] // 10_000)
        got = quoter_client.probe([
            Probe(pool.address, pool.swap_kind, 0, 1, pool.n_coins, dx0),
            Probe(pool.address, pool.swap_kind, 1, 0, pool.n_coins, dx1),
        ])
        if not (got[0].ok and got[1].ok):
            continue
        scale0, scale1 = 10**pool.coins[0].decimals, 10**pool.coins[1].decimals
        a_f = (got[0].value / scale1) / (dx0 / scale0)
        a_r = (got[1].value / scale0) / (dx1 / scale1)
        assert a_f * a_r < 1.0 + 1e-9, f"{pool.name} ({pool.address}) implies free money"
        checked += 1
        if checked >= 60:
            break
    assert checked >= 20


def test_probe_grid_succeeds_on_most_arcs(prepared, quoter_client):
    """Measured ~94% at 1e-6*reserve; the grid escalates for the rest."""
    refs = arc_refs(prepared)[:400]
    plan = plan_grid(refs)
    ladders = collect(plan, quoter_client.probe(plan.probes))

    usable = [lad for lad in ladders if lad.ok]
    assert len(usable) / max(len(ladders), 1) > 0.85

    # every usable ladder must be calibratable and concave-or-clamped
    for ladder in usable[:80]:
        deltas, quotes = ladder.as_float()
        fit = calibrate(deltas, quotes)
        assert fit.a > 0
        assert fit.B >= 0  # never negative: that is the class invariant


def test_delta_planning_never_rounds_to_zero(prepared):
    """Two-decimal tokens exist, so 1e-6 of a reserve can be 0 wei."""
    seen_low_decimals = False
    for pool in prepared:
        if not pool.balances:
            continue
        for k, coin in enumerate(pool.coins):
            if k >= len(pool.balances) or pool.balances[k] <= 0:
                continue
            deltas = plan_deltas(pool.balances[k], coin.decimals)
            assert all(d > 0 for d in deltas), f"{pool.name} coin {coin.symbol}"
            assert deltas == sorted(set(deltas))  # strictly increasing, no dupes
            if coin.decimals <= 8:
                seen_low_decimals = True
    assert seen_low_decimals, "expected some low-decimal tokens in the universe"


def test_stableswap_is_concave_at_realistic_sizes(quoter_client, threepool):
    """Concavity is the load-bearing assumption; check it on a real pool."""
    fit = _fit(quoter_client, threepool, 0, 1, theta=0.05)
    assert fit.B > 0
    assert not fit.convex_flag
    assert not fit.clamped
    assert abs(fit.drift) < 0.25  # §12.2's healthy band


def test_a_deep_pool_probed_too_small_clamps_rather_than_lying(quoter_client, threepool):
    """Curvature below the integer noise floor is reported as zero, not faked.

    Probed at 4 bp of a $160M pool, 3pool is linear to the precision available.
    The fit clamps to the admissible `B = 0` limit -- with a mandatory finite cap,
    so the arc is bottomless only up to the size actually probed.  §12.1's theta
    check is what escalates if the route ever wants more.
    """
    fit = _fit(quoter_client, threepool, 0, 1, theta=0.0004)
    if not fit.clamped:
        pytest.skip("pool showed measurable curvature even at this size")
    assert fit.B == 0.0
    assert fit.cap < float("inf")
    assert fit.note == "CAP_FROM_LADDER"
