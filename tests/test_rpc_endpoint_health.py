"""RPC endpoint hygiene and quota handling.

Production evidence (13 Aug): python-api logs were a wall of open RPC circuits —
eleven 1rpc.io endpoints at ~607 consecutive failures each, plus 401/403/521/503
from other providers. That storm is what wedged balance_refresher: its pass
gathers wallet-balance calls with no deadline, against endpoints that accept a
connection and then fail.

Two causes, both fixed here: dead endpoints were still configured, and plan
exhaustion was classified as a transient blip.
"""

import re
import os

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _settings_src():
    return open(os.path.join(REPO, "bot", "config", "settings.py")).read()


# ── endpoints that were verified dead stay gone ──────────────────────────────


@pytest.mark.parametrize(
    "endpoint,why",
    [
        ("1rpc.io", "every endpoint returns -32001 plan-exhausted on eth_call"),
        ("rpc.ftm.tools", "HTTP 401"),
        ("fantom-rpc.publicnode.com", "HTTP 403"),
        ("linea.blockpi.network", "HTTP 521"),
        ("scroll.blockpi.network", "HTTP 503"),
        ("swell-mainnet.alt.technology", "HTTP 401"),
    ],
)
def test_verified_dead_endpoints_are_not_configured(endpoint, why):
    """Each was probed live with eth_call before removal. Re-adding one should
    be a deliberate act with a fresh probe behind it, not a copy-paste."""
    assert endpoint not in _settings_src(), f"{endpoint} is back ({why})"


def test_no_chain_was_left_without_an_endpoint():
    """Removing dead endpoints must not strand a chain. swellchain had exactly
    one and it 401s, so it needed a replacement rather than a deletion."""
    src = _settings_src()
    for m in re.finditer(r"(\w+_rpc_url):\s*str\s*=\s*Field\(\s*default=([\"'])(.*?)\2", src, re.S):
        name, urls = m.group(1), m.group(3)
        eps = [u.strip() for u in urls.split(",") if u.strip().startswith("http")]
        assert eps, f"{name} has no endpoints left"


def test_swellchain_points_at_a_verified_replacement():
    src = _settings_src()
    assert "swell.drpc.org" in src or "rpc.ankr.com/swell" in src
    # both were confirmed to answer eth_call AND report chain id 1923
    assert "swell-mainnet.alt.technology" not in src


# ── quota exhaustion is not a transient failure ──────────────────────────────


def test_quota_errors_are_recognised():
    from bot.services.rpc_manager import _QUOTA_ERROR

    for msg in (
        "rpc_error: {'code': -32001, 'message': \"You've reached the usage limit for your current plan\"}",
        "monthly quota exceeded",
        "credits exceeded",
        "402 payment required",
    ):
        assert _QUOTA_ERROR.search(msg), msg
    # ...and an ordinary blip is NOT swept into the long cooldown
    for msg in ("eth_call http_500", "Cannot connect to host", "timeout", "http_429"):
        assert not _QUOTA_ERROR.search(msg), msg


def test_an_exhausted_plan_is_demoted_for_hours_not_minutes():
    """The generic backoff caps at 600s, so an exhausted plan was re-probed
    every ten minutes forever — ~607 consecutive failures per endpoint over four
    days, which is the storm itself."""
    from bot.services.rpc_manager import RPCEndpoint

    ep = RPCEndpoint(url="https://1rpc.io/base", chain="base", tier=1)
    ep.record_failure("rpc_error: {'code': -32001, 'message': \"You've reached the usage limit\"}")
    assert ep.is_circuit_open
    remaining = ep.circuit_open_until - __import__("time").monotonic()
    assert remaining > 3600, f"quota cooldown is only {remaining:.0f}s"
    assert ep.QUOTA_COOLDOWN_SECONDS >= 6 * 3600


def test_a_transient_failure_still_uses_the_short_backoff():
    """The fix must not turn every 500 into a six-hour outage."""
    import time as _t

    from bot.services.rpc_manager import RPCEndpoint

    ep = RPCEndpoint(url="https://example.invalid", chain="base", tier=1)
    for _ in range(3):
        ep.record_failure("eth_call http_500")
    assert ep.is_circuit_open
    assert ep.circuit_open_until - _t.monotonic() <= 600
