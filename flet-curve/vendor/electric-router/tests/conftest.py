"""Shared fixtures.

The quoter is compiled and deployed **once per session**: compiling Vyper is the
slow part and the contract is stateless, so there is nothing to reset between
tests.
"""

from __future__ import annotations

import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
CONTRACTS = REPO / "contracts"
MOCKS = REPO / "tests" / "vyper"

ONE = 10**18


@pytest.fixture(scope="session", autouse=True)
def _fast_boa():
    import boa

    boa.env.enable_fast_mode()


@pytest.fixture(scope="session")
def quoter_deployer():
    import boa

    return boa.loads_partial(
        (CONTRACTS / "RouteQuoter.vy").read_text(), name="RouteQuoter"
    )


@pytest.fixture(scope="session")
def quoter(quoter_deployer):
    """One deployed RouteQuoter for the whole session (stateless, so reusable)."""
    return quoter_deployer.deploy()


@pytest.fixture(scope="session")
def quoter_runtime(quoter_deployer) -> bytes:
    """The bytecode an `eth_call` state override would inject."""
    return quoter_deployer.compiler_data.bytecode_runtime


@pytest.fixture(scope="session")
def mock():
    """Deploy a mock by filename, e.g. mock('MockStablePool', rate)."""
    import boa

    cache: dict[str, object] = {}

    def deploy(name: str, *args):
        if name not in cache:
            cache[name] = boa.loads_partial((MOCKS / f"{name}.vy").read_text(), name=name)
        return cache[name].deploy(*args)

    return deploy
