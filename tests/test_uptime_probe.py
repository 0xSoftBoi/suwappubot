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


def test_subsystem_breakdown_ignores_build_fingerprints():
    """Fingerprints are hex digests, not health statuses.

    api-ts's /health carries source_fingerprint at the top level (no "checks"
    subtree), so the walker inspects it directly; before the META_KEYS fix the
    probe flagged every healthy api-ts response as degraded and the scheduled
    Health Check failed on every run.
    """
    import json
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    from status import subsystem_breakdown

    api_ts = json.dumps(
        {
            "status": "ok",
            "service": "suwappu-api-ts",
            "version": "0.4.0",
            "source_fingerprint": "24fbdff5aa77",
            "timestamp": "2026-08-09T00:00:00Z",
            "db": "connected",
        }
    )
    assert subsystem_breakdown(api_ts) == []

    # A genuinely unhealthy subsystem must still surface.
    python_api = json.dumps(
        {
            "ready": True,
            "source_fingerprint": "b4bd93e8ce07",
            "worker_fingerprint": "unknown",
            "checks": {
                "database": "connected",
                "background_services": {"tx_poller": "alive", "balance_refresher": "unknown"},
            },
        }
    )
    assert subsystem_breakdown(python_api) == [("background_services.balance_refresher", "unknown")]


def test_send_telegram_retries_plain_text_on_markdown_400(monkeypatch):
    """A Telegram 400 (unbalanced Markdown entities in dynamic subsystem names)
    must fall back to a plain-text send, not drop the alert."""
    import io
    import urllib.error

    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "t0k3n")
    monkeypatch.setenv("TELEGRAM_ALERT_CHAT_ID", "-100123")

    calls = []

    class _Resp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=None):
        body = req.data.decode()
        calls.append(body)
        if "parse_mode" in body:
            raise urllib.error.HTTPError(
                "https://api.telegram.org", 400, "Bad Request", {}, io.BytesIO(b"")
            )
        return _Resp()

    monkeypatch.setattr(uptime_probe.urllib.request, "urlopen", fake_urlopen)

    assert uptime_probe.send_telegram("alert with source_fingerprint underscore") is True
    assert len(calls) == 2
    assert "parse_mode" in calls[0]
    assert "parse_mode" not in calls[1]
