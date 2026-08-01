"""Fixtures for real-Postgres integration tests (tests/integration/).

Why this exists: the main sqlite test suite (tests/test_*.py) exercises the
Python-owned tables fine, but two real bugs shipped anyway because sqlite
silently tolerates SQL that Postgres rejects or behaves differently on:

1. ``bot/services/approval_webhook.py``'s ``agent_approvals ap JOIN agents a
   ON ... = ap.agent_id`` join. In production, ``agents.uuid`` is created by
   api-ts's Drizzle migration as a *native* Postgres ``uuid`` column (see
   ``api-ts/src/db/schema/agents.ts``), not the ``VARCHAR(36)`` that Python's
   own SQLAlchemy model/migration would create on a from-scratch DB. Postgres
   has no ``uuid = text`` operator, so an uncast join errors on every real
   deployment while sqlite (where both sides are just TEXT) never complains.
2. ``bot/handlers/admin_killswitch.py``'s kill-switch helpers use
   ``now()`` and ``IS NOT DISTINCT FROM`` — both fail /
   are skipped on the sqlite driver used by ``tests/test_admin_killswitch.py``
   (see that file's own ``_sqlite_supports_syntax`` guard, which silently
   skips 6 assertions on most sqlite builds).

To catch both classes for real, this fixture stands up a scratch Postgres
database and, critically, pre-creates the api-ts-owned tables (``agents``,
``users``, ``agent_link_codes``, ``policy_kill_switches``) using the *exact*
Drizzle column types (native ``uuid``, ``timestamptz``, etc.) BEFORE handing
off to ``database.db.init_db()`` / ``_ensure_schema()``. That mirrors the real
deploy order (api-ts migrates first) and ensures the additive-migration path
in ``_ensure_schema`` only ALTERs, never recreates, those columns — so the
type mismatch that caused bug #1 is actually present when the join runs.
"""

import os
import uuid as uuid_module

import pytest
import sqlalchemy
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Must be set before any `bot.*` import happens (settings validation at import time).
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("KMS_PROVIDER", "dev")
os.environ.setdefault("PYTHONPATH", ".")

ADMIN_ROOT_URL = "postgresql://postgres:postgres@localhost:54322/postgres"
ADMIN_ROOT_URL_NO_SSL = ADMIN_ROOT_URL  # local docker instance has no TLS listener


def _root_engine():
    return create_engine(f"{ADMIN_ROOT_URL_NO_SSL}?sslmode=disable", isolation_level="AUTOCOMMIT")


def _pg_reachable() -> bool:
    try:
        engine = _root_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


# Drizzle-equivalent DDL for the api-ts-owned tables the Python control-plane
# code reads/writes. Kept minimal (no unrelated FKs like organizations) but
# matching column TYPES exactly, since the type is what the historical bug
# hinged on. See api-ts/src/db/schema/{agents,users,agentLinkCodes,policies}.ts.
_DRIZZLE_DDL = """
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE,
    whatsapp_id VARCHAR(255) UNIQUE,
    username VARCHAR(255),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    default_slippage INTEGER DEFAULT 50,
    notifications_enabled BOOLEAN DEFAULT true,
    gas_mode VARCHAR(10) DEFAULT 'auto',
    language_preference TEXT DEFAULT 'en',
    tos_accepted BOOLEAN DEFAULT false,
    tos_accepted_at TIMESTAMP,
    referred_by_user_id INTEGER,
    total_referral_rewards REAL DEFAULT 0.0,
    referral_count INTEGER DEFAULT 0,
    two_fa_enabled BOOLEAN DEFAULT false,
    totp_secret VARCHAR(64),
    two_fa_threshold INTEGER DEFAULT 1000,
    organization_id UUID,
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now(),
    last_active_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    uuid UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    api_key_hash VARCHAR(128) NOT NULL,
    callback_url TEXT,
    metadata JSONB,
    is_active BOOLEAN DEFAULT true NOT NULL,
    rate_limit_tier VARCHAR(20) DEFAULT 'free' NOT NULL,
    subscription_tier VARCHAR(20),
    subscription_expires_at TIMESTAMP,
    total_requests INTEGER DEFAULT 0,
    total_swaps INTEGER DEFAULT 0,
    owner_user_id INTEGER REFERENCES users(id),
    organization_id UUID,
    created_at TIMESTAMP DEFAULT now() NOT NULL,
    updated_at TIMESTAMP DEFAULT now() NOT NULL,
    last_active_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_link_codes (
    id SERIAL PRIMARY KEY,
    agent_id INTEGER NOT NULL REFERENCES agents(id),
    code_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_agent_link_codes_code_hash ON agent_link_codes (code_hash);
CREATE INDEX IF NOT EXISTS ix_agent_link_codes_agent_id ON agent_link_codes (agent_id);

CREATE TABLE IF NOT EXISTS policy_kill_switches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    scope VARCHAR(10) NOT NULL,
    scope_id VARCHAR(64),
    active BOOLEAN DEFAULT true NOT NULL,
    reason VARCHAR(300),
    activated_by INTEGER REFERENCES users(id),
    activated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deactivated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS policy_kill_switches_scope_idx
    ON policy_kill_switches (scope, scope_id, active);
"""


