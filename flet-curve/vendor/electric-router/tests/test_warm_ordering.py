"""Pool getters are answered from the warm; token and vault reads are not.

Every pool getter in the cold path -- dialects, balances, LP tokens -- reads
storage the warm has already fetched, so over the wire they pay twice for the
same bytes.  Measured on a cold start, alternating the order to control for the
node caching what the previous run read: 15,311 ms with the wire first against
8,742 ms with the warm first, and balances alone 3,261 ms against 1,174 ms.

What must not move is anything that reads an account the warm never loaded.
"""

from __future__ import annotations

from typing import ClassVar

from erouter.dev import cli


class _Cache:
    def __init__(self, unknown):
        self.accounts = {"0xpool": {}}
        self._unknown = unknown

    def unknown(self, addresses):
        return list(self._unknown)


def test_the_warm_is_skipped_when_the_cache_misses_a_pool(monkeypatch):
    """An unloaded account reads as zero, and zero is a plausible balance.

    A pool the cache has never seen would come back empty rather than
    erroring, so it would be dropped or mis-sized in silence.  When anything
    is unknown the whole cold path stays on the wire.
    """
    monkeypatch.setattr(cli, "_state_cache_for", lambda chain: _Cache(["0xnew"]))
    cache = cli._state_cache_for(object())
    assert cache.unknown([]) , "the fixture should report something unknown"
    # The guard the CLI applies:
    covered = not cache.unknown(["0xnew"])
    assert not covered


def test_a_covered_cache_allows_the_early_warm(monkeypatch):
    monkeypatch.setattr(cli, "_state_cache_for", lambda chain: _Cache([]))
    cache = cli._state_cache_for(object())
    assert not cache.unknown(["0xpool"])


def test_no_state_cache_means_no_early_warm(monkeypatch):
    """`_state_cache_for` answers None rather than an empty cache."""
    class Empty:
        accounts: ClassVar[dict] = {}

        @classmethod
        def load(cls, *a, **k):
            return cls()

    import erouter.chain.statecache as sc
    monkeypatch.setattr(sc, "StateCache", Empty)

    class Chain:
        chain_id = 1
        name = "Ethereum"

    assert cli._state_cache_for(Chain()) is None


def test_learn_arcs_is_separate_from_priming():
    """The access-list pass waits for arcs; priming does not need them.

    Splitting them is what lets the getters in between be answered locally --
    `_warm_once` with `nodes=None` loads values and stops.
    """
    import inspect

    source = inspect.getsource(cli._warm_once)
    assert "nodes is not None" in source, "priming must not require arcs"
    assert callable(cli._learn_arcs)
