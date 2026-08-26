"""Tests for the uptime dead-man's switch:

  - POST /internal/monitor-heartbeat (api/main.py) auth + Redis recording +
    source allow-list + fail_since tracking
  - HealthMonitor._check_heartbeat_deadman per-source staleness/never-reported/
    sustained-failure/cooldown/recovery logic (bot/services/health_monitor.py)

Redis is mocked throughout — no live instance required.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")
os.environ.setdefault("SECRET_KEY", "test-secret")

from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# --------------------------------------------------------------------------- #
# Endpoint tests: POST /internal/monitor-heartbeat
# --------------------------------------------------------------------------- #


class _FakeRedis:
    """Minimal in-memory stand-in for redis_cache, async API compatible."""

    def __init__(self):
        self.store = {}

    async def set(self, key, value, ttl_seconds=300):
        self.store[key] = value
        return True

    async def get(self, key):
        return self.store.get(key)

    async def delete(self, key):
        self.store.pop(key, None)
        return True

    async def keys(self, pattern):
        import fnmatch

        return [k for k in self.store if fnmatch.fnmatch(k, pattern)]


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


@pytest.fixture(autouse=True)
def _default_expected_sources(monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_expected_sources", "github-actions,railway-cron")


def test_heartbeat_rejected_with_missing_token(client, monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_secret", "correct-secret")

    resp = client.post("/internal/monitor-heartbeat?source=github-actions&ok=1")
    assert resp.status_code == 403


def test_heartbeat_rejected_with_wrong_token(client, monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_secret", "correct-secret")

    resp = client.post("/internal/monitor-heartbeat?source=github-actions&ok=1&token=wrong-secret")
    assert resp.status_code == 403


def test_heartbeat_rejected_when_secret_unset(client, monkeypatch):
    from bot.config.settings import settings

    # Fail CLOSED: even a request with a token (matching nothing, since
    # expected is None) must be rejected when unconfigured.
    monkeypatch.setattr(settings, "monitor_heartbeat_secret", None)

    resp = client.post("/internal/monitor-heartbeat?source=github-actions&ok=1&token=anything")
    assert resp.status_code == 403


def test_heartbeat_accepted_with_correct_token_writes_redis(client, monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_secret", "correct-secret")

    fake_redis = _FakeRedis()
    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", fake_redis)

    resp = client.post(
        "/internal/monitor-heartbeat?source=github-actions&ok=1&token=correct-secret"
    )
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}

    assert "monitor:heartbeat:github-actions" in fake_redis.store
    recorded = fake_redis.store["monitor:heartbeat:github-actions"]
    assert recorded["ok"] is True
    assert "ts" in recorded
    assert recorded["fail_since"] is None


def test_heartbeat_source_is_sanitized_for_redis_key(client, monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_secret", "correct-secret")

    fake_redis = _FakeRedis()
    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", fake_redis)

    # Attempt a source value with characters that must not land raw in a Redis key.
    resp = client.post(
        "/internal/monitor-heartbeat?source=evil%3A%2A%2A%2A&ok=0&token=correct-secret"
    )
    assert resp.status_code == 200
    keys = list(fake_redis.store.keys())
    assert len(keys) == 1
    # No colons/asterisks/wildcards should have survived the allowlist filter.
    assert ":" not in keys[0].split("monitor:heartbeat:", 1)[1]
    assert "*" not in keys[0]


def test_heartbeat_source_not_in_allowlist_is_coerced_to_unknown(client, monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_secret", "correct-secret")
    monkeypatch.setattr(settings, "monitor_expected_sources", "github-actions,railway-cron")

    fake_redis = _FakeRedis()
    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", fake_redis)

    # A well-formed but *unexpected* source name — sanitization passes, but
    # it's not in the allow-list, so it must not mint its own Redis key.
    resp = client.post(
        "/internal/monitor-heartbeat?source=some-random-attacker-source&ok=1&token=correct-secret"
    )
    assert resp.status_code == 200
    assert "monitor:heartbeat:some-random-attacker-source" not in fake_redis.store
    assert "monitor:heartbeat:unknown" in fake_redis.store


def test_heartbeat_ok_false_sets_fail_since_and_persists_across_updates(client, monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_secret", "correct-secret")

    fake_redis = _FakeRedis()
    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", fake_redis)

    resp1 = client.post(
        "/internal/monitor-heartbeat?source=github-actions&ok=0&token=correct-secret"
    )
    assert resp1.status_code == 200
    first_fail_since = fake_redis.store["monitor:heartbeat:github-actions"]["fail_since"]
    assert first_fail_since is not None

    # A second failing heartbeat must NOT reset fail_since — it should stay
    # anchored to when the failure first started.
    resp2 = client.post(
        "/internal/monitor-heartbeat?source=github-actions&ok=0&token=correct-secret"
    )
    assert resp2.status_code == 200
    assert fake_redis.store["monitor:heartbeat:github-actions"]["fail_since"] == first_fail_since

    # Recovery clears fail_since.
    resp3 = client.post(
        "/internal/monitor-heartbeat?source=github-actions&ok=1&token=correct-secret"
    )
    assert resp3.status_code == 200
    assert fake_redis.store["monitor:heartbeat:github-actions"]["fail_since"] is None


# --------------------------------------------------------------------------- #
# HealthMonitor dead-man's switch logic
# --------------------------------------------------------------------------- #


@pytest.fixture
def monitor():
    from bot.services.health_monitor import HealthMonitor

    hm = HealthMonitor()
    hm._bot = object()  # truthy sentinel; post_admin_update is mocked below
    hm._admin_ids = [1]
    return hm


def _patch_notifier(monkeypatch):
    sent = []

    async def fake_post_admin_update(bot, text):
        sent.append(text)

    monkeypatch.setattr("bot.services.support_notifier.post_admin_update", fake_post_admin_update)
    return sent


@pytest.mark.asyncio
async def test_deadman_alerts_when_heartbeat_past_threshold(monitor, monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_max_age_minutes", 45)
    monkeypatch.setattr(settings, "monitor_expected_sources", "github-actions,railway-cron")

    fake_redis = _FakeRedis()
    stale_ts = (datetime.now(timezone.utc) - timedelta(minutes=90)).isoformat()
    fake_redis.store["monitor:heartbeat:github-actions"] = {"ts": stale_ts, "ok": True}
    fresh_ts = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    fake_redis.store["monitor:heartbeat:railway-cron"] = {"ts": fresh_ts, "ok": True}
    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", fake_redis)

    monitor._started_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    monitor._last_deadman_check = None

    sent = _patch_notifier(monkeypatch)

    await monitor._check_heartbeat_deadman()

    assert len(sent) == 1
    assert "github-actions" in sent[0]
    assert "has not reported" in sent[0]
    assert "railway-cron" not in sent[0]
    assert "monitor:deadman:stale-alerted:github-actions" in fake_redis.store
    assert "monitor:deadman:stale-alerted:railway-cron" not in fake_redis.store


@pytest.mark.asyncio
async def test_deadman_stays_quiet_within_threshold(monitor, monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_max_age_minutes", 45)
    monkeypatch.setattr(settings, "monitor_expected_sources", "github-actions,railway-cron")

    fake_redis = _FakeRedis()
    fresh_ts = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    fake_redis.store["monitor:heartbeat:github-actions"] = {"ts": fresh_ts, "ok": True}
    fake_redis.store["monitor:heartbeat:railway-cron"] = {"ts": fresh_ts, "ok": True}
    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", fake_redis)

    monitor._started_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    monitor._last_deadman_check = None

    sent = _patch_notifier(monkeypatch)

    await monitor._check_heartbeat_deadman()

    assert sent == []


@pytest.mark.asyncio
async def test_deadman_cooldown_suppresses_repeat_alert(monitor, monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_max_age_minutes", 45)
    monkeypatch.setattr(settings, "monitor_expected_sources", "github-actions,railway-cron")

    fake_redis = _FakeRedis()
    stale_ts = (datetime.now(timezone.utc) - timedelta(minutes=90)).isoformat()
    fake_redis.store["monitor:heartbeat:github-actions"] = {"ts": stale_ts, "ok": True}
    fake_redis.store["monitor:heartbeat:railway-cron"] = {"ts": stale_ts, "ok": True}
    # github-actions already alerted recently — cooldown marker present.
    fake_redis.store["monitor:deadman:stale-alerted:github-actions"] = {
        "alerted_at": datetime.now(timezone.utc).isoformat()
    }
    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", fake_redis)

    monitor._started_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    monitor._last_deadman_check = None

    sent = _patch_notifier(monkeypatch)

    await monitor._check_heartbeat_deadman()

    # github-actions suppressed by its own cooldown; railway-cron (no prior
    # cooldown marker) must still alert independently — no cross-suppression.
    assert len(sent) == 1
    assert "railway-cron" in sent[0]
    assert "github-actions" not in sent[0]


@pytest.mark.asyncio
async def test_deadman_sends_recovery_after_alert(monitor, monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_max_age_minutes", 45)
    monkeypatch.setattr(settings, "monitor_expected_sources", "github-actions")

    fake_redis = _FakeRedis()
    fresh_ts = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    fake_redis.store["monitor:heartbeat:github-actions"] = {"ts": fresh_ts, "ok": True}
    fake_redis.store["monitor:deadman:stale-alerted:github-actions"] = {
        "alerted_at": datetime.now(timezone.utc).isoformat()
    }
    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", fake_redis)

    monitor._started_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    monitor._last_deadman_check = None

    sent = _patch_notifier(monkeypatch)

    await monitor._check_heartbeat_deadman()

    assert len(sent) == 1
    assert "recovered" in sent[0]
    assert "github-actions" in sent[0]
    assert "monitor:deadman:stale-alerted:github-actions" not in fake_redis.store


@pytest.mark.asyncio
async def test_deadman_boot_grace_period_suppresses_alert(monitor, monkeypatch):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_max_age_minutes", 45)
    monkeypatch.setattr(settings, "monitor_expected_sources", "github-actions")

    fake_redis = _FakeRedis()
    stale_ts = (datetime.now(timezone.utc) - timedelta(minutes=90)).isoformat()
    fake_redis.store["monitor:heartbeat:github-actions"] = {"ts": stale_ts, "ok": True}
    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", fake_redis)

    # Process just started — well within the 15-minute grace period.
    monitor._started_at = datetime.now(timezone.utc) - timedelta(minutes=2)
    monitor._last_deadman_check = None

    sent = _patch_notifier(monkeypatch)

    await monitor._check_heartbeat_deadman()

    assert sent == []


@pytest.mark.asyncio
async def test_deadman_no_heartbeats_ever_recorded_does_not_alert_within_grace(
    monitor, monkeypatch
):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_expected_sources", "github-actions,railway-cron")

    fake_redis = _FakeRedis()  # empty — no heartbeat keys at all
    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", fake_redis)

    # Still within boot grace — absence-of-data on startup isn't a signal yet.
    monitor._started_at = datetime.now(timezone.utc) - timedelta(minutes=2)
    monitor._last_deadman_check = None

    sent = _patch_notifier(monkeypatch)

    await monitor._check_heartbeat_deadman()

    assert sent == []


@pytest.mark.asyncio
async def test_deadman_source_never_reported_past_grace_alerts(monitor, monkeypatch):
    """A source that has NEVER reported (no key at all) past the boot grace
    period must alert as stale/never-reported, distinctly from a source that
    reported once and then went quiet."""
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_max_age_minutes", 45)
    monkeypatch.setattr(settings, "monitor_expected_sources", "github-actions,railway-cron")

    fake_redis = _FakeRedis()
    fresh_ts = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    fake_redis.store["monitor:heartbeat:railway-cron"] = {"ts": fresh_ts, "ok": True}
    # github-actions has no key at all — never reported.
    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", fake_redis)

    monitor._started_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    monitor._last_deadman_check = None

    sent = _patch_notifier(monkeypatch)

    await monitor._check_heartbeat_deadman()

    assert len(sent) == 1
    assert "github-actions" in sent[0]
    assert "never reported" in sent[0]


@pytest.mark.asyncio
async def test_deadman_sustained_failure_triggers_separate_alert_with_own_cooldown(
    monitor, monkeypatch
):
    from bot.config.settings import settings

    monkeypatch.setattr(settings, "monitor_heartbeat_max_age_minutes", 45)
    monkeypatch.setattr(settings, "monitor_expected_sources", "github-actions")

    fake_redis = _FakeRedis()
    # Fresh ts (not stale) but has been failing (ok=False) since well past
    # the threshold — this must NOT look "healthy" just because ts is recent.
    fresh_ts = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    fail_since = (datetime.now(timezone.utc) - timedelta(minutes=60)).isoformat()
    fake_redis.store["monitor:heartbeat:github-actions"] = {
        "ts": fresh_ts,
        "ok": False,
        "fail_since": fail_since,
    }
    monkeypatch.setattr("bot.utils.redis_cache.redis_cache", fake_redis)

    monitor._started_at = datetime.now(timezone.utc) - timedelta(minutes=30)
    monitor._last_deadman_check = None

    sent = _patch_notifier(monkeypatch)

    await monitor._check_heartbeat_deadman()

    assert len(sent) == 1
    assert "reporting failures" in sent[0]
    assert "github-actions" in sent[0]
    assert "monitor:deadman:failing-alerted:github-actions" in fake_redis.store

    # Second run within cooldown must not re-alert.
    sent.clear()
    monitor._last_deadman_check = None
    await monitor._check_heartbeat_deadman()
    assert sent == []
