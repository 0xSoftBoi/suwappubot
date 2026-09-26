"""The committed runtime bytecode is what the source compiles to.

The override path injects this, and it is read from disk rather than compiled
because compiling needs boa and vyper -- neither of which exists under Pyodide,
where the Flet frontend runs.  That makes the committed copy load-bearing: if
`RouteQuoter.vy` changes and the hex does not, every chain without a deployed
quoter silently runs the *old* contract.

This is the test that stops that, and it is the right place for boa: a
developer running the suite has the compiler, the browser does not.
"""

from __future__ import annotations

import hashlib

import pytest

from erouter.dev import boa_host

boa = pytest.importorskip("boa", reason="compiling needs boa; the runtime path does not")


def test_the_committed_runtime_matches_the_source():
    fresh = boa_host._deployer().compiler_data.bytecode_runtime
    assert boa_host.runtime_bytecode() == fresh, (
        "data/quoter/RouteQuoter.runtime.hex is stale -- recompile it, or every "
        "chain without a deployed quoter runs the old contract"
    )


def test_the_recorded_source_hash_matches_the_source():
    """A second lock, so a hand-edited hex file is caught as well."""
    recorded = ""
    for line in boa_host.RUNTIME.read_text().splitlines():
        if line.startswith("# source sha256:"):
            recorded = line.split(":", 1)[1].strip()
    assert recorded, "the hex file should record which source it came from"
    assert recorded == hashlib.sha256(boa_host.CONTRACT.read_bytes()).hexdigest()


def test_reading_the_runtime_does_not_need_boa(monkeypatch):
    """The whole point: the override path must work with no compiler present."""
    import sys

    boa_host.runtime_bytecode.cache_clear()
    monkeypatch.setitem(sys.modules, "boa", None)   # importing it would now fail
    got = boa_host.runtime_bytecode()
    assert len(got) > 1000
    boa_host.runtime_bytecode.cache_clear()


def test_the_source_still_deploys_to_the_live_quoter():
    """Editing `RouteQuoter.vy` at all moves where CREATE2 puts it.

    Vyper embeds a hash of the source in the *initcode* -- not the runtime, so
    the deployed code would be byte-identical and nothing else would notice.
    But the address is `keccak(proxy, salt, initcode)`, so a comment is enough
    to point `deploy_quoter.py --create2` at an empty address and deploy a
    second quoter beside the live one.

    That is expensive rather than merely untidy: the address is whitelisted on
    the scoped RPC key chain by chain, and a scoped key answers 403 to any
    target that is not on it.

    Caught by adding an `@author` line, where the sibling source-hash test
    failed with a mismatch that reads like "regenerate the hex file" -- which
    would have moved the quoter and passed.
    """
    from erouter.chain.chains import QUOTER
    from erouter.core.keccak import keccak256
    from erouter.dev.deploy import create2_address

    salt = keccak256(b"erouter.RouteQuoter.v2")
    initcode = boa_host._deployer().compiler_data.bytecode
    assert create2_address(salt, initcode).lower() == QUOTER.lower(), (
        "RouteQuoter.vy no longer compiles to the deployed quoter's address; "
        "revert the source, or accept a redeployment and re-whitelisting on "
        "every chain"
    )
