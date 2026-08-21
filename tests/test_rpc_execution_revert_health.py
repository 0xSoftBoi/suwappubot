"""Regression coverage for contract-level EVM reverts and RPC health.

A successful JSON-RPC response containing an execution revert proves the node
handled the call. It must not count as an endpoint failure or evict the cached
Web3 provider. Transport/provider errors still must.
"""

from bot.services.rpc_manager import RPCEndpoint, RPCManager, RPCTier


def _manager_with_endpoint() -> tuple[RPCManager, RPCEndpoint, str]:
    manager = RPCManager()
    url = "https://rpc.example.invalid"
    endpoint = RPCEndpoint(url=url, chain="ethereum", tier=RPCTier.PUBLIC)
    manager._endpoints = {"ethereum": [endpoint]}
    manager._web3_cache = {"ethereum": (object(), url)}
    return manager, endpoint, url


def test_execution_revert_does_not_count_as_endpoint_failure():
    manager, endpoint, url = _manager_with_endpoint()

    manager.report_failure(
        "ethereum",
        url,
        "rpc_error: {'code': 3, 'message': 'execution reverted: ERC20: transfer amount exceeds balance'}",
    )

    assert endpoint.total_requests == 0
    assert endpoint.consecutive_failures == 0
    assert endpoint.last_error is None
    assert manager._web3_cache["ethereum"][1] == url


def test_reverted_without_reason_does_not_count_as_endpoint_failure():
    manager, endpoint, url = _manager_with_endpoint()

    manager.report_failure("ethereum", url, "rpc_error: execution reverted")

    assert endpoint.total_requests == 0
    assert endpoint.consecutive_failures == 0
    assert "ethereum" in manager._web3_cache


def test_generic_rpc_error_still_counts_as_endpoint_failure():
    manager, endpoint, url = _manager_with_endpoint()

    manager.report_failure("ethereum", url, "rpc_error: {'code': -32000, 'message': 'upstream unavailable'}")

    assert endpoint.total_requests == 1
    assert endpoint.consecutive_failures == 1
    assert "ethereum" not in manager._web3_cache


def test_transport_error_still_counts_as_endpoint_failure():
    manager, endpoint, url = _manager_with_endpoint()

    manager.report_failure("ethereum", url, "http_503")

    assert endpoint.total_requests == 1
    assert endpoint.consecutive_failures == 1
    assert "ethereum" not in manager._web3_cache
