"""Tests for the /ks agent-policy kill switch SQL helpers.

Uses a real Postgres-only table (policy_kill_switches uses ``now()`` and
``IS NOT DISTINCT FROM``, which SQLite doesn't support until 3.39+ and even
then with different semantics for ``now()``). We create a SQLite-compatible
shadow table (including a minimal ``users`` table so the activated_by FK
lookup path is exercised) to exercise the pure functions; if the sqlite
driver can't support the syntax, tests skip cleanly rather than fail the
suite.
"""

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from bot.handlers.admin_killswitch import (
    KillSwitchTableMissing,
    activate_kill_switch,
    deactivate_kill_switch,
    list_active_kill_switches,
)

ADMIN_TG_ID = 555111  # matches the seeded users row below
UNKNOWN_TG_ID = 999999  # has no matching users row


def _make_session():
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        conn.execute(text("""
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    telegram_id BIGINT UNIQUE
                )
                """))
        conn.execute(text("INSERT INTO users (telegram_id) VALUES (:tg)"), {"tg": ADMIN_TG_ID})
        conn.execute(text("""
                CREATE TABLE policy_kill_switches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    scope TEXT NOT NULL,
                    scope_id TEXT,
                    active BOOLEAN NOT NULL DEFAULT 1,
                    reason TEXT,
                    activated_by INTEGER REFERENCES users(id),
                    activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    deactivated_at TIMESTAMP
                )
                """))
        conn.commit()
    return sessionmaker(bind=engine)()


def _sqlite_supports_syntax(session) -> bool:
    try:
        session.execute(text("SELECT 1 WHERE 'x' IS NOT DISTINCT FROM :x"), {"x": "x"}).fetchone()
        session.execute(text("SELECT now()")).fetchone()
        return True
    except Exception:
        session.rollback()
        return False


@pytest.fixture()
def ks_session():
    session = _make_session()
    if not _sqlite_supports_syntax(session):
        pytest.skip("sqlite driver lacks IS NOT DISTINCT FROM / now() support for this test")
    yield session
    session.close()


def test_activate_and_list_global(ks_session):
    activate_kill_switch(
        ks_session, scope="global", scope_id=None, reason="incident", admin_telegram_id=ADMIN_TG_ID
    )
    switches = list_active_kill_switches(ks_session)
    assert len(switches) == 1
    assert switches[0]["scope"] == "global"
    assert switches[0]["reason"] == "incident"


def test_activate_resolves_activated_by_via_users_fk(ks_session):
    activate_kill_switch(
        ks_session, scope="global", scope_id=None, reason="incident", admin_telegram_id=ADMIN_TG_ID
    )
    row = ks_session.execute(
        text("SELECT activated_by FROM policy_kill_switches WHERE scope = 'global'")
    ).fetchone()
    expected_user_id = ks_session.execute(
        text("SELECT id FROM users WHERE telegram_id = :tg"), {"tg": ADMIN_TG_ID}
    ).fetchone()[0]
    assert row[0] == expected_user_id


def test_activate_with_unknown_admin_sets_null_and_tags_reason(ks_session):
    activate_kill_switch(
        ks_session,
        scope="global",
        scope_id=None,
        reason="incident",
        admin_telegram_id=UNKNOWN_TG_ID,
    )
    row = ks_session.execute(
        text("SELECT activated_by, reason FROM policy_kill_switches WHERE scope = 'global'")
    ).fetchone()
    assert row[0] is None
    assert row[1] == f"incident [tg:{UNKNOWN_TG_ID}]"


def test_activate_agent_scope_then_deactivate(ks_session):
    activate_kill_switch(
        ks_session,
        scope="agent",
        scope_id="agent-123",
        reason="bad behavior",
        admin_telegram_id=ADMIN_TG_ID,
    )
    switches = list_active_kill_switches(ks_session)
    assert any(s["scope"] == "agent" and s["scope_id"] == "agent-123" for s in switches)

    changed = deactivate_kill_switch(ks_session, scope="agent", scope_id="agent-123")
    assert changed is True
    switches = list_active_kill_switches(ks_session)
    assert not any(s["scope"] == "agent" and s["scope_id"] == "agent-123" for s in switches)


def test_deactivate_nonexistent_returns_false(ks_session):
    changed = deactivate_kill_switch(ks_session, scope="org", scope_id="no-such-org")
    assert changed is False


def test_activate_is_idempotent_upsert(ks_session):
    activate_kill_switch(
        ks_session, scope="global", scope_id=None, reason="first", admin_telegram_id=ADMIN_TG_ID
    )
    activate_kill_switch(
        ks_session, scope="global", scope_id=None, reason="second", admin_telegram_id=ADMIN_TG_ID
    )
    switches = list_active_kill_switches(ks_session)
    assert len(switches) == 1
    assert switches[0]["reason"] == "second"


def test_missing_table_raises_friendly_error():
    engine = create_engine("sqlite:///:memory:")
    session = sessionmaker(bind=engine)()
    with pytest.raises(KillSwitchTableMissing):
        list_active_kill_switches(session)
    session.close()
