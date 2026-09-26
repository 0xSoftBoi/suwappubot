"""A rebuild that refuses everything is describing the endpoint, not the pools.

`ExactCache` caches "this pool would not quote" so the next run does not
re-probe a pool holding dust -- a probe per size per direction, which is real
time.  The same code path also records a pool the endpoint merely declined to
answer for, and that entry is worth nothing and costs a lot.

Measured on mainnet: a verdict rebuild lost 58 of 266 stableswap models to one
bad batch, and every quote afterwards sent 6 candidate routes to the chain
instead of 0.  That fired a 182 ms on-chain confirmation and took the routing
stages from 202 ms to 369 ms -- 1.8x -- until the entries lapsed.

Pools do not empty in concert; endpoints fail in batches.  So the share is the
signal.
"""

from __future__ import annotations

from erouter.chain.exact_cache import MASS_REFUSAL_SHARE, ExactCache


def cache(tmp_path, chain_id: int = 1) -> ExactCache:
    return ExactCache(chain_id=chain_id, path=tmp_path / "ethereum.json")


def test_a_single_refusal_is_cached_however_small_the_universe(tmp_path):
    """One refusal out of one is not an outage, it is a small universe."""
    c = cache(tmp_path)
    c.refuse("0xAA", "would not quote", balances=[0, 0])
    c.save()

    assert not c.mass_refusal
    assert ExactCache.load(1, "ethereum", directory=tmp_path).skip("0xaa", [0, 0])


def test_a_few_refusals_are_cached(tmp_path):
    """The ordinary case: a handful of dust pools, worth not re-probing."""
    c = cache(tmp_path)
    for k in range(90):
        c.record(f"0x{k:040x}", {"variant": "v1"})
    for k in range(90, 93):
        c.refuse(f"0x{k:040x}", "would not quote", balances=(0, 0))
    c.save()

    again = ExactCache.load(1, "ethereum", directory=tmp_path)
    assert len(again.unquotable) == 3
    assert not c.mass_refusal
    assert again.skip(f"0x{90:040x}", (0, 0)), "a cached refusal should skip"


def test_a_mass_refusal_is_not_cached(tmp_path):
    """The outage case: most of the universe refused in one run."""
    c = cache(tmp_path)
    for k in range(50):
        c.record(f"0x{k:040x}", {"variant": "v1"})
    for k in range(50, 100):          # 50 of 100 -- far past the share
        c.refuse(f"0x{k:040x}", "would not quote", balances=(1, 2))
    c.save()

    again = ExactCache.load(1, "ethereum", directory=tmp_path)
    assert again.unquotable == {}, "an outage was cached as a property of the pools"
    assert c.mass_refusal == 50, "the caller needs to be able to report it"
    assert not again.skip(f"0x{50:040x}", (1, 2)), (
        "a pool refused during an outage must be re-probed on the *next* run")
    assert c.skip(f"0x{50:040x}", (1, 2)), (
        "within the run that saw it refuse, the refusal still stands -- "
        "re-probing it immediately would cost what the refusal exists to save")
    assert len(again.verdicts) == 50, "the verdicts that did survive are kept"


def test_the_threshold_is_a_share_not_a_count(tmp_path):
    """A big chain may refuse more pools than a small chain holds in total."""
    c = cache(tmp_path)
    total = 1_000
    refusals = int(total * MASS_REFUSAL_SHARE) - 1
    for k in range(total - refusals):
        c.record(f"0x{k:040x}", {"variant": "v1"})
    for k in range(total - refusals, total):
        c.refuse(f"0x{k:040x}", "would not quote", balances=(7,))
    c.save()

    assert not c.mass_refusal
    assert len(ExactCache.load(1, "ethereum", directory=tmp_path).unquotable) == refusals


def test_recording_a_verdict_clears_a_pending_refusal(tmp_path):
    """A pool that answers on the retry within one run is not refused."""
    c = cache(tmp_path)
    c.record("0xaa", {"variant": "v1"})
    c.refuse("0xbb", "would not quote", balances=(0,))
    c.record("0xbb", {"variant": "v2"})
    c.save()

    again = ExactCache.load(1, "ethereum", directory=tmp_path)
    assert again.unquotable == {}
    assert set(again.verdicts) == {"0xaa", "0xbb"}
