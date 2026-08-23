"""A remembered verdict must never be believed harder than a fresh one.

The cache exists so a pool that has already reproduced its own `get_dy` is not
made to prove it again: 2,406 gate probes down to 84.  That is all it saves -- it
does *not* let the warm skip those pools, which are computed from the very
storage the sweep fetches (see `test_startup_cost.py`).

A wrong verdict would be believed silently, so the properties worth pinning are
the ones that keep it honest:

* editing the maths discards every verdict, because the verdict is a claim about
  *this* arithmetic agreeing with the chain;
* a verdict is matched against the variants actually built this run, never used
  to construct one.

The second is not hypothetical.  On the production endpoint `stored_rates()` is
refused, so a rate-bearing pool cannot build its `reported` variant at all.  If
its cached verdict were trusted it would be admitted with decimals-only rates and
quote sUSDe as worth exactly one DOLA -- a factor of 1.2427.  Instead the verdict
finds no match, the pool is gated, it fails, and it stays in the set that gets
warmed and read properly.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from erouter.chain.exact_cache import ExactCache, math_fingerprint, trust

STABLE = {"family": "stable", "rates": "reported", "fee_on_xp": True}
PLAIN = {"family": "stable", "rates": "plain", "fee_on_xp": True}
POOL = "0x" + "ab" * 20


@dataclass
class FakeOut:
    by_pool: dict = field(default_factory=dict)
    trusted: int = 0


@dataclass
class FakePool:
    address: str


def built_with(*variants):
    """`(pool, model, variant)` triples, the shape the readers produce."""
    pool = FakePool(POOL)
    return [(pool, f"model-{v['rates']}", v) for v in variants]


def test_a_matching_verdict_admits_without_gating(tmp_path: Path):
    cache = ExactCache.load(1, "t", tmp_path)
    cache.record(POOL, STABLE)
    out = FakeOut()

    assert trust(out, cache, set(), built_with(STABLE, PLAIN), POOL.lower())
    assert out.by_pool[POOL.lower()] == "model-reported"
    assert out.trusted == 1


def test_a_verdict_for_a_variant_no_longer_built_falls_back_to_the_gate(tmp_path: Path):
    """The property that keeps a refused `stored_rates()` from being believed."""
    cache = ExactCache.load(1, "t", tmp_path)
    cache.record(POOL, STABLE)          # remembered: the reported-rates variant
    out = FakeOut()

    # ...but this run could not read the rates, so only `plain` exists.
    assert not trust(out, cache, set(), built_with(PLAIN), POOL.lower())
    assert not out.by_pool, "admitted a pool on a variant it could not build"
    assert out.trusted == 0


def test_resampling_forces_a_re_gate(tmp_path: Path):
    cache = ExactCache.load(1, "t", tmp_path)
    cache.record(POOL, STABLE)
    out = FakeOut()

    assert not trust(out, cache, {POOL.lower()}, built_with(STABLE), POOL.lower())
    assert not out.by_pool


def test_an_unknown_pool_is_never_trusted(tmp_path: Path):
    cache = ExactCache.load(1, "t", tmp_path)
    out = FakeOut()
    assert not trust(out, cache, set(), built_with(STABLE), POOL.lower())
    assert not trust(out, None, set(), built_with(STABLE), POOL.lower())


def test_verdicts_survive_a_round_trip(tmp_path: Path):
    cache = ExactCache.load(1, "ethereum", tmp_path)
    cache.record(POOL, STABLE)
    cache.save()

    again = ExactCache.load(1, "ethereum", tmp_path)
    assert again.get(POOL) == STABLE
    assert len(again) == 1


def test_refusals_are_never_written(tmp_path: Path):
    """The file is committed, so it must change only when a verdict does.

    A refusal reason carries the mismatching wei, which moves with the block, so
    persisting it rewrote the file on every route -- a dirty working tree after a
    read-only command.  Nothing reads them back: a pool absent from `verdicts` is
    re-gated either way.
    """
    cache = ExactCache.load(1, "ethereum", tmp_path)
    cache.record(POOL, STABLE)
    cache.refuse("0x" + "cd" * 20, "23350204197227025 != 21327129196346614")
    cache.save()
    first = (tmp_path / "ethereum.json").read_text()

    again = ExactCache.load(1, "ethereum", tmp_path)
    assert not again.refused, "a refusal was persisted"
    # A second run refusing the same pool with different numbers, as a moving
    # block does, must leave the bytes alone.
    again.refuse("0x" + "cd" * 20, "99999999999999999 != 11111111111111111")
    again.save()
    assert (tmp_path / "ethereum.json").read_text() == first


def test_editing_the_maths_discards_every_verdict(tmp_path: Path, monkeypatch):
    """A verdict is a claim about *this* arithmetic; change it and it is void."""
    cache = ExactCache.load(1, "ethereum", tmp_path)
    cache.record(POOL, STABLE)
    cache.save()
    assert len(ExactCache.load(1, "ethereum", tmp_path)) == 1

    monkeypatch.setattr("erouter.chain.exact_cache.math_fingerprint",
                        lambda: "0000000000000000")
    assert len(ExactCache.load(1, "ethereum", tmp_path)) == 0


def test_recording_clears_a_previous_refusal_and_vice_versa(tmp_path: Path):
    cache = ExactCache.load(1, "t", tmp_path)
    cache.refuse(POOL, "mismatch")
    cache.record(POOL, STABLE)
    assert cache.get(POOL) == STABLE and POOL.lower() not in cache.refused

    cache.refuse(POOL, "mismatch again")
    assert cache.get(POOL) is None and POOL.lower() in cache.refused


def test_the_fingerprint_is_stable_and_not_empty():
    assert math_fingerprint() == math_fingerprint()
    assert len(math_fingerprint()) == 16


# ------------------------------------------------- remembering a failure

def test_a_failure_is_remembered_against_the_balances_it_happened_at(tmp_path):
    """The fact is written; the reason is not.

    Re-deriving "this pool answers nothing" costs a probe per size per direction
    on every run.  Once the verdicts are warm those probes are the entire
    remaining gate -- measured at 94 of 94, all on pools that never pass.
    """
    cache = ExactCache(chain_id=1, path=tmp_path / "c.json")
    cache.refuse("0xAA", "would not quote", balances=[0, 0])
    assert cache.skip("0xaa", [0, 0])

    cache.save()
    again = ExactCache.load(1, "c", directory=tmp_path)
    assert again.skip("0xaa", [0, 0]), "the fact did not survive the round trip"
    assert "0xaa" not in again.refused, "the reason should not be written"


def test_a_deposit_makes_the_pool_worth_checking_again(tmp_path):
    """Keyed by balances so forgetting is automatic.

    A pool that answers nothing is empty, and an empty pool does not trade, so
    its balances sit still and the record stays valid without being refreshed.
    The moment someone deposits the key stops matching -- exactly when the answer
    might have changed.
    """
    cache = ExactCache(chain_id=1, path=tmp_path / "c.json")
    cache.refuse("0xAA", "would not quote", balances=[0, 0])
    assert cache.skip("0xaa", [0, 0])
    assert not cache.skip("0xaa", [10**18, 0]), "a funded pool must be re-checked"


def test_admitting_a_pool_clears_its_failure(tmp_path):
    cache = ExactCache(chain_id=1, path=tmp_path / "c.json")
    cache.refuse("0xAA", "would not quote", balances=[1, 1])
    cache.record("0xAA", {"family": "stable"})
    assert not cache.skip("0xaa", [1, 1])
    assert cache.get("0xaa") == {"family": "stable"}


def test_changing_the_maths_forgets_every_failure(tmp_path):
    """A pool that disagreed may agree once the arithmetic moves.

    The balances key cannot see that, so the fingerprint has to -- and it
    already discards the whole file, failures included.
    """
    cache = ExactCache(chain_id=1, path=tmp_path / "c.json")
    cache.refuse("0xAA", "mismatch", balances=[1, 1])
    cache.save()

    blob = json.loads((tmp_path / "c.json").read_text())
    blob["fingerprint"] = "not the current maths"
    (tmp_path / "c.json").write_text(json.dumps(blob))

    again = ExactCache.load(1, "c", directory=tmp_path)
    assert not again.skip("0xaa", [1, 1])


# ----------------------------------------- the fingerprint must ignore prose
#
# It hashed the raw bytes of every maths module, so trimming comments in
# `cryptoswap.py` and the three readers moved it and discarded every verdict on
# every chain -- a documentation edit costing a full re-gate, 2,406 probes
# against the 84 a warm cache needs.  It has to stay sensitive to the
# arithmetic and blind to what is written about it.

def test_the_fingerprint_ignores_comments_and_docstrings():
    from erouter.chain.exact_cache import _code_only

    documented = (
        'def get_y(a, b):\n'
        '    """What the pool would pay.\n'
        '\n'
        '    A long explanation that says nothing about the arithmetic.\n'
        '    """\n'
        '    # a note about the constant below\n'
        '    return a * 3 + b\n'
    )
    bare = 'def get_y(a, b):\n    return a * 3 + b\n'
    assert _code_only(documented) == _code_only(bare)


