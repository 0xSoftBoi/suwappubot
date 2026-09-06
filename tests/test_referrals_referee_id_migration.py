"""referrals.referee_id must exist even on databases created with the legacy referred_id.

Production logged `column referrals.referee_id does not exist` on every quote for a
referred user: the ORM model (bot/models/referral.py) reads referee_id while the
table was created with referred_id. The runtime migration reconciles the two.
"""

import os

import pytest
from sqlalchemy import create_engine, inspect, text

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from database.db import _add_referral_referee_id_column  # noqa: E402


@pytest.fixture()
def legacy_engine():
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE referrals ("
                " id INTEGER PRIMARY KEY,"
                " referrer_id INTEGER NOT NULL,"
                " referred_id INTEGER NOT NULL,"
                " referral_code VARCHAR(32) NOT NULL,"
                " created_at TIMESTAMP,"
                " is_active BOOLEAN DEFAULT 1)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO referrals (id, referrer_id, referred_id, referral_code)"
                " VALUES (1, 10, 71, 'ALPHA'), (2, 11, 72, 'BETA')"
            )
        )
    return engine


def test_adds_and_backfills_referee_id(legacy_engine):
    _add_referral_referee_id_column(legacy_engine, inspect(legacy_engine), is_sqlite=True)

    cols = {c["name"] for c in inspect(legacy_engine).get_columns("referrals")}
    assert "referee_id" in cols
    assert "referred_id" in cols  # legacy column is preserved

    with legacy_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, referred_id, referee_id FROM referrals ORDER BY id")
        ).fetchall()
    assert [(r[0], r[1], r[2]) for r in rows] == [(1, 71, 71), (2, 72, 72)]

    # The lookup fee_service runs on every quote now resolves.
    with legacy_engine.connect() as conn:
        hit = conn.execute(text("SELECT referrer_id FROM referrals WHERE referee_id = 71")).scalar()
    assert hit == 10


def test_is_idempotent(legacy_engine):
    _add_referral_referee_id_column(legacy_engine, inspect(legacy_engine), is_sqlite=True)
    _add_referral_referee_id_column(legacy_engine, inspect(legacy_engine), is_sqlite=True)
    cols = [c["name"] for c in inspect(legacy_engine).get_columns("referrals")]
    assert cols.count("referee_id") == 1


def test_noop_without_referrals_table():
    engine = create_engine("sqlite://")
    _add_referral_referee_id_column(engine, inspect(engine), is_sqlite=True)
    assert "referrals" not in inspect(engine).get_table_names()
