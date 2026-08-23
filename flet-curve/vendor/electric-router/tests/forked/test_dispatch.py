"""Dialect audit over the live universe.

Pins the measurements the design rests on.  Thresholds are deliberately loose
where the universe drifts, and exact where the *behaviour* is the point.
"""

from __future__ import annotations

import pytest

from erouter.core.pools import parse_universe
from erouter.core.types import Dialect
from erouter.dev.universe import count_swap_arcs, resolve_dialects

pytestmark = pytest.mark.forked

MISTYPED_CRYPTO = "0x80466c64868e1ab14a1ddf27a676c3fcbe638fe5"


@pytest.fixture(scope="module")
def audited(pools, quoter_client, chain):
    specs = parse_universe(pools)
    # use_cache=False so the test measures the probe path, not a warm cache
    audit = resolve_dialects(specs, quoter_client, chain, use_cache=False)
    return specs, audit


def test_universe_is_the_expected_size(audited):
    specs, _ = audited
    assert 200 < len(specs) < 1200
    assert 500 < count_swap_arcs(specs) < 4000


def test_every_pool_resolves_to_exactly_one_dialect(audited):
    """0 unresolved is the Phase 2 bar."""
    specs, audit = audited
    assert audit.unresolved == []
    assert all(p.dialect in (Dialect.STABLE, Dialect.CRYPTO) for p in specs)


def test_the_whole_audit_is_one_batched_call_and_fast(audited):
    _, audit = audited
    assert audit.seconds < 20.0  # ~1 s locally; generous for a loaded node


def test_empty_returndata_is_widespread_not_theoretical(audited):
    """If this ever drops to zero, the three-state result stopped working."""
    _, audit = audited
    assert audit.empty_returndata >= 20


def test_the_api_mistypes_at_least_one_pool(audited):
    """Which is why the registry table is a hint and the probe is the verdict."""
    specs, audit = audited
    by_address = {p.address.lower(): p for p in specs}
    if MISTYPED_CRYPTO not in by_address:
        pytest.skip("the pinned mis-typed pool left the universe")

    pool = by_address[MISTYPED_CRYPTO]
    assert pool.table_dialect is Dialect.STABLE  # what the registry claims
    assert pool.dialect is Dialect.CRYPTO  # what it actually answers
    assert any(p.address.lower() == MISTYPED_CRYPTO for p, _ in audit.mistyped)


def test_pools_that_answer_neither_spelling_keep_the_table_verdict(audited):
    """Live-but-unquotable (paused, dust) is a different fact from unknown ABI.

    Four measured pools have the *reverting* spelling as the implemented one,
    so "whichever answered" cannot be the discriminator.
    """
    _, audit = audited
    for pool in audit.no_answer:
        assert pool.dialect is pool.table_dialect
        assert pool.note == "NO_ANSWER"


def test_dialects_are_cached_across_runs(pools, quoter_client, chain):
    """A dialect is a property of the contract, not of the block."""
    specs = parse_universe(pools)
    first = resolve_dialects(specs, quoter_client, chain, use_cache=True)
    assert first.resolved

    again = parse_universe(pools)
    second = resolve_dialects(again, quoter_client, chain, use_cache=True)
    assert second.from_cache >= first.from_probe
    assert second.seconds < first.seconds or second.from_probe == 0