def test_the_fingerprint_still_catches_every_real_edit():
    from erouter.chain.exact_cache import _code_only

    base = 'def get_y(a, b):\n    return a * 3 + b\n'
    for label, edited in [
        ("a changed constant", 'def get_y(a, b):\n    return a * 4 + b\n'),
        ("a renamed name",     'def get_y(a, c):\n    return a * 3 + c\n'),
        ("a reordered term",   'def get_y(a, b):\n    return b + a * 3\n'),
        ("a new guard",        'def get_y(a, b):\n    if a:\n        return 0\n    return a * 3 + b\n'),
    ]:
        assert _code_only(base) != _code_only(edited), label

    # A string used as a *value* is arithmetic, not prose: only a string
    # standing alone as a statement is a docstring.
    assert (_code_only('def f():\n    return "int128"\n')
            != _code_only('def f():\n    return "uint256"\n'))


def test_a_line_moved_between_branches_moves_the_fingerprint():
    from erouter.chain.exact_cache import _code_only

    # Indentation is structure, so it is hashed as depth rather than dropped
    # with the other whitespace.
    inside = 'def f(x):\n    if x:\n        y = 1\n        return y\n    return 0\n'
    outside = 'def f(x):\n    if x:\n        return 1\n    y = 1\n    return 0\n'
    assert _code_only(inside) != _code_only(outside)