@pytest.fixture(scope="session")
def pg_sessionmaker():
    """Session-scoped: creates a scratch Postgres DB, applies Drizzle-shaped
    tables + the Python schema, yields a sessionmaker bound to it, drops the
    DB at teardown. Skips the whole module if Postgres isn't reachable.
    """
    if not _pg_reachable():
        pytest.skip(
            "Postgres not reachable at "
            f"{ADMIN_ROOT_URL} (expected docker container supabase_db_static) "
            "— skipping real-Postgres integration tests"
        )

    db_name = f"suwappu_test_{uuid_module.uuid4().hex[:12]}"
    root_engine = _root_engine()
    with root_engine.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{db_name}"'))
    root_engine.dispose()

    scratch_url = f"postgresql://postgres:postgres@localhost:54322/{db_name}?sslmode=disable"

    # 1. Pre-create the api-ts (Drizzle) -owned tables with their REAL column
    #    types — this is what reproduces the uuid-vs-text bug, since a
    #    from-scratch Python-only DB would never create a native uuid column.
    scratch_engine = create_engine(scratch_url)
    with scratch_engine.begin() as conn:
        conn.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
        for statement in _DRIZZLE_DDL.split(";\n"):
            stripped = statement.strip()
            if stripped:
                conn.execute(text(stripped))
    scratch_engine.dispose()

    # 2. Hand off to the real Python migration path — this must be additive
    #    only against the tables we just created (agents/users/agent_link_codes),
    #    and creates everything else (agent_approvals, policy_kill_switches is
    #    already present so it's skipped, agent_webhook_deliveries, ...).
    from database.db import init_db

    ok = init_db(scratch_url)
    assert ok, f"init_db failed against scratch Postgres DB {db_name}"

    from database.db import SessionLocal

    yield SessionLocal

    # Teardown: terminate any lingering connections then drop the scratch DB.
    root_engine = _root_engine()
    with root_engine.connect() as conn:
        conn.execute(
            text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = :db AND pid <> pg_backend_pid()"
            ),
            {"db": db_name},
        )
        conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}"'))
    root_engine.dispose()


@pytest.fixture()
def pg_session(pg_sessionmaker):
    """Function-scoped session + cleanup of the mutable control-plane tables
    between tests, so tests in this module don't leak state into each other
    while still sharing the (expensive) schema-creation fixture above.
    """
    session = pg_sessionmaker()
    yield session
    session.rollback()
    for table in (
        "agent_webhook_deliveries",
        "agent_approvals",
        "agent_link_codes",
        "policy_kill_switches",
        "agents",
        "users",
    ):
        try:
            session.execute(text(f"DELETE FROM {table}"))
        except Exception:
            session.rollback()
    session.commit()
    session.close()
