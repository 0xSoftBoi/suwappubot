"""Tests for bot/services/approval_webhook.py + bot/services/webhook_dispatcher.py.

Covers: pure signing determinism/hex-validation, enqueue-before-inline-POST
durability, poison-payload dead-lettering (not wedging), atomic double-claim
prevention, full backoff-to-dead-letter progression, stranded 'sending'-row
reclaim, and the SSRF callback_url guard.

Uses an in-memory SQLite DB with hand-built shadow tables (agents,
approval_requests, agent_webhook_deliveries) monkeypatched in for
``database.db.get_session`` in both modules under test, mirroring the
pattern in tests/test_agent_approvals.py.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from bot.services import approval_webhook, webhook_dispatcher
from bot.services.approval_webhook import sign_payload, is_callback_url_safe
from bot.services.webhook_dispatcher import (
    WebhookDispatcher,
    MAX_ATTEMPTS,
)

# ---------------------------------------------------------------------------
# Pure signing tests — no DB, no network.
# ---------------------------------------------------------------------------


def test_sign_payload_is_deterministic():
    body = b'{"a":1}'
    key_hash = "ab" * 32  # 64 hex chars, valid sha256-hex shape
    ts = "1700000000"
    sig1 = sign_payload(body, key_hash, ts)
    sig2 = sign_payload(body, key_hash, ts)
    assert sig1 == sig2
    assert len(sig1) == 64  # hex sha256 digest


def test_sign_payload_changes_with_timestamp_or_body():
    key_hash = "ab" * 32
    base = sign_payload(b'{"a":1}', key_hash, "1700000000")
    diff_ts = sign_payload(b'{"a":1}', key_hash, "1700000001")
    diff_body = sign_payload(b'{"a":2}', key_hash, "1700000000")
    assert base != diff_ts
    assert base != diff_body


def test_sign_payload_rejects_non_hex_key():
    with pytest.raises(ValueError):
        sign_payload(b"{}", "not-hex-zzz", "1700000000")


def test_is_callback_url_safe_rejects_private_ip(monkeypatch):
    monkeypatch.setattr(approval_webhook, "_is_local_environment", lambda: False)

    def fake_getaddrinfo(host, port):
        return [(None, None, None, None, ("10.0.0.5", 0))]

    monkeypatch.setattr(approval_webhook.socket, "getaddrinfo", fake_getaddrinfo)
    assert is_callback_url_safe("https://internal.example.com/hook") is False


def test_is_callback_url_safe_rejects_metadata_ip(monkeypatch):
    monkeypatch.setattr(approval_webhook, "_is_local_environment", lambda: False)

    def fake_getaddrinfo(host, port):
        return [(None, None, None, None, ("169.254.169.254", 0))]

    monkeypatch.setattr(approval_webhook.socket, "getaddrinfo", fake_getaddrinfo)
    assert is_callback_url_safe("https://metadata.example.com/hook") is False


def test_is_callback_url_safe_allows_public_https(monkeypatch):
    monkeypatch.setattr(approval_webhook, "_is_local_environment", lambda: False)

    def fake_getaddrinfo(host, port):
        return [(None, None, None, None, ("93.184.216.34", 0))]  # public IP

    monkeypatch.setattr(approval_webhook.socket, "getaddrinfo", fake_getaddrinfo)
    assert is_callback_url_safe("https://agent.example.com/hook") is True


def test_is_callback_url_safe_rejects_http_in_production(monkeypatch):
    monkeypatch.setattr(approval_webhook, "_is_local_environment", lambda: False)
    assert is_callback_url_safe("http://localhost/hook") is False


# ---------------------------------------------------------------------------
# DB-backed tests — shadow schema.
# ---------------------------------------------------------------------------

AGENT_UUID = str(uuid.uuid4())
API_KEY_HASH = "cd" * 32


def _make_session_factory():
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        conn.execute(text("""
                CREATE TABLE agents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    uuid TEXT UNIQUE,
                    callback_url TEXT,
                    api_key_hash TEXT
                )
                """))
        conn.execute(text("""
                CREATE TABLE approval_requests (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    -- mirrors api-ts's schema (payload_hash is NOT NULL there)
                    payload_hash TEXT NOT NULL DEFAULT 'deadbeef'
                )
                """))
        conn.execute(text("""
                CREATE TABLE agent_webhook_deliveries (
                    id TEXT PRIMARY KEY,
                    approval_id TEXT NOT NULL,
                    agent_id TEXT,
                    url TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    signature_ts TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    claimed_at TIMESTAMP,
                    next_attempt_at TIMESTAMP,
                    last_error TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    delivered_at TIMESTAMP
                )
                """))
        conn.commit()
    return sessionmaker(bind=engine), engine


class _SessionCtx:
    """Minimal context manager mimicking database.db.get_session()'s contract
    (a context-managed SQLAlchemy Session usable with .execute/.commit/.get_bind())."""

    def __init__(self, factory):
        self._factory = factory
        self._session = None

    def __enter__(self):
        self._session = self._factory()
        return self._session

    def __exit__(self, exc_type, exc, tb):
        self._session.close()


@pytest.fixture()
def db(monkeypatch):
    factory, engine = _make_session_factory()

    def get_session():
        return _SessionCtx(factory)

    monkeypatch.setattr(approval_webhook, "get_session", get_session)
    monkeypatch.setattr(webhook_dispatcher, "get_session", get_session)
    # webhook_dispatcher._is_postgres imports database.db.engine directly —
    # force sqlite-path SQL by making that import fail (caught -> False).
    monkeypatch.setattr(webhook_dispatcher, "_is_postgres", lambda: False)

    session = factory()
    session.execute(
        text("INSERT INTO agents (uuid, callback_url, api_key_hash) VALUES (:u, :cb, :k)"),
        {"u": AGENT_UUID, "cb": "https://agent.example.com/hook", "k": API_KEY_HASH},
    )
    approval_id = str(uuid.uuid4())
    session.execute(
        text(
            "INSERT INTO approval_requests (id, agent_id, status, payload_hash) "
            "VALUES (:id, :aid, 'approved', 'deadbeef')"
        ),
        {"id": approval_id, "aid": AGENT_UUID},
    )
    session.commit()
    session.close()
    return {"factory": factory, "engine": engine, "approval_id": approval_id}


def _fetch_delivery(factory, delivery_id):
    s = factory()
    row = s.execute(
        text("SELECT status, attempts, last_error FROM agent_webhook_deliveries WHERE id = :id"),
        {"id": delivery_id},
    ).fetchone()
    s.close()
    return row


@pytest.mark.asyncio
async def test_enqueue_happens_even_if_inline_post_raises(db, monkeypatch):
    """notify_approval_decided must insert the durable row BEFORE the inline
    POST attempt, so a network exception during that attempt can never lose
    the decision."""

    async def boom(*a, **kw):
        raise RuntimeError("network is on fire")

    monkeypatch.setattr(approval_webhook, "is_callback_url_safe", lambda u: True)
    monkeypatch.setattr(approval_webhook, "_post_once", boom)

    with pytest.raises(RuntimeError):
        await approval_webhook.notify_approval_decided(db["approval_id"], "approved", None)

    s = db["factory"]()
    row = s.execute(
        text("SELECT approval_id, status FROM agent_webhook_deliveries WHERE approval_id = :aid"),
        {"aid": db["approval_id"]},
    ).fetchone()
    s.close()
    assert row is not None
    assert row[1] == "pending"


@pytest.mark.asyncio
async def test_notify_approval_decided_enqueues_and_delivers(db, monkeypatch):
    async def fake_post_once(callback_url, raw_body, headers, approval_id):
        return True

    monkeypatch.setattr(approval_webhook, "is_callback_url_safe", lambda u: True)
    monkeypatch.setattr(approval_webhook, "_post_once", fake_post_once)

    await approval_webhook.notify_approval_decided(db["approval_id"], "approved", None)

    s = db["factory"]()
    row = s.execute(
        text("SELECT status FROM agent_webhook_deliveries WHERE approval_id = :aid"),
        {"aid": db["approval_id"]},
    ).fetchone()
    s.close()
    assert row[0] == "delivered"


def test_poison_payload_dead_letters_instead_of_wedging(db, monkeypatch):
    """A row whose payload_json can't be parsed must back off/dead-letter via
    _record_failure, never raise out of _attempt_one."""
    factory = db["factory"]
    s = factory()
    delivery_id = str(uuid.uuid4())
    s.execute(
        text(
            "INSERT INTO agent_webhook_deliveries "
            "(id, approval_id, agent_id, url, payload_json, status, attempts) "
            "VALUES (:id, :aid, :agent, :url, :payload, 'pending', 0)"
        ),
        {
            "id": delivery_id,
            "aid": db["approval_id"],
            "agent": AGENT_UUID,
            "url": "https://agent.example.com/hook",
            "payload": "{not valid json!!",
        },
    )
    s.commit()
    s.close()

    dispatcher = WebhookDispatcher()
    monkeypatch.setattr(webhook_dispatcher, "is_callback_url_safe", lambda u: True)

    import asyncio

    # asyncio.run(), not get_event_loop().run_until_complete(): on 3.12 the
    # latter raises "no current event loop" when none is set (which is the case
    # in a full-suite CI run, though not when this file runs alone) and leaves
    # broken global loop state behind that knocked over unrelated tests
    # scheduled after this one.
    asyncio.run(
        dispatcher._attempt_one(
            delivery_id=delivery_id,
            approval_id=db["approval_id"],
            agent_id=AGENT_UUID,
            url="https://agent.example.com/hook",
            payload_json="{not valid json!!",
            signature_ts="123",
            attempts=0,
        )
    )

    row = _fetch_delivery(factory, delivery_id)
    assert row[0] == "pending"  # backed off, not wedged/raised
    assert row[1] == 1
    assert row[2] is not None


def test_claim_prevents_double_delivery(db):
    factory = db["factory"]
    s = factory()
    delivery_id = str(uuid.uuid4())
    s.execute(
        text(
            "INSERT INTO agent_webhook_deliveries "
            "(id, approval_id, agent_id, url, payload_json, status, attempts) "
            "VALUES (:id, :aid, :agent, :url, '{}', 'pending', 0)"
        ),
        {"id": delivery_id, "aid": db["approval_id"], "agent": AGENT_UUID, "url": "https://x"},
    )
    s.commit()
    s.close()

    dispatcher = WebhookDispatcher()
    first = dispatcher._claim(delivery_id)
    second = dispatcher._claim(delivery_id)

    assert first is not None
    assert second is None  # already flipped to 'sending', can't claim again


def test_backoff_progression_to_dead_letter(db):
    factory = db["factory"]
    s = factory()
    delivery_id = str(uuid.uuid4())
    s.execute(
        text(
            "INSERT INTO agent_webhook_deliveries "
            "(id, approval_id, agent_id, url, payload_json, status, attempts) "
            "VALUES (:id, :aid, :agent, :url, '{}', 'pending', 0)"
        ),
        {"id": delivery_id, "aid": db["approval_id"], "agent": AGENT_UUID, "url": "https://x"},
    )
    s.commit()
    s.close()

    dispatcher = WebhookDispatcher()

    for expected_attempt in range(1, MAX_ATTEMPTS + 1):
        dispatcher._record_failure(delivery_id, expected_attempt - 1, "boom")
        row = _fetch_delivery(factory, delivery_id)
        assert row[1] == expected_attempt
        assert row[0] == "pending"

    # The (MAX_ATTEMPTS + 1)th failure dead-letters.
    dispatcher._record_failure(delivery_id, MAX_ATTEMPTS, "boom")
    row = _fetch_delivery(factory, delivery_id)
    assert row[0] == "failed"
    assert row[1] == MAX_ATTEMPTS + 1


def test_stranded_sending_row_is_reclaimed(db):
    factory = db["factory"]
    s = factory()
    delivery_id = str(uuid.uuid4())
    stale_claimed_at = (datetime.now(timezone.utc) - timedelta(seconds=600)).replace(tzinfo=None)
    s.execute(
        text(
            "INSERT INTO agent_webhook_deliveries "
            "(id, approval_id, agent_id, url, payload_json, status, attempts, claimed_at) "
            "VALUES (:id, :aid, :agent, :url, '{}', 'sending', 1, :claimed_at)"
        ),
        {
            "id": delivery_id,
            "aid": db["approval_id"],
            "agent": AGENT_UUID,
            "url": "https://x",
            "claimed_at": stale_claimed_at,
        },
    )
    s.commit()
    s.close()

    dispatcher = WebhookDispatcher()
    reclaimed = dispatcher._claim(delivery_id)
    assert reclaimed is not None
    assert reclaimed["id"] == delivery_id


def test_fresh_sending_row_is_not_reclaimed(db):
    """A row claimed moments ago (still plausibly in-flight) must NOT be
    reclaimed — only a stale one past STALE_SENDING_RECLAIM_SECONDS."""
    factory = db["factory"]
    s = factory()
    delivery_id = str(uuid.uuid4())
    s.execute(
        text(
            "INSERT INTO agent_webhook_deliveries "
            "(id, approval_id, agent_id, url, payload_json, status, attempts, claimed_at) "
            "VALUES (:id, :aid, :agent, :url, '{}', 'sending', 1, CURRENT_TIMESTAMP)"
        ),
        {"id": delivery_id, "aid": db["approval_id"], "agent": AGENT_UUID, "url": "https://x"},
    )
    s.commit()
    s.close()

    dispatcher = WebhookDispatcher()
    result = dispatcher._claim(delivery_id)
    assert result is None
