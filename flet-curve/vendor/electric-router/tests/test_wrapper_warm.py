"""The wrapper stages, answered locally and then checked.

`build_node_map` and the stake/transmuter/lending arcs read vaults and ERC20s,
which no pool probe touches -- 377 calls over 6 round trips, 1.3 s of a cold
start.  Warming them is worth it and was twice got wrong:

* Account-level coverage passes trivially -- 122 of the 167 accounts those
  calls reach are already cached because some pool swap touched them -- while
  the slots a vault's `convertToAssets` reads are still missing.  A missing
  slot is zero, the vault looks unusable, and its arc disappears: 12 stake
  arcs where the chain gives 19, silently.
* The EVM holds its own `StateCache`, so learning the requirement on a
  different instance recorded a need that was never satisfied.

Hence both a slot-level check and a signature over what the stages produced.
"""

from __future__ import annotations

from erouter.dev.cli import _recording, _wrapper_signature


class _Arc:
    def __init__(self, pool, kind=1, i=0, j=1):
        self.pool, self.kind, self.i, self.j = pool, kind, i, j


class _Nodes:
    n_nodes = 297


class _Vault:
    def __init__(self, token):
        self.token = token


class _Rejected:
    def __init__(self, symbol):
        self.symbol, self.reason = symbol, "non-linear"


class _Wrappers:
    def __init__(self, merged=(), rejected=()):
        self.merged_vaults = [_Vault(t) for t in merged]
        self.rejected_vaults = [_Rejected(s) for s in rejected]


def test_a_missing_arc_changes_the_signature():
    """The failure it exists to catch: an arc dropped for want of a slot."""
    full = _wrapper_signature(_Nodes(), _Wrappers(["0xv1"]),
                              [_Arc("0xa"), _Arc("0xb"), _Arc("0xc")])
    short = _wrapper_signature(_Nodes(), _Wrappers(["0xv1"]),
                               [_Arc("0xa"), _Arc("0xb")])
    assert full != short


def test_a_missing_vault_changes_the_signature():
    a = _wrapper_signature(_Nodes(), _Wrappers(["0xv1", "0xv2"]), [_Arc("0xa")])
    b = _wrapper_signature(_Nodes(), _Wrappers(["0xv1"]), [_Arc("0xa")])
    assert a != b


def test_the_signature_ignores_order():
    """Two runs must agree when they found the same things."""
    a = _wrapper_signature(_Nodes(), _Wrappers(["0xv1", "0xv2"]),
                           [_Arc("0xa"), _Arc("0xb")])
    b = _wrapper_signature(_Nodes(), _Wrappers(["0xv2", "0xv1"]),
                           [_Arc("0xb"), _Arc("0xa")])
    assert a == b


def test_a_rejected_vault_is_part_of_the_signature():
    """Whether a vault was refused is a result, not a detail."""
    a = _wrapper_signature(_Nodes(), _Wrappers(["0xv1"], ["sUSDe"]), [_Arc("0xa")])
    b = _wrapper_signature(_Nodes(), _Wrappers(["0xv1"]), [_Arc("0xa")])
    assert a != b


def test_the_recorder_answers_as_the_client_does_and_logs():
    class Inner:
        address = "0xquoter"

        def raw(self, batch):
            return [f"answer:{c}" for c in batch]

    proxy, calls = _recording(Inner())
    assert proxy.raw(["a", "b"]) == ["answer:a", "answer:b"]
    assert proxy.raw(["c"]) == ["answer:c"]
    assert calls == ["a", "b", "c"], "every call must reach the warm"
    assert proxy.address == "0xquoter", "it must still look like the client"
