"""A computed pool must follow the block, or it answers about a past one.

`ExactQuoterClient` replaces probes with arithmetic over parameters it read once:
balances, `D`, the fee terms.  That makes the model a snapshot of one block's
storage, and a snapshot has no way to notice that the chain moved -- it keeps
answering, confidently and wrongly, on exactly the pools the router trusts most.

Today nothing moves: `JsonRpcTransport` pins a block at construction and never
repins.  The hook exists for the case that breaks that -- a live wallet provider
in the browser, where the block advances under a running session.

The test that matters is not "the field was reassigned" but that the probes the
quote was answered from came from the new models, since a refresh landing after
the preparation has been re-fitted is no refresh at all.
"""

from __future__ import annotations

import pytest

from erouter.chain.exact_probe import ExactQuoterClient
from erouter.core.pipeline import route
from erouter.core.types import ArcKind
from test_session_invariance import (
    CURVES_,
    DST,
    NODES_,
    POOLS_,
    SRC,
    UNIT,
    FakeQuoter,
)

AMOUNT = 250_000


class Model:
    """A stableswap stand-in that records which generation was asked."""

    def __init__(self, curve, generation: int, seen: list[int]):
        self.curve = curve
        self.generation = generation
        self.seen = seen
        self.n = 2

    def get_dy(self, i: int, j: int, dx: int) -> int:
        self.seen.append(self.generation)
        # A generation that answers differently would change the route, which
        # would confound "which models answered" with "which route won".  The
        # arithmetic is deliberately identical; only the tally differs.
        return self.curve.f(dx)


class ModelSet:
    def __init__(self, generation: int):
        self.generation = generation
        self.seen: list[int] = []
        self.by_pool = {
            pool: Model(curve, generation, self.seen)
            for (pool, i, j), curve in CURVES_.items() if (i, j) == (0, 1)
        }

    def __len__(self) -> int:
        return len(self.by_pool)

    def get(self, pool: str):
        return self.by_pool.get(pool.lower())


class MovingQuoter(FakeQuoter):
    """A quoter whose block advances, the way a live provider's does."""

    def __init__(self, curves, block: int):
        super().__init__(curves)

        class Moving:
            chain_id = 1

        self.transport = Moving()
        self.transport.block = block


def _run(*, models_block: int, now: int, rebuild=None):
    client = MovingQuoter(CURVES_, now)
    first = ModelSet(1)
    later: list[ModelSet] = []

    def _rebuild(block):
        made = ModelSet(2)
        later.append(made)
        return made, None, None

    wrapped = ExactQuoterClient(
        client, first, models_block=models_block,
        rebuild=_rebuild if rebuild is None else rebuild,
    )
    result = route(POOLS_, NODES_, wrapped, src_token=SRC, dst_token=DST,
                   amount_in=AMOUNT * UNIT, verify_on_chain=True,
                   measure_impact=False)
    return wrapped, first, later, result


def test_models_are_rebuilt_when_the_block_moves():
    wrapped, _first, later, result = _run(models_block=1_000_000, now=1_000_007)

    assert later, "the block moved and nothing rebuilt the models"
    assert wrapped.models_block == 1_000_007
    assert wrapped.exact is later[-1]
    assert result.counters.get("exact_models_rebuilt")


def test_the_quote_is_answered_by_the_new_models():
    """The refresh has to land *before* the preparation is fitted against it."""
    _, first, later, _ = _run(models_block=1_000_000, now=1_000_007)

    assert later[-1].seen, "the new models were installed but never asked"
    assert not first.seen, (
        f"{len(first.seen)} probe(s) were answered from the stale block's "
        f"models after the refresh"
    )


def test_a_still_block_rebuilds_nothing():
    """The hook is free when it has nothing to do -- a rebuild costs seconds."""
    wrapped, first, later, result = _run(models_block=1_000_000, now=1_000_000)

    assert not later, "rebuilt the models at a block that had not moved"
    assert wrapped.exact is first
    assert first.seen, "the original models should still be answering"
    assert "exact_models_rebuilt" not in result.counters


def test_a_failed_rebuild_does_not_quote_the_old_block():
    """Refusing is the safe direction: a stale quote is worse than no quote."""

    def _boom(block):
        raise RuntimeError("rpc died mid-rebuild")

    with pytest.raises(RuntimeError, match="rpc died"):
        _run(models_block=1_000_000, now=1_000_007, rebuild=_boom)


def test_a_client_without_the_hook_still_routes():
    """`route` must not require the hook -- most clients have no models."""
    client = MovingQuoter(CURVES_, 1_000_007)
    result = route(POOLS_, NODES_, client, src_token=SRC, dst_token=DST,
                   amount_in=AMOUNT * UNIT, verify_on_chain=True,
                   measure_impact=False)
    assert result.verified_out


def test_the_model_cache_is_dropped_when_the_models_are():
    """A memo that outlived its models would quote the wrong block.

    `_model` caches `(pool, kind, i, j) -> model` because the lookup cost more
    than the arithmetic it guards: 8.1 us a call against 1.8 us of maths.  The
    models are only valid at the block they were read from, so `refresh_at` has
    to invalidate it, or the rebuild lands and every leg stays stale.
    """
    first_models = ModelSet(1)
    later_models = ModelSet(2)
    client = ExactQuoterClient(
        MovingQuoter(CURVES_, 1), first_models, models_block=1,
        rebuild=lambda block: (later_models, None, None),
    )
    pool = next(iter(first_models.by_pool))
    got = client._model(pool, ArcKind.SWAP_STABLE, 0, 1)
    assert got is not None
    assert client._model(pool, ArcKind.SWAP_STABLE, 0, 1) is got, "not memoised"

    client.refresh_at(2)
    again = client._model(pool, ArcKind.SWAP_STABLE, 0, 1)
    assert again is not got, "the cache survived the rebuild"
    assert again.generation == 2
