"""Regression tests for KMS client hardening.

Covers the confirmed vulnerability:
  - KMS wrapping does not prevent key exfiltration if application code is
    compromised. As a defense-in-depth detection layer, the KMS client now
    runs anomaly detection over DEK decryptions (suggestion #5). The monitor
    is intentionally detection-only (logs, never raises) because
    ``decrypt_data_key`` is on the hot path of every signing operation and a
    hard limit would break legitimate fund movement.
"""

import logging
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.kms_client import (
    DevMockKmsClient,
    _KmsDecryptAnomalyMonitor,
)


def _make_client() -> DevMockKmsClient:
    return DevMockKmsClient("a-test-master-key-for-kms-hardening")


# ---------------------------------------------------------------------------
# Behavior preservation: a normal decrypt round-trip still works and the
# monitor stays silent under legitimate, low-volume use.
# ---------------------------------------------------------------------------

def test_decrypt_data_key_roundtrip_unchanged():
    client = _make_client()
    result = client.generate_data_key()
    assert client.decrypt_data_key(result.encrypted_key) == result.plaintext_key


def test_normal_volume_does_not_alert(caplog):
    client = _make_client()
    result = client.generate_data_key()
    with caplog.at_level(logging.ERROR):
        # A handful of decrypts (e.g. approve + swap) must never trip anomaly.
        for _ in range(5):
            assert client.decrypt_data_key(result.encrypted_key) == result.plaintext_key
    assert "ANOMALY" not in caplog.text


def test_decrypt_never_raises_on_bad_input():
    """The monitor must never break a decrypt; only the underlying crypto may."""
    monitor = _KmsDecryptAnomalyMonitor()
    # record() must swallow anything and never propagate.
    monitor.record(b"")
    monitor.record(b"\x00\x01\x02")
    monitor.record(None)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Detection: an exfiltration-style burst across distinct wrapped DEKs logs an
# anomaly. Detection-only -> record() returns normally (does not raise).
# ---------------------------------------------------------------------------

def test_distinct_key_exfiltration_burst_logs_anomaly(caplog):
    # Low distinct-key threshold to model an RCE walking the key table.
    monitor = _KmsDecryptAnomalyMonitor(distinct_key_anomaly_threshold=10)
    with caplog.at_level(logging.ERROR):
        for i in range(10):
            # Each fingerprint distinct -> mimics iterating over every stored DEK.
            monitor.record(f"wrapped-dek-{i}".encode())
    assert "ANOMALY" in caplog.text
    assert "exfiltration" in caplog.text.lower()


def test_per_key_burst_logs_anomaly(caplog):
    monitor = _KmsDecryptAnomalyMonitor(per_key_anomaly_threshold=8)
    with caplog.at_level(logging.ERROR):
        for _ in range(8):
            monitor.record(b"same-wrapped-dek")
    assert "ANOMALY" in caplog.text


def test_monitor_record_is_detection_only_returns_none():
    monitor = _KmsDecryptAnomalyMonitor(global_anomaly_threshold=1)
    # Even past threshold, record() returns None rather than raising.
    assert monitor.record(b"x") is None
    assert monitor.record(b"y") is None
