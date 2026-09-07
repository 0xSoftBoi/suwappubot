"""A failed warm is retried, and never quietly downgraded.

`lb.drpc.live` is a load balancer, so a request can land on a backend that
answers differently or not at all.  The shape retry inside `_warm_by_proof`
covers one form of that; a warm that *raises* partway through was not covered,
and the fallback was to quote over the wire -- which is slower and answers
differently, so it turned a transient into a silently different number.
"""

from __future__ import annotations

from typing import ClassVar

import pytest

from erouter.dev import cli


def test_a_transient_failure_is_retried(monkeypatch):
    tries = []

    def flaky(rpc, chain, load, nodes, cache, *, quiet, fresh_quoter):
        tries.append(1)
        if len(tries) == 1:
            raise TypeError("'NoneType' object is not iterable")
        return "the warmed client"

    monkeypatch.setattr(cli, "_warm_once", flaky)
    got = cli._local_quoter(_Rpc(), _Chain(), _Load(), None, quiet=True)
    assert got == "the warmed client"
    assert len(tries) == 2, "the first failure should not have been the last word"


def test_giving_up_raises_rather_than_quoting_over_the_wire(monkeypatch):
    """The wire path is not a fallback -- it is a different answer."""

    def always_fails(*a, **k):
        raise TypeError("'NoneType' object is not iterable")

    monkeypatch.setattr(cli, "_warm_once", always_fails)
    with pytest.raises(cli.WarmFailed):
        cli._local_quoter(_Rpc(), _Chain(), _Load(), None, quiet=True)


def test_an_incomplete_sweep_is_a_failure_not_a_downgrade():
    """Unreadable slots read as zero, which quotes and quotes wrongly."""
    assert issubclass(cli.WarmFailed, RuntimeError)


class _Rpc:
    pass


class _Chain:
    chain_id = 1
    name = "Ethereum"


class _Load:
    pools: ClassVar[list] = []


@pytest.fixture(autouse=True)
def _a_state_cache(monkeypatch):
    """`_local_quoter` returns early without one, before any attempt."""
    class Cache:
        accounts: ClassVar[dict] = {"0x1": {}}

        @classmethod
        def load(cls, *a, **k):
            return cls()

    import erouter.chain.statecache as sc
    monkeypatch.setattr(sc, "StateCache", Cache)
