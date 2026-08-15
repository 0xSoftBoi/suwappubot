"""Heartbeat staleness thresholds must match each service's real cadence.

Production symptom that prompted this: /health flapped `predict_monitor: dead`
and `balance_refresher: dead/unknown` on healthy instances, because a single
flat 90s cutoff was applied to loops whose cadences range from 10s to 120s.
"""

import re
from pathlib import Path

import pytest

from api.main import DEFAULT_STALENESS_SECONDS, SERVICE_STALENESS_SECONDS

REPO = Path(__file__).resolve().parents[1]

# service -> (module, its real loop cadence in seconds)
CADENCES = {
    "tx_poller": ("bot/services/tx_poller.py", 15),
    "perps_monitor": ("bot/services/perps_monitor.py", 10),
    "withdraw_reconciler": ("bot/services/withdraw_reconciler.py", 60),
    "balance_refresher": ("bot/services/balance_refresher.py", 60),
    "predict_monitor": ("bot/services/predict_monitor.py", 120),
}


def _heartbeat_ttl(module_path: str) -> int:
    """Pull the ttl_seconds used on the service's heartbeat write."""
    src = (REPO / module_path).read_text()
    m = re.search(r"heartbeat[^\n]*?ttl_seconds=(\d+)", src, re.S)
    if not m:
        m = re.search(r"_HEARTBEAT_TTL\s*=\s*(\d+)", src)
    assert m, f"no heartbeat ttl found in {module_path}"
    return int(m.group(1))


@pytest.mark.parametrize("svc", sorted(CADENCES))
def test_threshold_allows_at_least_two_missed_cycles(svc):
    """A healthy-but-slow loop must never be reported dead."""
    _, cadence = CADENCES[svc]
    threshold = SERVICE_STALENESS_SECONDS.get(svc, DEFAULT_STALENESS_SECONDS)
    assert threshold >= cadence * 2, (
        f"{svc} beats every {cadence}s but is called dead after {threshold}s — "
        "a single slow cycle would report a healthy service as dead"
    )


@pytest.mark.parametrize("svc", sorted(CADENCES))
def test_ttl_outlives_the_staleness_threshold(svc):
    """TTL must be >= threshold, else a stopped service reads 'unknown', not 'dead'.

    'unknown' means "never started"; 'dead' means "started and stopped beating".
    If the key is evicted first, a genuinely dead service is misreported as one
    that never ran, which is what masked balance_refresher for so long.
    """
    module, _ = CADENCES[svc]
    threshold = SERVICE_STALENESS_SECONDS.get(svc, DEFAULT_STALENESS_SECONDS)
    assert _heartbeat_ttl(module) >= threshold


def test_predict_monitor_regression():
    """The exact case that flapped in production: 120s cadence vs old 90s cutoff."""
    assert SERVICE_STALENESS_SECONDS["predict_monitor"] > 120


def test_every_watched_service_has_an_explicit_threshold():
    """A new service silently inheriting 90s is how this bug class recurs."""
    src = (REPO / "api/main.py").read_text()
    block = re.search(r"watched_services = \[(.*?)\]", src, re.S).group(1)
    for svc in re.findall(r'"([a-z_]+)"', block):
        assert svc in SERVICE_STALENESS_SECONDS, f"{svc} has no explicit threshold"
