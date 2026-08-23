"""Waiting for a load-balanced endpoint to catch up to a block already seen.

An endpoint behind a balancer is many nodes and they are not at the same
height.  A transaction the caller has *watched confirm* in block N is invisible
to a node still at N-1, so a plan pinned there prices the route against a chain
where the approval has not happened -- and the dry run reverts on an allowance
that does exist, which reads as "this route would not go through" and is simply
wrong.
"""

from __future__ import annotations

import asyncio

from erouter.chain import session as sess

#: This repo has no asyncio plugin and one file is not a reason to add one, so
#: each coroutine gets a one-line sync wrapper that drives it.


def run(coroutine):
    return asyncio.run(coroutine)


class Rpc:
    """An endpoint whose height is whatever the script says next."""

    def __init__(self, heights: list[int]) -> None:
        self.heights = list(heights)
        self.asked = 0

    async def call(self, method: str, params: list):
        assert method == "eth_getBlockByNumber"
        self.asked += 1
        height = self.heights[min(self.asked - 1, len(self.heights) - 1)]
        return {"number": hex(height), "timestamp": "0x1", "gasLimit": "0x1"}


def session_with(rpc: Rpc) -> sess.RouterSession:
    """A session with nothing in it but the endpoint."""
    made = sess.RouterSession.__new__(sess.RouterSession)
    made.rpc = rpc
    return made


def test_a_block_already_there_is_answered_at_once(monkeypatch):
    monkeypatch.setattr(sess.asyncio, "sleep", _no_sleep())
    rpc = Rpc([100])

    header = run(session_with(rpc)._header_at_least(100))

    assert int(header["number"], 16) == 100
    assert rpc.asked == 1, "no waiting for a height already reached"


def test_a_lagging_node_is_asked_again_until_it_catches_up(monkeypatch):
    slept = _no_sleep()
    monkeypatch.setattr(sess.asyncio, "sleep", slept)
    rpc = Rpc([98, 99, 101])

    header = run(session_with(rpc)._header_at_least(100))

    assert int(header["number"], 16) == 101, "the first height that is enough"
    assert rpc.asked == 3
    assert slept.calls == 2, "once between each ask, and not after the last"


def test_no_floor_means_no_waiting(monkeypatch):
    monkeypatch.setattr(sess.asyncio, "sleep", _no_sleep())
    rpc = Rpc([1])

    run(session_with(rpc)._header_at_least(0))

    assert rpc.asked == 1


def test_an_endpoint_that_never_catches_up_answers_anyway(monkeypatch):
    """Refusing would be this deciding that a slow endpoint is a broken one.
    A plan against a stale block is one the dry run will speak up about."""
    monkeypatch.setattr(sess.asyncio, "sleep", _no_sleep())
    rpc = Rpc([50])

    header = run(session_with(rpc)._header_at_least(100))

    assert int(header["number"], 16) == 50
    assert rpc.asked == sess.CATCH_UP_TRIES + 1, "the first ask, then the tries"


def _no_sleep():
    """`asyncio.sleep` that counts instead of waiting."""

    async def sleep(_seconds: float) -> None:
        sleep.calls += 1

    sleep.calls = 0
    return sleep
