"""An incomplete state sweep must be visible, not quoted from.

py-evm reads a slot that was never inserted as **zero**, and a zero fee, rate or
balance is a plausible number: the quote succeeds, the arc is mis-calibrated or
silently dropped, and the route changes with nothing raised anywhere.  That is
what made a pinned block non-reproducible across processes -- identical code at
block 25,769,788 returned 5,001,179.88 over 7 legs on one run and 5,002,399.84
over 24 on the next, depending only on whether the sweep had succeeded.

So the sweep retries once, and counts whatever is still missing.  `complete` is
what `_local_quoter` consults before handing the EVM to a route.
"""

from __future__ import annotations

from typing import ClassVar

import pytest

pytest.importorskip("pyrevm")

from erouter.dev.local_evm import LocalEvm, WarmStats

ACCOUNT = "0x" + "ab" * 20
BLOCK = 25_769_788


class Pin:
    hex_block = hex(BLOCK)
    block = BLOCK


class Rpc:
    """Answers the header, then hands out storage values from a script.

    `plan` is a list of per-request answers, consumed in order across calls, so
    a test can fail a slot on the first sweep and serve it on the retry.
    """

    url = "http://stub"
    pin = Pin()
    max_streams = 1

    def __init__(self, plan):
        self.plan = list(plan)
        self.batches = 0

    def fetch(self, method, params):
        if method == "eth_getBlockByNumber":
            return {"number": hex(BLOCK), "timestamp": "0x0", "baseFeePerGas": "0x1",
                    "gasLimit": "0x1c9c380", "miner": ACCOUNT, "difficulty": "0x0"}
        raise AssertionError(method)

    def fetch_multi(self, payloads, concurrent=False):
        self.batches += 1
        out = []
        for _ in payloads:
            out.append(self.plan.pop(0) if self.plan else Exception("exhausted"))
        return out


class Cache:
    funded: ClassVar[set[str]] = set()

    def __init__(self, slots):
        self._slots = slots

    def slots(self):
        return self._slots

    def bytecode(self, account):
        return b"\x00"

    def unknown(self, pools):
        return []


def evm_with(plan, slots=2):
    wanted = {ACCOUNT: set(range(slots))}
    return LocalEvm(rpc=Rpc(plan), cache=Cache(wanted), quoter="")


def test_a_complete_sweep_is_complete():
    evm = evm_with(["0x1", "0x2"])
    stats = evm.prime()
    assert stats.slots == 2
    assert stats.unreadable == 0 and stats.complete


def test_a_slot_that_never_arrives_is_counted_not_skipped():
    """Both the sweep and the retry fail: the EVM must declare itself unusable."""
    evm = evm_with([Exception("boom"), "0x2", Exception("boom again")])
    stats = evm.prime()
    assert stats.unreadable == 1
    assert not stats.complete
    assert any("unreadable" in e for e in stats.errors)
    # And the good slot is still loaded -- this is a report, not an abort.
    assert stats.slots == 1


def test_the_retry_recovers_a_transient_failure():
    """A dropped batch is usually transient; one retry must not cost the EVM."""
    rpc_plan = [Exception("transient"), "0x2",   # first sweep: slot 0 fails
                "0x1"]                           # retry: slot 0 arrives
    evm = evm_with(rpc_plan)
    stats = evm.prime()
    assert stats.unreadable == 0 and stats.complete
    assert stats.slots == 2
    assert stats.retried == 1
    assert evm._slots[ACCOUNT] == {0, 1}   # the recovered slot really landed


def test_warm_stats_complete_is_the_gate():
    assert WarmStats().complete
    assert not WarmStats(unreadable=1).complete


def test_a_transport_failure_in_the_access_list_counts_but_a_revert_does_not():
    """The two look alike and mean opposite things.

    A probe that reverts because the size is past what the pool holds is a real
    answer, and it arrives as a *result* with an error inside it.  A node that
    refuses arrives as an exception, and the slots that request would have named
    are now zeros.  Counting both would refuse the local EVM on every route that
    probes a small pool; counting neither let a flaky connection change a route.
    """
    from erouter.dev.local_evm import _access_list_error, _access_list_failed

    revert = {"accessList": [{"address": ACCOUNT, "storageKeys": []}],
              "error": "execution reverted"}
    refusal = Exception("HTTP 502")

    assert _access_list_failed(revert) and _access_list_failed(refusal)
    assert not isinstance(revert, Exception)      # counted: no
    assert isinstance(refusal, Exception)         # counted: yes
    assert "reverted" in _access_list_error(revert)
    assert "502" in _access_list_error(refusal)
