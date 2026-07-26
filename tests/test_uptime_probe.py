"""Tests for the external uptime probe (scripts/uptime_probe.py).

The probe is our unattended monitor, so its *alerting* behaviour is the thing
worth testing: it must page on real failures and stay quiet during the routine
deploy window. A monitor that cries wolf on every deploy gets muted, which is
the same as having no monitor at all.
"""

import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

uptime_probe = pytest.importorskip("uptime_probe")

DEEP_EP = {"name": "python-api", "url": "http://example.invalid/health", "deep": True}
SHALLOW_EP = {"name": "terminal", "url": "http://example.invalid/"}

# A freshly restarted service reports heartbeats it has not ticked yet.
DEGRADED_BODY = (
    '{"ready":true,"checks":{"database":"connected",'
    '"background_services":{"balance_refresher":"unknown"}}}'
)
HEALTHY_BODY = (
    '{"ready":true,"checks":{"database":"connected",'
    '"background_services":{"balance_refresher":"alive"}}}'
)


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    """Never actually wait between rechecks during tests."""
    monkeypatch.setattr(uptime_probe, "DEGRADED_RECHECK_DELAY", 0)


def test_transient_degradation_does_not_alert(monkeypatch):
    """A heartbeat that recovers on recheck is a deploy blip, not an incident."""
    responses = [(200, DEGRADED_BODY), (200, HEALTHY_BODY)]
    monkeypatch.setattr(uptime_probe, "probe", lambda *a, **k: responses.pop(0))

    result = uptime_probe.check(DEEP_EP, rechecks=2)

    assert result["ok"] is True
    assert result["degraded"] == []


def test_sustained_degradation_alerts(monkeypatch):
    """Degradation that survives every recheck is real and must be reported."""
    monkeypatch.setattr(uptime_probe, "probe", lambda *a, **k: (200, DEGRADED_BODY))

    result = uptime_probe.check(DEEP_EP, rechecks=2)

    assert result["ok"] is True  # HTTP is fine...
    assert result["degraded"] == ["background_services.balance_refresher=unknown"]
    assert "persisted across 3 checks" in result["detail"]


def test_hard_failure_reports_immediately_without_rechecking(monkeypatch):
    """A down service should not wait out the degraded-recheck budget."""
    calls = []

    def failing(*_args, **_kwargs):
        calls.append(1)
        return (503, "")

    monkeypatch.setattr(uptime_probe, "probe", failing)

    result = uptime_probe.check(DEEP_EP, rechecks=2)

    assert result["ok"] is False
    assert result["detail"] == "HTTP 503"
    assert len(calls) == 1


def test_unreachable_host_is_reported(monkeypatch):
    monkeypatch.setattr(uptime_probe, "probe", lambda *a, **k: (0, "DNS failure"))

    result = uptime_probe.check(DEEP_EP, rechecks=0)

    assert result["ok"] is False
    assert "unreachable" in result["detail"]


def test_shallow_endpoint_ignores_response_body(monkeypatch):
    """Only endpoints marked deep parse the payload; a 200 is enough otherwise."""
    monkeypatch.setattr(uptime_probe, "probe", lambda *a, **k: (200, DEGRADED_BODY))

    result = uptime_probe.check(SHALLOW_EP, rechecks=2)

    assert result["ok"] is True
    assert result["degraded"] == []


def test_endpoints_file_covers_every_public_service():
    """monitoring/endpoints.json is the single source of truth both schedulers
    read. `webapp` silently went unmonitored once because each tool kept its own
    list — this asserts the known public services stay covered."""
    prod = uptime_probe.load_endpoints("prod")
    names = {ep["name"] for ep in prod}

    # Names must match the Railway service names so scripts/status.py can join
    # these onto the services it discovers from the control plane.
    assert {
        "python-api",
        "api-ts",
        "terminal",
        "showcase",
        "webapp",
        "suwappu-bridge",
    } <= names
    for ep in prod:
        assert ep["url"].startswith("https://"), f"{ep['name']} must be probed over TLS"

    # The two API services expose deep payloads and must be parsed, not just pinged.
    deep = {ep["name"] for ep in prod if ep.get("deep")}
    assert {"python-api", "api-ts"} <= deep
