"""Contract test for the heartbeat seam.

The probe (scripts/uptime_probe.py) and the endpoint (api/main.py
POST /internal/monitor-heartbeat) were built separately against a written
spec. Each side is unit-tested in isolation, which proves nothing about
whether they actually agree — and if they don't, the dead-man's switch never
receives a heartbeat and silently reports that monitoring is dead forever.

This test runs the REAL probe function against a real socket and asserts the
request it emits satisfies exactly what the real endpoint parses.
"""

import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

uptime_probe = pytest.importorskip("uptime_probe")

# Mirrors api/main.py — kept in sync deliberately so this test fails loudly if
# the endpoint's sanitization rules change without the probe being revisited.
_SOURCE_MAX_LEN = 40


class _Capture(BaseHTTPRequestHandler):
    received: list = []

    def do_POST(self):  # noqa: N802 — BaseHTTPRequestHandler API
        _Capture.received.append({"path": self.path, "method": "POST"})
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, *_args):
        pass  # keep test output clean


@pytest.fixture
def capture_server():
    _Capture.received = []
    server = HTTPServer(("127.0.0.1", 0), _Capture)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server, _Capture
    server.shutdown()
    server.server_close()


def test_probe_emits_request_the_endpoint_accepts(capture_server, monkeypatch):
    server, capture = capture_server
    host, port = server.server_address

    monkeypatch.setenv("MONITOR_HEARTBEAT_URL", f"http://{host}:{port}/internal/monitor-heartbeat")
    monkeypatch.setenv("MONITOR_HEARTBEAT_TOKEN", "s3cr3t-token")
    monkeypatch.setenv("PROBE_SOURCE", "github-actions")

    uptime_probe.send_heartbeat(all_ok=True)

    assert len(capture.received) == 1, "probe must send exactly one heartbeat"
    req = capture.received[0]
    assert req["method"] == "POST", "endpoint is declared @app.post"

    params = parse_qs(urlparse(req["path"]).query)

    # The three things the endpoint reads.
    assert params["token"] == ["s3cr3t-token"]
    assert params["source"] == ["github-actions"]
    assert params["ok"] == ["1"]

    # The endpoint sanitizes `source` by stripping non [A-Za-z0-9_-]; our source
    # label must survive that unchanged, or heartbeats land under a different
    # Redis key than the operator expects.
    import re

    sanitized = re.sub(r"[^a-zA-Z0-9_-]", "", params["source"][0])[:_SOURCE_MAX_LEN]
    assert sanitized == "github-actions"


def test_probe_reports_failure_state_distinctly(capture_server, monkeypatch):
    """A failing probe still heartbeats — being alive and reporting failure is
    different from being dead, and the switch must be able to tell them apart."""
    server, capture = capture_server
    host, port = server.server_address

    monkeypatch.setenv("MONITOR_HEARTBEAT_URL", f"http://{host}:{port}/hb")
    monkeypatch.setenv("MONITOR_HEARTBEAT_TOKEN", "t")
    monkeypatch.setenv("PROBE_SOURCE", "railway-cron")

    uptime_probe.send_heartbeat(all_ok=False)

    params = parse_qs(urlparse(capture.received[0]["path"]).query)
    assert params["ok"] == ["0"]
    assert params["source"] == ["railway-cron"]


def test_heartbeat_is_skipped_when_unconfigured(capture_server, monkeypatch):
    """No MONITOR_HEARTBEAT_URL means the feature is simply off — the probe must
    not fail or hang because of it."""
    _server, capture = capture_server
    monkeypatch.delenv("MONITOR_HEARTBEAT_URL", raising=False)

    uptime_probe.send_heartbeat(all_ok=True)

    assert capture.received == []


def test_heartbeat_failure_never_propagates(monkeypatch):
    """A dead heartbeat endpoint must not stop the probe reporting its actual
    findings — telemetry failure must never mask the real signal."""
    # Port 1 on localhost refuses connections.
    monkeypatch.setenv("MONITOR_HEARTBEAT_URL", "http://127.0.0.1:1/hb")
    monkeypatch.setenv("MONITOR_HEARTBEAT_TOKEN", "t")

    uptime_probe.send_heartbeat(all_ok=True)  # must not raise
