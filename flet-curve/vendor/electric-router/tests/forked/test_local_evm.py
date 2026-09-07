"""The local EVM must agree with the node exactly, or it is worthless.

A prefetched EVM with no fallback reads a missed slot as zero and returns a
confidently wrong quote -- the same silent-wrong-answer class as decoding empty
returndata as zero, which this codebase refuses to tolerate elsewhere.  So the
test is equality against the chain, not plausibility.
"""

from __future__ import annotations

import pytest

from erouter.core.transport import Call
from erouter.core.types import ArcKind, Probe

pytestmark = pytest.mark.forked

pyrevm = pytest.importorskip("pyrevm")

# One of each dialect, spanning the shapes that break naive prefetching: a
# metapool reading a base pool, an ng pool reading a rate oracle, a tricrypto
# reading its own math contract.
ARCS = [
    ("0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7", ArcKind.SWAP_STABLE, 0, 1, 3, 18),
    ("0xDC24316b9AE028F1497c275EB9192a3Ea0f67022", ArcKind.SWAP_STABLE, 0, 1, 2, 18),
    ("0x4eBdF703948ddCEA3B11f675B4D1Fba9d2414A14", ArcKind.SWAP_CRYPTO, 0, 2, 3, 18),
    ("0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E", ArcKind.SWAP_STABLE, 0, 1, 2, 6),
]
# Four decades, because the one way a single prefetch goes wrong is a touched
# set that depends on trade size.
FACTORS = (1e-3, 1.0, 100.0, 10_000.0)


@pytest.fixture(scope="module")
def probes():
    return [
        Probe(pool, kind, i, j, n, max(1, int(factor * 10 ** dec)))
        for pool, kind, i, j, n, dec in ARCS
        for factor in FACTORS
    ]


@pytest.fixture(scope="module")
def warmed(rpc, chain, probes):
    from erouter.core.codec import encode_call
    from erouter.core.quoter import SIG_PROBE_BATCH
    from erouter.dev.boa_host import quoter_client
    from erouter.dev.local_evm import LocalEvm

    reference = quoter_client(rpc, chain)
    evm = LocalEvm(rpc)
    data = encode_call(SIG_PROBE_BATCH, [p.as_tuple() for p in probes])
    evm.warm([Call(reference.address, data)])
    if not evm.stats.accounts:
        pytest.skip(f"node served no prefetch: {evm.stats.errors[:2]}")
    return evm


def test_it_quotes_every_probe_exactly_as_the_node_does(warmed, rpc, chain, probes):
    """One prefetch, every size -- the claim the whole approach rests on."""
    from erouter.dev.boa_host import quoter_client

    on_chain = quoter_client(rpc, chain).probe(probes)
    locally = quoter_client(warmed, chain).probe(probes)
    assert len(locally) == len(on_chain)
    mismatched = [
        (p, a.value, b.value)
        for p, a, b in zip(probes, locally, on_chain, strict=True)
        if (a.status, a.value) != (b.status, b.value)
    ]
    assert not mismatched, mismatched[:3]


def test_the_prefetch_is_cheap_and_reuse_is_free(warmed, chain, probes):
    from erouter.core.codec import encode_call
    from erouter.core.quoter import SIG_PROBE_BATCH
    from erouter.dev.boa_host import quoter_client

    before = warmed.stats.round_trips
    assert before <= 4, f"{before} round trips to warm one batch"
    data = encode_call(SIG_PROBE_BATCH, [p.as_tuple() for p in probes])
    warmed.warm([Call(quoter_client(warmed, chain).address, data)])
    assert warmed.stats.round_trips == before, "re-warming the same call hit the network"


def test_an_unwarmed_pool_falls_back_to_the_chain_rather_than_guessing(rpc, chain):
    """The failure mode worth fearing: absent state reading as a valid quote.

    A cached slot list cannot predict a Chainlink round advancing or a LLAMMA
    band moving, so "prefetch complete" is not something to rely on.  The fork
    fallback makes an incomplete prefetch slow instead of wrong.
    """
    from erouter.dev.boa_host import quoter_client
    from erouter.dev.local_evm import LocalEvm

    probe = Probe(ARCS[0][0], ArcKind.SWAP_STABLE, 0, 1, 3, 10 ** 18)
    truth = quoter_client(rpc, chain).probe([probe])[0]

    cold = LocalEvm(rpc, strict=False)  # nothing warmed, fork serves it
    answers = quoter_client(cold, chain).probe([probe])
    assert (answers[0].status, answers[0].value) == (truth.status, truth.value)



def test_the_dumper_reads_exactly_what_getStorageAt_does(rpc, chain, probes):
    """27 hand-assembled bytes, checked against the RPC they replace.

    They read storage by *becoming* each account -- an `eth_call` override swaps
    the code and keeps the storage -- so a slip in the loop is a wrong slot
    rather than a crash.  The only defence worth having is every slot, both
    ways.  Two failures this has already caught: passing every override in one
    request (silently dropped, 86% of slots returned with nothing to say so),
    and overriding the *coordinator*, whose address the state cache holds
    because `warm` records it as the call target.
    """
    from erouter.core.codec import encode_call
    from erouter.core.quoter import SIG_PROBE_BATCH
    from erouter.dev.boa_host import quoter_client
    from erouter.dev.local_evm import LocalEvm

    if not rpc.supports_state_override():
        pytest.skip("node rejects state overrides")
    quoter = quoter_client(rpc, chain).address
    data = encode_call(SIG_PROBE_BATCH, [p.as_tuple() for p in probes])

    plain = LocalEvm(rpc)
    plain.warm([Call(quoter, data)])
    if not plain.stats.accounts:
        pytest.skip(f"node served no prefetch: {plain.stats.errors[:2]}")

    dumped = LocalEvm(rpc, quoter=quoter, prefer_dump=True)
    dumped.warm([Call(quoter, data)])
    assert not dumped.stats.errors, dumped.stats.errors[:2]
    assert dumped.stats.slots == plain.stats.slots, "the dumper returned fewer slots"

    checked = 0
    for account, slots in plain._slots.items():
        for slot in slots:
            assert plain._evm.storage(account, slot) == dumped._evm.storage(account, slot), (
                f"{account} slot {slot}"
            )
            checked += 1
    assert checked > 20, f"only {checked} slots compared"
