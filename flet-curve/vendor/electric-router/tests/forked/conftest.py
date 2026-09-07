"""Fixtures for tests that need a real chain.

Run with `uv run pytest -m forked`.  Skipped entirely without a `networks.py`.

The block is pinned once per session and every assertion compares two paths *at
that same block*, so the tests are reproducible without hardcoding a block
number that the node may later stop serving.
"""

from __future__ import annotations

import os

import pytest

from erouter.chain import chains as chain_table
from erouter.dev import config

pytestmark = pytest.mark.forked


@pytest.fixture(scope="session")
def chain():
    return chain_table.get("ethereum")


@pytest.fixture(scope="session")
def rpc(chain):
    if not config.have_networks():
        pytest.skip("networks.py not configured")
    from erouter.dev.rpc import JsonRpcTransport, RpcError

    url = config.rpc_url(chain.rpc_attr)
    block = os.environ.get("EROUTER_BLOCK", "latest")
    try:
        transport = JsonRpcTransport(url, block=block)
    except RpcError as exc:
        pytest.skip(f"node unreachable: {exc}")
    if transport.chain_id != chain.chain_id:
        pytest.skip(f"node is chain {transport.chain_id}, expected {chain.chain_id}")
    return transport


@pytest.fixture(scope="session")
def quoter_client(rpc):
    """The production path: quoter injected by state override, nothing deployed.

    Wrapped in the per-block cache.  The probe grid is sized in fractions of
    each pool's *reserves*, so it does not depend on the amount being routed at
    all -- one warm snapshot serves every pair and every size, which is what
    makes a many-pool sweep and property-based fuzzing affordable.  Pin
    `EROUTER_BLOCK` to reuse it across runs.
    """
    if not rpc.supports_state_override():
        pytest.skip("node does not support eth_call state overrides")
    from erouter.chain.probe_cache import CachedQuoterClient
    from erouter.dev.boa_host import override_client

    return CachedQuoterClient(override_client(rpc), rpc.chain_id, rpc.block)


@pytest.fixture(scope="session")
def api():
    from erouter.dev.curve_api import CurveApi

    return CurveApi()


@pytest.fixture(scope="session")
def pools(api, chain):
    """The live universe, at the default TVL floor."""
    from erouter.dev.curve_api import CurveApiError

    try:
        return api.list_pools(chain.chain_id, min_tvl=10_000.0)
    except CurveApiError as exc:
        pytest.skip(f"Curve API unreachable: {exc}")
