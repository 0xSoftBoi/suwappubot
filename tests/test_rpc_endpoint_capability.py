"""RPC endpoints must be proven capable, not merely reachable.

An endpoint that answers `eth_blockNumber` but rejects `eth_call` passes a
liveness ping and then breaks every contract READ the app does — quotes,
allowances, balances. Worse, it fails quietly: callers that fail closed turn it
into "no route available" rather than "the RPC is broken".

This happened on dev: a chainlist-discovered arbitrum node rejected eth_call,
the health probe had marked it healthy, and a USDT0 quote came back as an empty
route list.

Three properties are pinned here:
  1. eth_call rejection is treated as FATAL — quarantined on first sight,
     because a node either implements the method or it does not.
  2. Transient failures still need three strikes, so a blip doesn't evict a
     good endpoint.
  3. An unprobed endpoint must not outrank a proven-healthy one, which is what
     makes a cold deploy pick badly.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402

from bot.services.rpc_manager import (  # noqa: E402
    RPCEndpoint,
    RPCTier,
    _is_method_unsupported,
)


@pytest.mark.parametrize(
    "error,expected,label",
    [
        # The real meowrpc response that started this.
        ({"code": -32000, "message": "The method eth_call is not supported."}, True, "meowrpc"),
        ({"code": -32601, "message": "Method not found"}, True, "standard -32601"),
        # Flow EXECUTES the synthetic to=0x0 probe and rejects it. The method
        # plainly works, so quarantining this endpoint evicted a healthy node.
        ({"code": -32000, "message": "invalid: failed transaction: tr"}, False, "flow exec error"),
        ({"code": 3, "message": "execution reverted"}, False, "revert"),
        ({"code": -32000, "message": "insufficient funds"}, False, "exec error"),
        ("not-a-dict", False, "malformed"),
    ],
)
def test_only_a_missing_method_counts_as_unsupported(error, expected, label):
    """An execution error proves eth_call works; only method-not-found does not."""
    assert _is_method_unsupported(error) is expected, label


def _endpoint(url="https://node.example/rpc", tier=RPCTier.DISCOVERED):
    return RPCEndpoint(url=url, chain="arbitrum", tier=tier)


def test_eth_call_rejection_quarantines_immediately():
    """A capability gap will not come good on retry."""
    ep = _endpoint()
    ep.record_failure("eth_call unsupported: method not supported", fatal=True)
    assert ep.is_circuit_open, "a node that cannot eth_call stayed in rotation"
    assert ep.health_score == 0.0


def test_transient_failures_still_need_three_strikes():
    """Regression guard: the fatal path must not make the breaker hair-trigger.

    A single timeout is normal on public RPCs; evicting on the first one would
    thrash the pool.
    """
    ep = _endpoint()
    ep.record_failure("timeout")
    assert not ep.is_circuit_open
    ep.record_failure("timeout")
    assert not ep.is_circuit_open
    ep.record_failure("timeout")
    assert ep.is_circuit_open


def test_unprobed_endpoint_does_not_outrank_a_proven_one():
    """The cold-start problem, stated as a score comparison.

    Right after a deploy nothing has been probed, so if an unprobed endpoint
    scored as well as a measured-good one, selection would be a coin flip —
    which is exactly when a broken endpoint gets chosen. Startup and
    post-discovery probes exist to close that window; this asserts the ordering
    they rely on.
    """
    unprobed = _endpoint(url="https://unknown.example/rpc")
    proven = _endpoint(url="https://good.example/rpc")
    proven.record_success(120.0)

    assert proven.health_score > unprobed.health_score


def test_a_failed_probe_scores_below_an_unprobed_one():
    """Once measured bad, an endpoint must rank below merely-unknown."""
    unprobed = _endpoint(url="https://unknown.example/rpc")
    failed = _endpoint(url="https://bad.example/rpc")
    failed.record_failure("eth_call unsupported", fatal=True)

    assert failed.health_score < unprobed.health_score


def test_success_after_failure_closes_the_circuit():
    """Recovery must be possible — a 600s quarantine is not a permanent ban."""
    ep = _endpoint()
    ep.record_failure("eth_call unsupported", fatal=True)
    assert ep.is_circuit_open

    ep.record_success(90.0)
    assert not ep.is_circuit_open
    assert ep.health_score > 0.0
